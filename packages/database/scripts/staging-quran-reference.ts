import 'server-only';

import { readFile } from 'node:fs/promises';

import {
  importQuranReference,
  importReferenceTranslations,
  importSurahNames,
  liveCanonicalSession,
} from '../src/lifecycle/quran-reference.ts';
import {
  importIrfanNarrationRecitation,
  importMp3QuranRecitations,
  importNarrationAlignment,
} from '../src/lifecycle/quran-recitations.ts';
import { STAGING_DATABASE } from '../src/lifecycle/staging-target.ts';
import {
  readTanzilCorpus,
  readTanzilSurahNames,
} from '../src/lifecycle/tanzil-corpus.ts';
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
 *     (`npm run quran:reference:translations`) Registers every translation
 *     work's provenance source as the OWNER — Irfan-ul-Quran's Urdu and
 *     English, and QuranEnc's external reference translations (owner decision
 *     2026-11-10) — then imports each work's staged revisions as the RUNTIME
 *     principal under the operator's `migration.read`, `quran.read` and
 *     `quran.administer`, Surah by Surah, publishing each work. A Surah without
 *     a current, valid, complete revision is skipped and reported, never
 *     repaired; a QuranEnc work's attribution names its staged edition's version.
 *
 *   names         --meta <quran-data.xml> --sha256 <metadata hex> --operator <accountId>
 *     (`npm run quran:reference:names`; Quran Part 2) Reads the Surahs' names
 *     from the Tanzil metadata — the exact digest, 114 well-formed entries —
 *     refuses unless the registered reference source's evidence records that
 *     same digest and the canonical corpus is that source's, then saves each
 *     Surah's English display name (`tname`) and its meaning (`ename`),
 *     verbatim, as the RUNTIME principal through Quran's administrative
 *     service under the operator's `quran.read` and `quran.administer`. A name
 *     an operator recorded is kept; a re-run changes nothing.
 *
 *   recitations-mp3quran    --operator <accountId>
 *     (Quran Part 5) Registers mp3quran's provenance source as the OWNER, then,
 *     as the RUNTIME principal, imports the curated Ayah-timed Hafs reads: each
 *     reciter a People Person (people.administer), each read a STREAMED
 *     recitation of its allowlisted CDN folder with one timed segment per
 *     Surah (quran.read + quran.administer). Fetched through the safe fetch
 *     boundary — run it in the `ingest` container, the one with an outbound
 *     network. Resumable; a re-run adds only what is missing.
 *
 *   recitations-irfan-urdu  --operator <accountId> --dir <directory>
 *     (Quran Part 5) Downloads the owner-attested Irfan-ul-Quran Urdu narration
 *     archive into `--dir` once (exact size; digest reported), registers its
 *     provenance with that digest as the OWNER, then stores each Surah's MP3
 *     into Storage — scanned, unaltered — as a first-party, untimed recitation
 *     (quran.read + quran.administer + people.administer). Resumable.
 *
 *   recitations-narration-timing  --operator <accountId> --file <json> --sha256 <hex>
 *     (Quran translation audio) Refuses unless the alignment file is the one
 *     whose digest is pinned (`NARRATION_TIMING_SHA256`) and describes the
 *     archive the narration was stored from; registers its provenance as the
 *     OWNER, then, as the RUNTIME principal (quran.read + quran.administer),
 *     records each accepted Surah's Arabic timing, alignment and translation
 *     spans on the stored narration. Needs both earlier recitation imports;
 *     resumable, and a re-run changes nothing.
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
  'translations --operator <accountId> | ' +
  'names --meta <file> --sha256 <metadata hex> --operator <accountId> | ' +
  'recitations-mp3quran --operator <accountId> | ' +
  'recitations-irfan-urdu --operator <accountId> --dir <directory> | ' +
  'recitations-narration-timing --operator <accountId> --file <json> --sha256 <hex>';

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
  if (
    mode !== 'import' &&
    mode !== 'translations' &&
    mode !== 'names' &&
    mode !== 'recitations-mp3quran' &&
    mode !== 'recitations-irfan-urdu' &&
    mode !== 'recitations-narration-timing'
  )
    throw new Error(`usage: ${USAGE}`);
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
  const names =
    mode === 'names'
      ? readTanzilSurahNames({
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
    const environment = command.values;
    let result: unknown;
    if (corpus !== null)
      result = await importQuranReference({
        owner,
        runtime,
        corpus,
        operator,
        session:
          argumentValue('--session') === undefined
            ? await liveCanonicalSession(owner, operator)
            : account('--session'),
        environment,
      });
    else if (names !== null)
      result = await importSurahNames({ owner, runtime, names, operator, environment });
    else if (mode === 'recitations-mp3quran')
      result = await importMp3QuranRecitations({ owner, runtime, operator, environment });
    else if (mode === 'recitations-narration-timing')
      result = await importNarrationAlignment({
        owner,
        runtime,
        operator,
        file: required('--file'),
        sha256: required('--sha256'),
        environment,
      });
    else if (mode === 'recitations-irfan-urdu')
      result = await importIrfanNarrationRecitation({
        owner,
        runtime,
        operator,
        directory: required('--dir'),
        environment,
      });
    else
      result = await importReferenceTranslations({
        owner,
        runtime,
        operator,
        environment,
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
