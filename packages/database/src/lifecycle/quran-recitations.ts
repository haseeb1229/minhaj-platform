import 'server-only';

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  assertMigrationProofDatabase,
  QURAN_RECITATIONS_TOOL_ENTRY,
  runMigrationTool,
} from './migration-proof-operator.ts';
import { QURAN_REFERENCE_SOURCE_CODE } from './quran-reference.ts';
import type { SqlServerConnection, SqlSession } from './sql-connection.ts';

/**
 * THE OWNER SIDE of Quran Part 5's recitation imports on staging (owner
 * decisions 2026-11-09, OPEN_DECISIONS.md §1.2): mp3quran.net's Ayah-timed
 * qaris, STREAMED from its CDN, and Minhaj-ul-Quran's own Urdu narration of
 * Irfan-ul-Quran (Tasleem Ahmed Sabri), stored first-party.
 *
 * ## Who writes what
 *
 * The owner (migration principal) registers each import's PROVENANCE source —
 * authority `reference`, no ayat of its own, its licence or attestation in its
 * evidence — because the runtime principal can register none. Everything else
 * is the runtime child's (`scripts/quran/recitations-runtime.ts`): Quran's
 * administrative service, Quran's segment upload into Storage, and People's
 * administrative service, each re-reading the operator's permission live.
 *
 * ## Where it may run, and what it never is
 *
 * On `MinhajStaging` or a disposable proof database only, proven from the
 * CONNECTED database's name, beside the Tanzil reference corpus only — so the
 * recitations are public only on the deployment that admits the reference
 * preview, and never beside an approved corpus (a stream names a `reference`
 * source, which the database enforces). This is not Minhaj's approval of any
 * reciter; production never runs it.
 *
 * Everything printed is identifiers and counts.
 */

/** The owner decision both provenance records name. */
export const QURAN_RECITATIONS_DECISION =
  'OWNER-DECISION-2026-11-09-QURAN-STAGING-RECITATIONS';

/** The attestation the Irfan-ul-Quran narration is ingested under. */
export const IRFAN_NARRATION_ATTESTATION =
  'OWNER-ATTESTATION-2026-11-06-R2-COMPREHENSIVE-PRESENTATION-CORPUS';

export const RECITATION_PROVENANCE = Object.freeze({
  mp3quran: {
    code: 'mp3quran-recitations',
    title: 'mp3quran.net recitations and Ayah timings',
    version: 'api-v3',
  },
  irfan: {
    code: 'irfan-ul-quran-ur-narration',
    title: 'Irfan-ul-Quran Urdu narration (Tasleem Ahmed Sabri)',
    version: 'Quran_mp3.zip (Last-Modified 2017-11-04)',
  },
} as const);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[A-Za-z0-9_-]{8,36}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/** mp3quran's evidence: what it is, its own grant quoted, and the decision. */
export function mp3quranEvidence(): string {
  return [
    'mp3quran.net - API v3 (https://www.mp3quran.net/api/v3): reciters, per-Surah audio on https://cdn.mp3quran.net and per-Ayah start/end timings (ayat_timing); the polygon and mushaf-page fields are not used.',
    'Terms (https://www.mp3quran.net/eng/privacy, "Copyrights"): "All rights are available to everyone, and we allow any visitor or developer to copy any material or use any link on the websites".',
    'Audio is streamed from the CDN, never copied. Curated Ayah-timed reads of Hafs an Asim only; names as mp3quran gives them.',
    `${QURAN_RECITATIONS_DECISION}: staging only; not reviewed by Minhaj-ul-Quran's religious authority for this platform; production gates unchanged.`,
  ].join('\n');
}

/** The narration's evidence: the archive's address, size and digest, and the attestation. */
export function irfanNarrationEvidence(sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('The archive digest is not a SHA-256.');
  return [
    'Irfan-ul-Quran Urdu audio translation, voice Tasleem Ahmed Sabri. (C) Minhaj-ul-Quran International.',
    `Archive https://minhaj.net/downloads/iQuran/Quran_mp3.zip, 687598353 bytes, SHA-256 ${sha256}; one MP3 per Surah, stored first-party unaltered; no Ayah timing.`,
    `${IRFAN_NARRATION_ATTESTATION}; ${QURAN_RECITATIONS_DECISION}: staging only; production gates unchanged.`,
  ].join('\n');
}

async function assertConnectedDatabase(sql: SqlSession): Promise<void> {
  const rows = await sql.query<{ name: string | null }>('SELECT DB_NAME() AS [name];');
  const name = rows.length === 1 ? rows[0]?.name : null;
  if (typeof name !== 'string')
    throw new Error('The connected database could not be identified; refusing.');
  assertMigrationProofDatabase(name);
}

/**
 * Refuses, with nothing changed, unless the active corpus is the whole Tanzil
 * reference corpus and the content languages the recitations name exist.
 */
async function assertReferenceCorpus(
  sql: SqlSession,
  languages: readonly string[],
): Promise<void> {
  const [row] = await sql.query<{
    activeAuthority: string | null;
    activeCode: string | null;
    surahs: number | string;
    languages: number | string;
  }>(`
    SELECT
      (SELECT s.[authority] FROM [dbo].[QuranActivation] a JOIN [dbo].[QuranSource] s ON s.[id] = a.[sourceId] WHERE a.[id] = 1) AS [activeAuthority],
      (SELECT s.[code] FROM [dbo].[QuranActivation] a JOIN [dbo].[QuranSource] s ON s.[id] = a.[sourceId] WHERE a.[id] = 1) AS [activeCode],
      (SELECT COUNT_BIG(*) FROM [dbo].[Surah]) AS [surahs],
      (SELECT COUNT_BIG(*) FROM [dbo].[Language] WHERE [code] IN (${languages.map(n).join(', ')})) AS [languages];
  `);
  if (
    row === undefined ||
    row.activeAuthority !== 'reference' ||
    row.activeCode !== QURAN_REFERENCE_SOURCE_CODE ||
    Number(row.surahs) !== 114
  )
    throw new Error(
      'The active corpus is not the Tanzil reference corpus; import it first. Nothing was changed.',
    );
  if (Number(row.languages) !== languages.length)
    throw new Error(
      `The content languages ${languages.join(', ')} are not all recorded; nothing was changed.`,
    );
}

/**
 * Registers (or finds) one provenance source — authority `reference`, no ayat.
 * A source already registered with different evidence is refused, never edited.
 */
export async function registerRecitationProvenance(
  sql: SqlSession,
  which: keyof typeof RECITATION_PROVENANCE,
  evidence: string,
): Promise<{ readonly id: string; readonly state: 'registered' | 'kept' }> {
  await assertConnectedDatabase(sql);
  const { code, title, version } = RECITATION_PROVENANCE[which];
  const [existing] = await sql.query<{
    id: string;
    authority: string;
    reference: string | null;
  }>(
    `SELECT [id],[authority],[reference] FROM [dbo].[QuranSource] WHERE [code] = ${n(code)};`,
  );
  if (existing !== undefined) {
    if (existing.authority !== 'reference' || existing.reference !== evidence)
      throw new Error(
        `A source '${code}' is registered with different evidence; nothing was changed.`,
      );
    return { id: existing.id, state: 'kept' };
  }
  const id = randomUUID();
  await sql.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script],[reference])
    VALUES (${n(id)}, ${n(code)}, N'reference', ${n(title)}, ${n(version)}, N'utf-8', NULL, ${n(evidence)});
  `);
  return { id, state: 'registered' };
}

/** `recitations-mp3quran`: provenance as the owner, then the runtime import. */
export async function importMp3QuranRecitations(input: {
  readonly owner: SqlSession;
  readonly runtime: SqlServerConnection;
  readonly operator: string;
  readonly environment: Record<string, string | undefined>;
}): Promise<Record<string, unknown>> {
  if (!ACCOUNT.test(input.operator))
    throw new Error('The operator must be an account identifier.');
  await assertConnectedDatabase(input.owner);
  await assertReferenceCorpus(input.owner, ['ar']);
  const source = await registerRecitationProvenance(
    input.owner,
    'mp3quran',
    mp3quranEvidence(),
  );
  const result = await runMigrationTool({
    runtime: input.runtime,
    entry: QURAN_RECITATIONS_TOOL_ENTRY,
    args: ['mp3quran', '--operator', input.operator, '--source', source.id],
    environment: input.environment,
    label: 'mp3quran recitation import',
  });
  return { source: source.state, sourceId: source.id, ...result };
}

/**
 * `recitations-irfan-urdu`: the archive downloaded (once) and measured by the
 * runtime child, its digest recorded in the provenance as the owner, then the
 * runtime import of exactly that archive.
 */
export async function importIrfanNarrationRecitation(input: {
  readonly owner: SqlSession;
  readonly runtime: SqlServerConnection;
  readonly operator: string;
  /** Where the archive is kept between runs (mounted from the host). */
  readonly directory: string;
  readonly environment: Record<string, string | undefined>;
}): Promise<Record<string, unknown>> {
  if (!ACCOUNT.test(input.operator))
    throw new Error('The operator must be an account identifier.');
  if (!path.isAbsolute(input.directory))
    throw new Error('The archive directory must be an absolute path.');
  await assertConnectedDatabase(input.owner);
  await assertReferenceCorpus(input.owner, ['ur']);
  const fetched = await runMigrationTool({
    runtime: input.runtime,
    entry: QURAN_RECITATIONS_TOOL_ENTRY,
    args: ['irfan-download', '--dir', input.directory],
    environment: input.environment,
    label: 'Irfan-ul-Quran narration download',
  });
  const sha256 = fetched['sha256'];
  if (typeof sha256 !== 'string' || !SHA256.test(sha256))
    throw new Error('The download reported no digest; nothing was changed.');
  const source = await registerRecitationProvenance(
    input.owner,
    'irfan',
    irfanNarrationEvidence(sha256),
  );
  if (!UUID.test(source.id)) throw new Error('The provenance source is malformed.');
  const result = await runMigrationTool({
    runtime: input.runtime,
    entry: QURAN_RECITATIONS_TOOL_ENTRY,
    args: [
      'irfan-urdu',
      '--operator',
      input.operator,
      '--source',
      source.id,
      '--zip',
      path.join(input.directory, 'Quran_mp3.zip'),
      '--sha256',
      sha256,
    ],
    environment: input.environment,
    label: 'Irfan-ul-Quran narration import',
  });
  return {
    source: source.state,
    sourceId: source.id,
    downloaded: fetched['downloaded'] === true,
    bytes: fetched['bytes'],
    sha256,
    ...result,
  };
}
