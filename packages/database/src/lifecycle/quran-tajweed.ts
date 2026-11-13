import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  QURAN_TAJWEED_TOOL_ENTRY,
  runMigrationTool,
} from './migration-proof-operator.ts';
import {
  assertConnectedDatabase,
  assertReferenceCorpus,
  registerProvenanceSource,
} from './quran-recitations.ts';
import type { SqlServerConnection, SqlSession } from './sql-connection.ts';

/**
 * THE OWNER SIDE of Quran Part 9's tajweed import on staging (owner decision,
 * OPEN_DECISIONS.md §1.2 item 4): Collin Fair's quran-tajweed colour
 * annotations (CC BY 4.0), re-aligned to the Tanzil Uthmani 1.1 text, as a
 * DRAFT overlay an editor may publish — staging only, pending a qari's review.
 *
 * The owner (migration principal) checks both files are the pinned ones,
 * registers the provenance source — authority `reference`, no ayat of its
 * own, the licences and the change made in its evidence — and hands its
 * identifier to the runtime child (`scripts/quran/tajweed-runtime.ts`), which
 * writes only through Quran's administrative service. On `MinhajStaging` or a
 * disposable proof database only, beside the Tanzil reference corpus only.
 *
 * Everything printed is identifiers and counts.
 */

/** The owner decision the provenance names. */
export const QURAN_TAJWEED_DECISION = 'OWNER-DECISION-2026-11-12-QURAN-STAGING-TAJWEED';

/**
 * THE TWO FILES THE PLATFORM ACCEPTS, by SHA-256, as downloaded on 2026-11-12:
 * the CC BY 4.0 annotation file (5,578,730 bytes) from the project's
 * `output/`, and the Tanzil Uthmani 1.0.2 text (1,376,504 bytes) the project
 * attaches as the one its offsets count into. Any other file is refused until
 * its digest is reviewed and recorded here.
 */
export const TAJWEED_ANNOTATIONS_SHA256 =
  '151d616ad37a4cc21a80f20d5e1104c5b408375107ddd4d71247dea4c05ebf67';
export const TAJWEED_BASE_TEXT_SHA256 =
  'abe6447a5d29bb126383ba9120628060cf96dc9ef5b402a506fc251f6ed0b9a2';

export const TAJWEED_PROVENANCE = Object.freeze({
  code: 'quran-tajweed-annotations',
  title:
    'quran-tajweed colour annotations (Collin Fair), re-aligned to Tanzil Uthmani 1.1',
  version: 'tajweed.hafs.uthmani-pause-sajdah.json (2026-11-12)',
});

const SHA256 = /^[0-9a-f]{64}$/u;
const ACCOUNT = /^[A-Za-z0-9_-]{8,36}$/u;

/**
 * The provenance evidence: both files and digests, both licences, the change
 * CC BY 4.0 asks to be noted, and the decision. Fixed text, so a re-run finds
 * the same source.
 */
export function tajweedEvidence(): string {
  return [
    `quran-tajweed by Collin Fair (https://github.com/cpfair/quran-tajweed, commit 496f71cd191da00fa2a37ded79dbbddb033bb0ad): output/tajweed.hafs.uthmani-pause-sajdah.json, SHA-256 ${TAJWEED_ANNOTATIONS_SHA256}, Creative Commons Attribution 4.0 International (data file only; the repository's code carries no licence and is not used).`,
    `Offsets count Unicode code points of the Tanzil Uthmani 1.0.2 text the project attaches (quran-uthmani.txt, about 2017-04-06), SHA-256 ${TAJWEED_BASE_TEXT_SHA256}, Tanzil terms of use (CC BY 3.0, verbatim).`,
    'Changes made: offsets re-aligned to the Tanzil Uthmani 1.1 text by a code-point diff; an Ayah is kept only if every span covers code points the two texts share, contiguously, else skipped whole. Neither text is altered.',
    `${QURAN_TAJWEED_DECISION}: staging only, labelled not yet reviewed by a qari; production gates unchanged.`,
  ].join('\n');
}

async function digestOf(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

/** `tajweed`: both files proved, provenance as the owner, then the runtime import. */
export async function importTajweedOverlay(input: {
  readonly owner: SqlSession;
  readonly runtime: SqlServerConnection;
  readonly operator: string;
  /** The two files, as the operations container sees them. */
  readonly annotations: string;
  readonly text: string;
  /** The digests the operator confirms; each must be the pinned one. */
  readonly sha256: string;
  readonly textSha256: string;
  readonly environment: Record<string, string | undefined>;
}): Promise<Record<string, unknown>> {
  if (!ACCOUNT.test(input.operator))
    throw new Error('The operator must be an account identifier.');
  if (!path.isAbsolute(input.annotations) || !path.isAbsolute(input.text))
    throw new Error('The tajweed files must be absolute paths.');
  if (
    !SHA256.test(input.sha256) ||
    input.sha256 !== TAJWEED_ANNOTATIONS_SHA256 ||
    input.textSha256 !== TAJWEED_BASE_TEXT_SHA256
  )
    throw new Error(
      'Those are not the recorded tajweed file digests; nothing was changed.',
    );
  if (
    (await digestOf(input.annotations)) !== TAJWEED_ANNOTATIONS_SHA256 ||
    (await digestOf(input.text)) !== TAJWEED_BASE_TEXT_SHA256
  )
    throw new Error('The tajweed files are not the recorded ones; nothing was changed.');
  await assertConnectedDatabase(input.owner);
  await assertReferenceCorpus(input.owner, []);
  const source = await registerProvenanceSource(
    input.owner,
    TAJWEED_PROVENANCE,
    tajweedEvidence(),
  );
  const result = await runMigrationTool({
    runtime: input.runtime,
    entry: QURAN_TAJWEED_TOOL_ENTRY,
    args: [
      'tajweed',
      '--operator',
      input.operator,
      '--source',
      source.id,
      '--annotations',
      input.annotations,
      '--text',
      input.text,
      '--sha256',
      TAJWEED_ANNOTATIONS_SHA256,
      '--text-sha256',
      TAJWEED_BASE_TEXT_SHA256,
    ],
    environment: input.environment,
    label: 'quran-tajweed overlay import',
  });
  return { source: source.state, sourceId: source.id, ...result };
}
