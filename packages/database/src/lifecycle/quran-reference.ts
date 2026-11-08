import 'server-only';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  assertMigrationProofDatabase,
  QURAN_REFERENCE_TOOL_ENTRY,
  runMigrationTool,
} from './migration-proof-operator.ts';
import type { SqlServerConnection, SqlSession } from './sql-connection.ts';
import type { TanzilCorpus } from './tanzil-corpus.ts';

/**
 * THE OWNER SIDE of Rebaseline R2's Quran reference preview (owner decision
 * 2026-11-06; OPEN_DECISIONS.md §1.1, §1.2).
 *
 * ## Who writes what
 *
 * The SOURCE and the ACTIVATION are the owner's: only the migration (owner)
 * principal may insert `QuranSource*` and `QuranActivation` rows — the runtime
 * principal is denied both — so this module writes them on the owner session it
 * is handed. CANONICAL text is never written here: the corpus is accepted by
 * Quran's own canonical service, in a child process running as the RUNTIME
 * principal (`scripts/quran/reference-runtime.ts`), under an operator's live
 * `quran.editCanonical` grant and `quran-canonical-edit` step-up, and the
 * database procedure copies the text FROM the registered source after
 * comparing the operator's candidate byte for byte. The layered translations
 * go through Quran's administrative service under `quran.administer`.
 *
 * ## What it is, and what it never is
 *
 * The source is registered with authority `reference`: a licensed text,
 * reproduced verbatim, NOT reviewed by Minhaj-ul-Quran's religious authority.
 * The database keeps it out of any approved corpus, and a deployment shows it
 * only when it admits the preview. Production never runs this.
 *
 * ## Where it may run
 *
 * On `MinhajStaging` or a disposable `MinhajPhase1Test_<32 hex>` database only,
 * proven from the CONNECTED database's own name — a second check after the
 * caller's staging or local target guard.
 *
 * ## Irreversibility
 *
 * Canonical Quran is a singleton store that is never deleted, and only one
 * corpus is ever accepted. A staging database that holds the reference corpus
 * keeps it until the staging database is reset; an approved corpus later needs
 * a fresh database or a recorded correction of every Ayah.
 *
 * Everything this module prints is identifiers and counts — never text.
 */

/** The Tanzil source's registered code. */
export const QURAN_REFERENCE_SOURCE_CODE = 'tanzil-uthmani-1.1';

/** The owner decision every activation names. */
export const QURAN_REFERENCE_DECISION =
  'OWNER-DECISION-2026-11-06-R2-QURAN-REFERENCE-PREVIEW';

/** Irfan-ul-Quran's two provenance sources, one per staged language. */
export const IRFAN_PROVENANCE = Object.freeze({
  ur: { code: 'irfan-ul-quran-ur', title: 'Irfan-ul-Quran (Urdu)' },
  en: { code: 'irfan-ul-quran-en', title: 'Irfan-ul-Quran (English)' },
} as const);

export type IrfanLanguage = keyof typeof IRFAN_PROVENANCE;

/** The evidence column's width (R2 migration). */
const EVIDENCE_MAX = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An internal account or session identifier (the operator commands' `ACCOUNT_ID` shape). */
const ACCOUNT = /^[A-Za-z0-9_-]{8,36}$/;

/** A SQL Server Unicode literal. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;
const nullable = (value: string | null) => (value === null ? 'NULL' : n(value));

/** Refuses unless the CONNECTED database is staging or a disposable proof database. */
async function assertConnectedDatabase(
  sql: SqlSession,
): Promise<'staging' | 'disposable'> {
  const rows = await sql.query<{ name: string | null }>('SELECT DB_NAME() AS [name];');
  const name = rows.length === 1 ? rows[0]?.name : null;
  if (typeof name !== 'string')
    throw new Error('The connected database could not be identified; refusing.');
  return assertMigrationProofDatabase(name);
}

/**
 * The Tanzil source's evidence: what it is, where it came from, its licence,
 * the exact digests of both files, the decision that admits it — and the
 * text's own copyright block, verbatim, which its licence requires in every
 * copy.
 */
export function referenceEvidence(corpus: TanzilCorpus): string {
  const evidence = [
    `${corpus.title} - https://tanzil.net/ - Creative Commons Attribution 3.0, reproduced verbatim.`,
    `Text file SHA-256 ${corpus.textSha256}. Metadata: Tanzil Quran Metadata 1.0, (C) 2008-2009 Tanzil.info, cc-by, SHA-256 ${corpus.metadataSha256}; hizb derived from its 240 quarters.`,
    `${QURAN_REFERENCE_DECISION}: staging reference preview only; not reviewed by Minhaj-ul-Quran's religious authority for this platform.`,
    '---',
    corpus.notice,
  ].join('\n');
  if (evidence.length > EVIDENCE_MAX)
    throw new Error('The reference evidence is longer than the source record holds.');
  return evidence;
}

/** Irfan-ul-Quran's provenance evidence for one staged language. */
export function irfanEvidence(language: IrfanLanguage): string {
  return [
    'Irfan-ul-Quran - translation by Shaykh-ul-Islam Dr Muhammad Tahir-ul-Qadri. (C) Minhaj-ul-Quran International. Source: https://www.irfan-ul-quran.com/',
    `Taken from the staged, review-only revisions of migration source ${IRFAN_PROVENANCE[language].code} (OWNER-ATTESTATION-2026-10-27-PREADOPTION-STAGING), exactly as staged.`,
    `${QURAN_REFERENCE_DECISION}: staging reference preview only; not reviewed by Minhaj-ul-Quran's religious authority for this platform.`,
  ].join('\n');
}

/* ===========================================================================
 * State
 * ========================================================================= */

export interface ReferenceState {
  /** The Tanzil source's id, or null when it is not registered. */
  readonly sourceId: string | null;
  /** Whether that registration is exactly this corpus: authority, evidence and every Ayah. */
  readonly sourceMatches: boolean;
  /** Canonical ayat in the store, and how many came from the Tanzil source. */
  readonly canonicalAyat: number;
  readonly canonicalFromSource: number;
  /** The activation's source, or null when no corpus is active. */
  readonly activeSourceId: string | null;
}

export async function inspectReference(
  sql: SqlSession,
  corpus: TanzilCorpus,
): Promise<ReferenceState> {
  await assertConnectedDatabase(sql);
  const code = n(QURAN_REFERENCE_SOURCE_CODE);
  const [row] = await sql.query<{
    sourceId: string | null;
    authority: string | null;
    reference: string | null;
    sourceAyat: number | string;
    canonicalAyat: number | string;
    canonicalFromSource: number | string;
    activeSourceId: string | null;
  }>(`
    DECLARE @id NVARCHAR(36) = (SELECT [id] FROM [dbo].[QuranSource] WHERE [code] = ${code});
    SELECT
      @id AS [sourceId],
      (SELECT [authority] FROM [dbo].[QuranSource] WHERE [id] = @id) AS [authority],
      (SELECT [reference] FROM [dbo].[QuranSource] WHERE [id] = @id) AS [reference],
      (SELECT COUNT_BIG(*) FROM [dbo].[QuranSourceAyah] WHERE [sourceId] = @id) AS [sourceAyat],
      (SELECT COUNT_BIG(*) FROM [dbo].[Ayah]) AS [canonicalAyat],
      (SELECT COUNT_BIG(*) FROM [dbo].[Ayah] WHERE [sourceId] = @id) AS [canonicalFromSource],
      (SELECT [sourceId] FROM [dbo].[QuranActivation] WHERE [id] = 1) AS [activeSourceId];
  `);
  if (row === undefined)
    throw new Error('The Quran reference state could not be read; refusing.');
  return {
    sourceId: row.sourceId,
    sourceMatches:
      row.sourceId !== null &&
      row.authority === 'reference' &&
      row.reference === referenceEvidence(corpus) &&
      Number(row.sourceAyat) === corpus.ayat.length,
    canonicalAyat: Number(row.canonicalAyat),
    canonicalFromSource: Number(row.canonicalFromSource),
    activeSourceId: row.activeSourceId,
  };
}

/* ===========================================================================
 * Owner writes
 * ========================================================================= */

/** Rows per INSERT … VALUES — SQL Server's own ceiling is 1,000. */
const ROWS_PER_INSERT = 500;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
}

/**
 * Registers the Tanzil source, its Surahs and every Ayah — exactly as read —
 * in ONE transaction, so a source is either whole or absent.
 */
export async function registerReferenceSource(
  sql: SqlSession,
  corpus: TanzilCorpus,
): Promise<string> {
  await assertConnectedDatabase(sql);
  const id = randomUUID();
  const surahs = corpus.surahs.map(
    (surah) =>
      `(${n(id)}, ${surah.number}, ${surah.ayahCount}, ${n(surah.revelation)}, ${n(surah.nameArabic)})`,
  );
  const ayat = chunks(corpus.ayat, ROWS_PER_INSERT).map(
    (batch) =>
      `INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[hizb],[page],[sajdah],[text]) VALUES ${batch
        .map(
          (ayah) =>
            `(${n(id)}, ${ayah.surah}, ${ayah.ayah}, ${ayah.juz}, ${ayah.hizb}, ${ayah.page}, ${nullable(ayah.sajdah)}, ${n(ayah.text)})`,
        )
        .join(', ')};`,
  );
  await sql.query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script],[reference])
      VALUES (${n(id)}, ${n(QURAN_REFERENCE_SOURCE_CODE)}, N'reference', ${n(corpus.title)}, ${n(corpus.version)},
              N'utf-8', ${n(corpus.script)}, ${n(referenceEvidence(corpus))});
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic]) VALUES ${surahs.join(', ')};
    ${ayat.join('\n')}
    COMMIT TRANSACTION;
  `);
  return id;
}

/** Activates the accepted reference corpus — the owner's act, naming the decision and operator. */
export async function activateReference(
  sql: SqlSession,
  sourceId: string,
  operator: string,
): Promise<void> {
  await assertConnectedDatabase(sql);
  if (!UUID.test(sourceId) || !ACCOUNT.test(operator))
    throw new Error(
      'The source must be a generated identifier and the operator an account identifier.',
    );
  await sql.query(`
    INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy])
    VALUES (1, ${n(sourceId)}, ${n(`${QURAN_REFERENCE_DECISION}; operator ${operator}`)});
  `);
}

/**
 * The ONE live session of `operator` that holds an unexpired
 * `quran-canonical-edit` step-up grant — the grant the operator just earned on
 * the admin Quran screen — or a refusal. A READ: no grant is created here, and
 * the runtime child re-verifies the permission, posture and grant through
 * Identity before the database procedure checks them once more.
 */
export async function liveCanonicalSession(
  sql: SqlSession,
  operator: string,
): Promise<string> {
  if (!ACCOUNT.test(operator))
    throw new Error('The operator must be an account identifier.');
  const rows = await sql.query<{ sessionId: string }>(`
    SELECT DISTINCT g.[sessionId]
    FROM [dbo].[StepUpGrant] g
    JOIN [dbo].[Session] s ON s.[id] = g.[sessionId] AND s.[userId] = g.[userId]
      AND s.[expiresAt] > SYSUTCDATETIME()
    WHERE g.[userId] = ${n(operator)} AND g.[purpose] = N'quran-canonical-edit'
      AND g.[expiresAt] > SYSUTCDATETIME();
  `);
  const [only] = rows;
  if (only === undefined || rows.length !== 1)
    throw new Error(
      rows.length === 0
        ? 'The operator holds no live quran-canonical-edit step-up; confirm it on the admin Quran screen first.'
        : 'The operator holds live quran-canonical-edit step-ups on several sessions; name one with --session.',
    );
  return only.sessionId;
}

/* ===========================================================================
 * The whole import
 * ========================================================================= */

export interface ReferenceImportSummary {
  readonly sourceId: string;
  readonly surahs: number;
  readonly ayat: number;
  readonly textSha256: string;
  /** `registered` now, or `kept` from an earlier interrupted import. */
  readonly source: 'registered' | 'kept';
  /** `accepted` now, or `kept` from an earlier interrupted import. */
  readonly corpus: 'accepted' | 'kept';
  readonly activated: true;
}

/**
 * Registers, accepts and activates the reference corpus — resuming an import
 * an earlier run left part-way (a registered source, an accepted corpus), and
 * REFUSING, with nothing changed, when the corpus is already active or any
 * other corpus exists.
 */
export async function importQuranReference(input: {
  /** The OWNER (migration principal) session, already behind the caller's target guard. */
  readonly owner: SqlSession;
  /** The RUNTIME principal's connection to the same database, proven by the same guard. */
  readonly runtime: SqlServerConnection;
  readonly corpus: TanzilCorpus;
  /** The operator's account and the session their `quran-canonical-edit` step-up is bound to. */
  readonly operator: string;
  readonly session: string;
  readonly environment: Record<string, string | undefined>;
}): Promise<ReferenceImportSummary> {
  const { owner, corpus } = input;
  if (!ACCOUNT.test(input.operator) || !ACCOUNT.test(input.session))
    throw new Error('The operator and session must be account and session identifiers.');
  const before = await inspectReference(owner, corpus);

  if (before.activeSourceId !== null)
    throw new Error(
      before.activeSourceId === before.sourceId
        ? 'The Tanzil reference corpus is already accepted and active; nothing was changed.'
        : 'Another Quran corpus is active; nothing was changed.',
    );
  if (before.canonicalAyat > 0 && before.canonicalFromSource !== before.canonicalAyat)
    throw new Error('Another canonical Quran corpus exists; nothing was changed.');
  if (before.sourceId !== null && !before.sourceMatches)
    throw new Error(
      `A source '${QURAN_REFERENCE_SOURCE_CODE}' is registered with different evidence or text; nothing was changed.`,
    );

  const sourceId = before.sourceId ?? (await registerReferenceSource(owner, corpus));

  if (before.canonicalAyat === 0) {
    // The operator's candidate: the corpus exactly as read from the files. The
    // procedure compares it byte for byte against the registered rows and then
    // copies the REGISTERED text, never the candidate.
    const work = await mkdtemp(path.join(os.tmpdir(), 'minhaj-quran-reference-'));
    try {
      const candidate = path.join(work, 'candidate.json');
      await writeFile(
        candidate,
        JSON.stringify(
          corpus.ayat.map(({ surah, ayah, juz, text }) => ({ surah, ayah, juz, text })),
        ),
        'utf8',
      );
      await runMigrationTool({
        runtime: input.runtime,
        entry: QURAN_REFERENCE_TOOL_ENTRY,
        args: [
          'accept',
          '--operator',
          input.operator,
          '--session',
          input.session,
          '--source',
          sourceId,
          '--candidate',
          candidate,
        ],
        environment: input.environment,
        label: 'Quran reference acceptance',
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  const accepted = await inspectReference(owner, corpus);
  if (
    accepted.canonicalAyat !== corpus.ayat.length ||
    accepted.canonicalFromSource !== corpus.ayat.length
  )
    throw new Error(
      'The canonical corpus is not the reference source after acceptance; not activated.',
    );

  await activateReference(owner, sourceId, input.operator);
  const after = await inspectReference(owner, corpus);
  if (after.activeSourceId !== sourceId)
    throw new Error('The reference corpus is not active after activation.');

  return {
    sourceId,
    surahs: corpus.surahs.length,
    ayat: accepted.canonicalAyat,
    textSha256: corpus.textSha256,
    source: before.sourceId === null ? 'registered' : 'kept',
    corpus: before.canonicalAyat === 0 ? 'accepted' : 'kept',
    activated: true,
  };
}

/* ===========================================================================
 * Irfan-ul-Quran
 * ========================================================================= */

/**
 * Registers (or finds) Irfan-ul-Quran's two provenance sources — authority
 * `reference`, no ayat of their own: a layered work names its source, and a
 * translation's source is a provenance record (DOMAIN_MODEL.md §8). A source
 * already registered with different evidence is refused, never edited.
 */
export async function registerIrfanProvenance(
  sql: SqlSession,
): Promise<Readonly<Record<IrfanLanguage, string>>> {
  await assertConnectedDatabase(sql);
  const ids: Partial<Record<IrfanLanguage, string>> = {};
  for (const language of Object.keys(IRFAN_PROVENANCE) as IrfanLanguage[]) {
    const { code, title } = IRFAN_PROVENANCE[language];
    const evidence = irfanEvidence(language);
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
      ids[language] = existing.id;
      continue;
    }
    const id = randomUUID();
    await sql.query(`
      INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script],[reference])
      VALUES (${n(id)}, ${n(code)}, N'reference', ${n(title)}, N'staged-migration', N'utf-8', NULL, ${n(evidence)});
    `);
    ids[language] = id;
  }
  return { ur: ids.ur ?? '', en: ids.en ?? '' };
}

/**
 * Registers Irfan-ul-Quran's provenance, then imports its staged translations
 * through Quran's administrative service in the runtime child — which reports,
 * per language, the Surahs saved, unchanged and skipped (with the reason), and
 * whether the work is published. Refused until a canonical corpus exists,
 * because a translation's text hangs on canonical ayat.
 */
export async function importIrfanTranslations(input: {
  readonly owner: SqlSession;
  readonly runtime: SqlServerConnection;
  readonly operator: string;
  readonly environment: Record<string, string | undefined>;
}): Promise<Record<string, unknown>> {
  if (!ACCOUNT.test(input.operator))
    throw new Error('The operator must be an account identifier.');
  await assertConnectedDatabase(input.owner);
  const [row] = await input.owner.query<{ ayat: number | string }>(
    'SELECT COUNT_BIG(*) AS [ayat] FROM [dbo].[Ayah];',
  );
  if (row === undefined || Number(row.ayat) === 0)
    throw new Error(
      'No canonical Quran corpus exists yet; import the reference corpus first.',
    );

  const sources = await registerIrfanProvenance(input.owner);
  return runMigrationTool({
    runtime: input.runtime,
    entry: QURAN_REFERENCE_TOOL_ENTRY,
    args: [
      'translations',
      '--operator',
      input.operator,
      '--source-ur',
      sources.ur,
      '--source-en',
      sources.en,
    ],
    environment: input.environment,
    label: 'Irfan-ul-Quran translation import',
  });
}
