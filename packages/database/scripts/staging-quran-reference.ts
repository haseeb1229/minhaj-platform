import 'server-only';

import { readFile } from 'node:fs/promises';

import {
  importIrfanTranslations,
  importQuranReference,
  liveCanonicalSession,
} from '../src/lifecycle/quran-reference.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import { readTanzilCorpus } from '../src/lifecycle/tanzil-corpus.ts';
import { ACCOUNT_ID } from './operator-arguments.ts';
import {
  argumentValue,
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `staging-quran-reference` — Rebaseline R2's Quran reference preview on the
 * staging database (owner decision 2026-11-06; OPEN_DECISIONS.md §1.1).
 * `docker/staging/bin/quran-reference.sh` runs it in the exact-SHA operations
 * image with the operator's downloaded files mounted read-only.
 *
 *   import        --text <uthmani.xml> --meta <quran-data.xml> --sha256 <hex>
 *                 --operator <accountId> [--session <sessionId>]
 *     (`npm run quran:reference:import`) Reads and verifies the Tanzil Uthmani
 *     1.1 text and metadata — the exact digest, 114 Surahs, 6,236 ayat, and the
 *     two files agreeing — registers the source (authority `reference`) as the
 *     OWNER, has the corpus accepted as the RUNTIME principal through Quran's
 *     canonical service under the operator's live `quran.editCanonical` grant
 *     and `quran-canonical-edit` step-up (earned on the admin Quran screen
 *     within the last five minutes), then activates it as the OWNER. Resumes an
 *     interrupted import; refuses, changing nothing, once the corpus is active.
 *
 *   translations  --operator <accountId>
 *     (`npm run quran:reference:translations`) Registers Irfan-ul-Quran's two
 *     provenance sources as the OWNER, then imports the staged Urdu and English
 *     revisions as the RUNTIME principal under the operator's `migration.read`,
 *     `quran.read` and `quran.administer`, Surah by Surah, publishing each work.
 *     A Surah without a current, valid, complete revision is skipped and
 *     reported, never repaired.
 *
 * THE WHOLE STAGING GUARD FIRST — declared environment and instance, internal
 * host and port, `MinhajStaging`, distinct principals, TLS posture, the SQL
 * container's machine name and the database's fingerprint — then the
 * lifecycle module's own check of the CONNECTED database's name.
 *
 * The final stdout line is one JSON object of identifiers and counts: never
 * text, a password or a URL.
 */

/** How long the owner's one-transaction source registration may take. */
const OWNER_BATCH_TIMEOUT_MS = 300_000;

const USAGE =
  'staging-quran-reference import --text <file> --meta <file> --sha256 <hex> --operator <accountId> [--session <sessionId>] | ' +
  'translations --operator <accountId>';

function required(flag: string): string {
  const value = argumentValue(flag);
  if (value === undefined || value.startsWith('--') || value.trim() === '')
    throw new Error(`usage: ${USAGE}`);
  return value;
}

function account(flag: string): string {
  const value = required(flag);
  if (!ACCOUNT_ID.test(value))
    throw new Error(`${flag} must be an internal identifier, not an email address.`);
  return value;
}

await runStagingCommand('staging:quran:reference', async () => {
  const [mode] = process.argv.slice(2);
  if (mode !== 'import' && mode !== 'translations') throw new Error(`usage: ${USAGE}`);
  const operator = account('--operator');

  // Read and verify the files BEFORE touching the database: a wrong file is
  // refused without a connection being opened.
  const corpus =
    mode === 'import'
      ? readTanzilCorpus({
          text: await readFile(required('--text')),
          metadata: await readFile(required('--meta')),
          expectedSha256: required('--sha256'),
        })
      : null;

  const command = startStagingCommand();
  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  await master.close();
  // Registering a whole source is ONE large batch, in one transaction.
  const owner = await openAdminSession(command, STAGING_DATABASE, 'live', {
    requestTimeoutMs: OWNER_BATCH_TIMEOUT_MS,
  });
  try {
    const runtime = runtimeConnection(command, STAGING_DATABASE, 'live');
    const result =
      corpus === null
        ? await importIrfanTranslations({
            owner,
            runtime,
            operator,
            environment: command.values,
          })
        : await importQuranReference({
            owner,
            runtime,
            corpus,
            operator,
            session:
              argumentValue('--session') === undefined
                ? await liveCanonicalSession(owner, operator)
                : account('--session'),
            environment: command.values,
          });
    return {
      environmentId: command.environmentId,
      database: STAGING_DATABASE,
      mode,
      result,
    };
  } finally {
    await owner.close();
  }
});
