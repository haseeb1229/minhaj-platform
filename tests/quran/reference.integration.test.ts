import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { QuranPublicReaderPort } from '../../packages/contracts/src/quran/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  importQuranReference,
  importReferenceTranslations,
  importSurahNames,
  inspectReference,
  liveCanonicalSession,
  QURAN_REFERENCE_SOURCE_CODE,
  registerTranslationProvenance,
  TRANSLATION_PROVENANCE,
} from '../../packages/database/src/lifecycle/quran-reference.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  readTanzilCorpus,
  readTanzilSurahNames,
  sha256Hex,
  type TanzilCorpus,
} from '../../packages/database/src/lifecycle/tanzil-corpus.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { accountWith, count, grantFor, n, sessionFor } from './fixture-sql.ts';
import {
  fixtureMeaning,
  fixtureTransliteration,
  tanzilFixture,
  utf8,
} from './tanzil-fixture.ts';

/**
 * Rebaseline R2 — the Quran REFERENCE authority over a REAL SQL Server, end to
 * end, with a SYNTHETIC Tanzil-shaped corpus (`./tanzil-fixture.ts`; nothing
 * here is the Quran).
 *
 * WHAT ONLY THE DATABASE AND THE REAL TOOLING CAN PROVE:
 *
 *   - a reference source must carry its evidence, and the runtime principal
 *     still writes no source and no activation;
 *   - the import registers the source as the OWNER, has the corpus accepted by
 *     Quran's canonical service in a CHILD PROCESS running as the RUNTIME
 *     principal under the operator's live `quran.editCanonical` grant and
 *     `quran-canonical-edit` step-up, activates it as the owner, and refuses a
 *     second run with nothing changed;
 *   - the reader reports a reference corpus ONLY where the deployment admits
 *     it — inactive everywhere else, search and sitemap included — and even
 *     admitted, never offers it to a sitemap;
 *   - fixture and approved activations refuse reference text, and a fixture
 *     correction never enters an active reference corpus;
 *   - the translation import registers Irfan-ul-Quran's provenance and, with no
 *     staged revision to read, saves and publishes nothing — it reports every
 *     Surah skipped instead;
 *   - the translation import (Quran Part 6) saves a staged revision's texts
 *     WITH its translator's notes, exactly and in order, changes nothing on a
 *     second run, replaces a note a later revision changes, leaves the notes
 *     held alone for a revision staged before notes were read (`notes: null`),
 *     and skips — never repairs — a Surah whose note answers no mark;
 *   - the Surah names import (Quran Part 2) refuses metadata the corpus was not
 *     registered with and an operator without `quran.administer`, saves each
 *     English name and meaning verbatim through the admin service with its
 *     audit record, keeps a name an operator recorded and every other locale's
 *     name, and changes nothing on a second run.
 */

const live = databaseConfigured ? describe : describe.skip;

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** A staged quran.translation payload's notes, as Migration stages them. */
interface StagedNote {
  readonly ayah: number;
  readonly marker: string;
  readonly text: string;
}

/** Synthetic translation words for one Ayah of Surah 1 — never the Quran. */
const fixtureWords = (language: 'ur' | 'en', ayah: number, mark = '') =>
  language === 'ur'
    ? `NON_QURAN_FIXTURE ترجمہ ${String(ayah)}${mark}`
    : `NON_QURAN_FIXTURE rendering ${String(ayah)}${mark}`;

/** A QuranEnc registration as the catalogue makes it: its key, host and Surah 1's address. */
const SAHEEH = {
  key: 'quranenc-english-saheeh',
  host: 'quranenc.com',
  url: 'https://quranenc.com/api/v1/translation/sura/english_saheeh/1',
} as const;

/**
 * Stages ONE review-only revision of Surah 1 for a translation's migration
 * source — Irfan-ul-Quran's of the language unless another is named — through
 * the same tables the pipeline writes: the source (once), a run, the record
 * (once), a raw snapshot and the staged revision.
 */
async function stageSurahOne(
  admin: SqlSession,
  input: {
    readonly operator: string;
    readonly language: 'ur' | 'en';
    readonly revision: number;
    readonly ayat: readonly string[];
    /** Omitted: a payload staged before notes were read. */
    readonly notes?: readonly StagedNote[];
    /** Another migration source than Irfan-ul-Quran's (QuranEnc's). */
    readonly source?: {
      readonly key: string;
      readonly host: string;
      readonly url: string;
    };
    /** The source's edition, where it versions its text (QuranEnc). */
    readonly edition?: {
      readonly key: string;
      readonly version: string;
      readonly lastUpdate: number;
    };
  },
): Promise<void> {
  const key = input.source?.key ?? `irfan-ul-quran-${input.language}`;
  const host = input.source?.host ?? 'www.irfan-ul-quran.com';
  const url =
    input.source?.url ??
    `https://www.irfan-ul-quran.com/english/Surah-al-Fatihah-with-english-translation`;
  const [held] = await admin.query<{ source: string | null; record: string | null }>(`
    SELECT (SELECT [id] FROM [dbo].[MigrationSource] WHERE [key] = ${n(key)}) AS [source],
           (SELECT r.[id] FROM [dbo].[MigrationRecord] r JOIN [dbo].[MigrationSource] s ON s.[id] = r.[sourceId]
              WHERE s.[key] = ${n(key)}) AS [record];`);
  const source = held?.source ?? randomUUID();
  const record = held?.record ?? randomUUID();
  const run = randomUUID();
  const snapshot = randomUUID();
  const body = `<html><!-- NON_QURAN_FIXTURE ${key} revision ${String(input.revision)} --></html>`;
  const payload = JSON.stringify({
    kind: 'quran.translation',
    work: 'NON_QURAN_FIXTURE work',
    languageCode: input.language,
    surah: 1,
    ayat: input.ayat.map((text, index) => ({ ayah: index + 1, text })),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.edition === undefined ? {} : { edition: input.edition }),
    legacyIdentifier: `surah-1-${input.language}`,
  });
  const provenance = `N'irfan-ul-quran-translation', N'1', N'cheerio-irfan-ul-quran-translation', N'3', N'1', N'proof'`;
  await admin.query(`BEGIN TRY BEGIN TRAN;
    ${
      held?.source === null || held?.source === undefined
        ? `INSERT INTO [dbo].[MigrationSource] ([id],[key],[name],[authorityKind],[accessMethod],[contentKind],[baseUrl],[defaultLanguageCode],[minIntervalMs],[maxConcurrency],[maxAttempts],[timeoutMs],[maxBodyBytes],[maxRedirects],[state],[createdAt],[createdByUserId],[updatedAt],[updatedByUserId],[authorisationReference],[authorisedOn])
             VALUES (${n(source)}, ${n(key)}, N'NON_QURAN_FIXTURE source', N'authorised', N'http', N'quran.translation', ${n(`https://${host}/`)}, ${n(input.language)}, 1000, 1, 3, 10000, 1048576, 2, N'active', SYSUTCDATETIME(), ${n(input.operator)}, SYSUTCDATETIME(), ${n(input.operator)}, N'NON-QURAN-FIXTURE-AUTHORISATION', '2026-11-06');
           INSERT INTO [dbo].[MigrationSourceHost] ([sourceId],[host]) VALUES (${n(source)}, ${n(host)});`
        : ''
    }
    INSERT INTO [dbo].[MigrationRun] ([id],[sourceId],[operatorUserId],[state],[adapterKey],[adapterVersion],[parserKey],[parserVersion],[normalizerVersion],[codeRevision],[discoveryComplete],[startedAt])
      VALUES (${n(run)}, ${n(source)}, ${n(input.operator)}, N'open', ${provenance}, 1, SYSUTCDATETIME());
    ${
      held?.record === null || held?.record === undefined
        ? `INSERT INTO [dbo].[MigrationRecord] ([id],[sourceId],[externalKey],[originalUrl],[contentKind],[status],[observed],[firstObservedRunId],[lastObservedRunId],[createdAt],[updatedAt])
             VALUES (${n(record)}, ${n(source)}, ${n(url)}, ${n(url)}, N'quran.translation', N'staged', N'present', ${n(run)}, ${n(run)}, SYSUTCDATETIME(), SYSUTCDATETIME());`
        : ''
    }
    INSERT INTO [dbo].[MigrationRawSnapshot] ([id],[sourceId],[recordId],[runId],[requestedUrl],[finalUrl],[httpStatus],[contentType],[body],[byteSize],[checksum],[fetchedAt],[fetcherKey],[fetcherVersion],[personalData])
      VALUES (${n(snapshot)}, ${n(source)}, ${n(record)}, ${n(run)}, ${n(url)}, ${n(url)}, 200, N'text/html; charset=utf-8', ${`0x${Buffer.from(body, 'utf8').toString('hex')}`}, ${String(Buffer.byteLength(body))}, N'${sha256(body)}', SYSUTCDATETIME(), N'proof', N'1', N'none');
    INSERT INTO [dbo].[MigrationStagedRecord] ([id],[recordId],[snapshotId],[runId],[revision],[contentKind],[title],[titleKey],[languageCode],[payload],[payloadChecksum],[adapterKey],[adapterVersion],[parserKey],[parserVersion],[normalizerVersion],[codeRevision],[inputChecksum],[producedAt],[validation],[personalData])
      VALUES (${n(randomUUID())}, ${n(record)}, ${n(snapshot)}, ${n(run)}, ${String(input.revision)}, N'quran.translation', N'NON_QURAN_FIXTURE work · 1', N'non quran fixture work 1', ${n(input.language)}, ${n(payload)}, N'${sha256(payload)}', ${provenance}, N'${sha256(body)}', SYSUTCDATETIME(), N'valid', N'none');
    UPDATE [dbo].[MigrationRun] SET [state] = N'completed', [endedAt] = SYSUTCDATETIME() WHERE [id] = ${n(run)};
    COMMIT TRAN; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;`);
}

const sqlNumber = async (promise: Promise<unknown>): Promise<number | null> => {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : null;
  }
  return null;
};

/** A complete privileged posture — a verified second factor, confirmed recovery codes. */
async function privilegedPosture(admin: SqlSession, accountId: string): Promise<void> {
  await admin.query(`
    UPDATE [dbo].[User] SET [twoFactorEnabled] = 1 WHERE [id] = ${n(accountId)};
    INSERT INTO [dbo].[TwoFactor] ([secret],[backupCodes],[userId],[verified])
      VALUES (N'not-a-real-secret-quran-reference', N'not-real-codes-quran-reference', ${n(accountId)}, 1);
    INSERT INTO [dbo].[PrivilegedSecurityPosture] ([userId],[secondFactorVerifiedAt],[recoveryCodesIssuedAt],[recoveryCodesConfirmedAt])
      VALUES (${n(accountId)}, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);
}

live('R2 Quran reference preview against real SQL Server', () => {
  let db: DisposableDatabase;
  let app: SqlSession;
  /** The owner session the import uses: one large registration batch needs time. */
  let owner: SqlSession;
  let runtime: SqlServerConnection;
  let corpus: TanzilCorpus;
  let operator: string;
  let sourceId: string;
  let admitted: QuranPublicReaderPort;
  let refused: QuranPublicReaderPort;

  beforeAll(async () => {
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const target = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${target.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    runtime = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );
    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    app = await openSession(runtime);
    owner = await openSession(parseSqlServerUrl(db.url), { requestTimeoutMs: 300_000 });
    process.env.DATABASE_URL = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    admitted = database.createQuranPublicReader({ admitReference: true });
    refused = database.createQuranPublicReader({ admitReference: false });

    const fixture = tanzilFixture();
    const text = utf8(fixture.text);
    corpus = readTanzilCorpus({
      text,
      metadata: utf8(fixture.metadata),
      expectedSha256: sha256Hex(text),
    });
    operator = await accountWith(db.admin, [
      'quran.editCanonical',
      'quran.read',
      'quran.administer',
      'migration.read',
    ]);
    await privilegedPosture(db.admin, operator);
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await owner?.close();
    await db?.close();
  }, 120_000);

  it('requires a reference source to carry its evidence, and the runtime writes none', async () => {
    expect(
      await sqlNumber(
        db.admin.query(
          `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding]) VALUES (${n(randomUUID())}, N'proof-reference-bare', N'reference', N'NON_QURAN_FIXTURE', N'1', N'utf-8');`,
        ),
      ),
    ).toBe(547);
    expect(
      await sqlNumber(
        app.query(
          `INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES (${n(randomUUID())}, N'proof-reference-runtime', N'reference', N'NON_QURAN_FIXTURE', N'1', N'utf-8', N'evidence');`,
        ),
      ),
    ).toBe(229);
    expect(
      await sqlNumber(
        app.query(
          `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, N'${randomUUID()}', N'runtime');`,
        ),
      ),
    ).toBe(229);
  });

  it('refuses acceptance without a live quran-canonical-edit step-up, and resumes afterwards', async () => {
    await expect(liveCanonicalSession(db.admin, operator)).rejects.toThrow(
      /no live quran-canonical-edit step-up/,
    );
    // A session with a grant for ANOTHER purpose is not one.
    const session = await sessionFor(db.admin, operator);
    await grantFor(db.admin, operator, session, 'privilege-administration');
    await expect(
      importQuranReference({
        owner,
        runtime,
        corpus,
        operator,
        session,
        environment: process.env,
      }),
    ).rejects.toThrow(/Quran reference acceptance failed/);
    // The source stayed registered, and nothing canonical was written.
    const state = await inspectReference(db.admin, corpus);
    expect(state.sourceId).not.toBeNull();
    expect(state.sourceMatches).toBe(true);
    expect(state.canonicalAyat).toBe(0);
    expect(state.activeSourceId).toBeNull();
  }, 300_000);

  it('accepts and activates the corpus as the runtime principal under the live grant', async () => {
    const session = await sessionFor(db.admin, operator);
    await grantFor(db.admin, operator, session, 'quran-canonical-edit');
    expect(await liveCanonicalSession(db.admin, operator)).toBe(session);

    const summary = await importQuranReference({
      owner,
      runtime,
      corpus,
      operator,
      session,
      environment: process.env,
    });
    expect(summary).toMatchObject({
      surahs: 114,
      ayat: 6236,
      source: 'kept',
      corpus: 'accepted',
      activated: true,
    });
    sourceId = summary.sourceId;

    const [row] = await db.admin.query<{
      authority: string;
      ayat: number;
      runs: number;
    }>(`
      SELECT (SELECT [authority] FROM [dbo].[QuranSource] WHERE [code] = ${n(QURAN_REFERENCE_SOURCE_CODE)}) AS [authority],
             (SELECT COUNT_BIG(*) FROM [dbo].[Ayah] a JOIN [dbo].[QuranSourceAyah] s
                ON s.[sourceId] = a.[sourceId] AND s.[surahNumber] = a.[surahNumber] AND s.[ayahNumber] = a.[ayahNumber]
               AND CAST(s.[text] AS VARBINARY(8000)) = CAST(a.[text] AS VARBINARY(8000))
               AND ISNULL(s.[hizb], 0) = ISNULL(a.[hizb], 0) AND ISNULL(s.[page], 0) = ISNULL(a.[page], 0)) AS [ayat],
             (SELECT COUNT_BIG(*) FROM [dbo].[QuranVerificationRun] WHERE [kind] = N'corpus-acceptance' AND [outcome] = N'passed' AND [actorId] = ${n(operator)}) AS [runs];
    `);
    expect({ ...row, ayat: Number(row?.ayat), runs: Number(row?.runs) }).toEqual({
      authority: 'reference',
      ayat: 6236,
      runs: 1,
    });

    await expect(
      importQuranReference({
        owner,
        runtime,
        corpus,
        operator,
        session,
        environment: process.env,
      }),
    ).rejects.toThrow(/already accepted and active; nothing was changed/);
  }, 600_000);

  it('is inactive everywhere on a deployment that does not admit it', async () => {
    expect(await refused.availability()).toEqual({ active: false });
    expect(await refused.surahs()).toEqual([]);
    expect(await refused.surah(1)).toBeNull();
    expect(await refused.ayah({ surah: 1, ayah: 1 })).toBeNull();
    expect(await refused.juzList()).toEqual([]);
    expect(await refused.translations()).toEqual([]);
    expect(await refused.searchAyahScopes(null, 10)).toEqual([]);
    expect(await refused.searchAyahRecords([{ surah: 1, ayah: 1 }])).toEqual([]);
    expect(await refused.publicAyahTargets([{ surah: 1, ayah: 1 }])).toEqual([]);
    expect(await refused.ayahSitemap(0, 10)).toEqual([]);
    expect(await refused.ayahSitemapCount()).toBe(0);
  });

  it('is a reference corpus where admitted — readable and searchable, never in a sitemap', async () => {
    expect(await admitted.availability()).toEqual({ active: true, mode: 'reference' });
    expect(await admitted.surahs()).toHaveLength(114);
    const ayah = await admitted.ayah({ surah: 1, ayah: 1 });
    expect(ayah?.text).toBe(corpus.ayat[0]?.text);
    expect((await admitted.searchAyahScopes(null, 10)).length).toBe(10);
    expect(await admitted.ayahSitemap(0, 10)).toEqual([]);
    expect(await admitted.ayahSitemapCount()).toBe(0);
  });

  it('keeps fixture and approved activations, and fixture corrections, away from reference text', async () => {
    const copyOf = async (authority: 'fixture' | 'approved') => {
      const id = randomUUID();
      await db.admin.query(`
        INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[reference])
          VALUES (${n(id)}, ${n(`proof-${authority}-${id.slice(0, 8)}`)}, ${n(authority)}, N'NON_QURAN_FIXTURE', N'1', N'utf-8',
                  ${authority === 'approved' ? "N'urn:example:evidence'" : 'NULL'});
        INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount])
          SELECT ${n(id)}, [number], [ayahCount] FROM [dbo].[QuranSourceSurah] WHERE [sourceId] = ${n(sourceId)};
        INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text])
          SELECT ${n(id)}, [surahNumber], [ayahNumber], [juzNumber], [text] FROM [dbo].[QuranSourceAyah] WHERE [sourceId] = ${n(sourceId)};
      `);
      return id;
    };
    const fixture = await copyOf('fixture');
    const approved = await copyOf('approved');
    const activate = (id: string) =>
      db.admin.query(
        `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, ${n(id)}, N'proof');`,
      );

    // Beneath the ACTIVE reference corpus, fixture text is never a correction.
    const session = await sessionFor(db.admin, operator);
    const grant = await grantFor(db.admin, operator, session, 'quran-canonical-edit');
    const text = corpus.ayat[0]?.text ?? '';
    const correct = (version: number, from: string) =>
      db.admin.query(`
        EXEC [dbo].[QuranCorrectAyah] @runId=${n(randomUUID())}, @surah=1, @ayah=1, @expectedVersion=${version},
          @sourceId=${n(from)}, @reviewedText=${n(text)}, @reason=N'proof', @actorId=${n(operator)},
          @sessionId=${n(session)}, @stepUpGrantId=${n(grant)}, @at='2026-11-06T00:00:00';
      `);
    expect(await sqlNumber(correct(1, fixture))).toBe(51198);

    await db.admin.query('DELETE FROM [dbo].[QuranActivation];');
    expect(await sqlNumber(activate(approved))).toBe(51185);
    expect(await sqlNumber(activate(fixture))).toBe(51185);

    // With no activation a fixture correction is allowed — and then a reference
    // activation refuses the fixture text it would carry.
    await correct(1, fixture);
    expect(await sqlNumber(activate(sourceId))).toBe(51185);
    await correct(2, sourceId);
    await activate(sourceId);
    expect(await admitted.availability()).toEqual({ active: true, mode: 'reference' });
    expect(await count(db.admin, 'QuranActivation')).toBe(1);
  }, 300_000);

  it('registers every translation’s provenance once and, with nothing staged, creates and publishes nothing', async () => {
    const first = await registerTranslationProvenance(db.admin);
    expect(await registerTranslationProvenance(db.admin)).toEqual(first);
    const ids = [...first.values()].map(n).join(', ');
    const [row] = await db.admin.query<{ references: number; ayat: number }>(`
      SELECT COUNT_BIG(*) AS [references],
             (SELECT COUNT_BIG(*) FROM [dbo].[QuranSourceAyah] WHERE [sourceId] IN (${ids})) AS [ayat]
      FROM [dbo].[QuranSource] WHERE [id] IN (${ids}) AND [authority] = N'reference';
    `);
    expect([Number(row?.references), Number(row?.ayat)]).toEqual([
      TRANSLATION_PROVENANCE.length,
      0,
    ]);
    expect([...first.keys()]).toEqual(TRANSLATION_PROVENANCE.map((entry) => entry.code));

    const summary = (await importReferenceTranslations({
      owner,
      runtime,
      operator,
      environment: process.env,
    })) as {
      works: Record<
        string,
        { saved: number; skipped: unknown[]; published: boolean; workId: string | null }
      >;
    };
    expect(Object.keys(summary.works)).toEqual([...first.keys()]);
    for (const [code, report] of Object.entries(summary.works)) {
      expect(report.saved, code).toBe(0);
      expect(report.skipped, code).toHaveLength(114);
      expect(report.published, code).toBe(false);
      // No usable revision: no work is created.
      expect(report.workId, code).toBeNull();
    }
    expect(await count(db.admin, 'QuranTranslation')).toBe(0);
    expect(await admitted.translations()).toEqual([]);
  }, 300_000);

  it("imports a staged revision's texts with its translator's notes, exactly, and resumes", async () => {
    interface Report {
      saved: number;
      unchanged: number;
      notes: number;
      skipped: { surah: number; reason: string }[];
      published: boolean;
      workId: string;
    }
    type Summary = Record<'ur' | 'en', Report>;
    const translations = async (): Promise<Summary> => {
      const { works } = (await importReferenceTranslations({
        owner,
        runtime,
        operator,
        environment: process.env,
      })) as { works: Record<string, Report> };
      return {
        ur: works['irfan-ul-quran-ur'] as Report,
        en: works['irfan-ul-quran-en'] as Report,
      };
    };
    const notesHeld = async (workId: string) =>
      (await admitted.translationTexts(workId, 1, 1, 7)).flatMap((entry) =>
        entry.notes.map((note) => ({ ayah: entry.ayah, ...note })),
      );
    const urAyat = [1, 2, 3, 4, 5, 6, 7].map((ayah) =>
      fixtureWords('ur', ayah, ayah === 1 ? '٭' : ayah === 3 ? ' (1) آگے (2)' : ''),
    );
    const enAyat = [1, 2, 3, 4, 5, 6, 7].map((ayah) =>
      fixtureWords('en', ayah, ayah === 4 ? '*' : ''),
    );
    const urNotes: StagedNote[] = [
      { ayah: 1, marker: '٭', text: 'NON_QURAN_FIXTURE حاشیہ اول' },
      { ayah: 3, marker: '1:-', text: 'NON_QURAN_FIXTURE پہلا' },
      {
        ayah: 3,
        marker: '2:-',
        text: 'NON_QURAN_FIXTURE دوسرا\n\nNON_QURAN_FIXTURE پیراگراف',
      },
    ];
    // Ayah 2's note is the Ayah's as a whole (its text carries no mark); ayah
    // 4's opens with no mark and answers the one mark its text carries.
    const enNotes: StagedNote[] = [
      { ayah: 2, marker: '*', text: 'NON_QURAN_FIXTURE note on the ayah' },
      { ayah: 4, marker: '', text: 'NON_QURAN_FIXTURE unmarked note' },
    ];
    await stageSurahOne(db.admin, {
      operator,
      language: 'ur',
      revision: 1,
      ayat: urAyat,
      notes: urNotes,
    });
    await stageSurahOne(db.admin, {
      operator,
      language: 'en',
      revision: 1,
      ayat: enAyat,
      notes: enNotes,
    });

    const first = await translations();
    for (const language of ['ur', 'en'] as const) {
      expect(first[language], language).toMatchObject({
        saved: 1,
        unchanged: 0,
        published: true,
      });
      expect(first[language].skipped, language).toHaveLength(113);
    }
    expect([first.ur.notes, first.en.notes]).toEqual([3, 2]);
    const ordinals = (notes: readonly StagedNote[]) => {
      const seen = new Map<number, number>();
      return notes.map((note) => {
        const ordinal = (seen.get(note.ayah) ?? 0) + 1;
        seen.set(note.ayah, ordinal);
        return { ayah: note.ayah, ordinal, marker: note.marker, text: note.text };
      });
    };
    expect(await notesHeld(first.ur.workId)).toEqual(ordinals(urNotes));
    expect(await notesHeld(first.en.workId)).toEqual(ordinals(enNotes));
    expect(
      (await admitted.translationTexts(first.ur.workId, 1, 1, 7)).map(
        (entry) => entry.text,
      ),
    ).toEqual(urAyat);
    // The audit names how many notes, never their words.
    const audits = await db.admin.query<{ after: string }>(
      `SELECT [afterState] AS [after] FROM [dbo].[AuditLog] WHERE [action] = N'quran.translation.texts-saved';`,
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('NON_QURAN_FIXTURE');

    // A second run changes nothing.
    const second = await translations();
    for (const language of ['ur', 'en'] as const)
      expect(second[language], language).toMatchObject({
        saved: 0,
        unchanged: 1,
        notes: 0,
      });

    // A later revision that changes one note replaces the Ayah's notes.
    const changed = urNotes.map((note, index) =>
      index === 0 ? { ...note, text: 'NON_QURAN_FIXTURE حاشیہ نیا' } : note,
    );
    await stageSurahOne(db.admin, {
      operator,
      language: 'ur',
      revision: 2,
      ayat: urAyat,
      notes: changed,
    });
    const third = await translations();
    expect(third.ur).toMatchObject({ saved: 1, notes: 1 });
    expect(await notesHeld(first.ur.workId)).toEqual(ordinals(changed));

    // A revision staged before notes were read changes texts only: the notes
    // held stay as they are, even where the text it saves changes.
    const textOnly = urAyat.map((text, index) =>
      index === 4 ? `${text} NON_QURAN_FIXTURE` : text,
    );
    await stageSurahOne(db.admin, {
      operator,
      language: 'ur',
      revision: 3,
      ayat: textOnly,
    });
    const fourth = await translations();
    expect(fourth.ur).toMatchObject({ saved: 1, notes: 0 });
    expect(await notesHeld(first.ur.workId)).toEqual(ordinals(changed));
    expect((await admitted.translationTexts(first.ur.workId, 1, 5, 5))[0]?.text).toBe(
      textOnly[4],
    );

    // A note that answers no mark is never placed: the Surah is skipped and
    // nothing of it changes.
    const untied: StagedNote[] = [
      ...enNotes.slice(0, 1),
      { ayah: 4, marker: '**', text: 'NON_QURAN_FIXTURE untied note' },
    ];
    await stageSurahOne(db.admin, {
      operator,
      language: 'en',
      revision: 2,
      ayat: enAyat,
      notes: untied,
    });
    const fifth = await translations();
    expect(fifth.en).toMatchObject({ saved: 0, notes: 0 });
    expect(fifth.en.skipped).toContainEqual({ surah: 1, reason: 'notes-untied' });
    expect(await notesHeld(first.en.workId)).toEqual(ordinals(enNotes));
  }, 600_000);

  it('imports a QuranEnc translation with its footnotes, names its edition’s version, and follows a new edition', async () => {
    interface Report {
      saved: number;
      unchanged: number;
      notes: number;
      version: string | null;
      published: boolean;
      workId: string | null;
      skipped: { surah: number; reason: string }[];
    }
    const run = async () =>
      (
        (await importReferenceTranslations({
          owner,
          runtime,
          operator,
          environment: process.env,
        })) as { works: Record<string, Report> }
      ).works[SAHEEH.key];
    const saheeh = async () =>
      (await admitted.translations()).find((work) => work.slug === SAHEEH.key);
    const edition = { key: 'english_saheeh', version: '1.1.2', lastUpdate: 1750772247 };
    const ayat = [1, 2, 3, 4, 5, 6, 7].map((ayah) =>
      fixtureWords('en', ayah, ayah === 2 ? '[1] and [all] of it[2]' : ''),
    );
    const notes: StagedNote[] = [
      { ayah: 2, marker: '[1]', text: 'NON_QURAN_FIXTURE first footnote' },
      { ayah: 2, marker: '[2]', text: 'NON_QURAN_FIXTURE second footnote' },
    ];
    const stage = (revision: number, staged: typeof edition) =>
      stageSurahOne(db.admin, {
        operator,
        language: 'en',
        revision,
        ayat,
        notes,
        source: SAHEEH,
        edition: staged,
      });

    // A revision of ANOTHER QuranEnc translation's edition is never this work's.
    await stage(1, { ...edition, key: 'english_rwwad' });
    const refused = await run();
    expect(refused).toMatchObject({ saved: 0, workId: null, published: false });
    expect(refused?.skipped).toContainEqual({ surah: 1, reason: 'other-edition' });
    expect(await saheeh()).toBeUndefined();

    await stage(2, edition);
    const first = await run();
    expect(first).toMatchObject({
      saved: 1,
      notes: 2,
      version: '1.1.2',
      published: true,
    });
    expect(await saheeh()).toMatchObject({
      name: 'English Translation - Noor International Center',
      description: 'Issued by Noor International Center.',
      languageCode: 'en',
      attribution:
        'Translation: English — Noor International Center (Saheeh International), v1.1.2, via QuranEnc.com ' +
        '(https://quranenc.com/en/browse/english_saheeh). An external reference translation — not ' +
        "Minhaj-ul-Quran International's, and not reviewed by its religious authority.",
    });
    // The text exactly as staged — the bracketed interpolation "[all]" is
    // text — and each footnote beside it, opening with its own mark.
    const [held] = await admitted.translationTexts(first?.workId ?? '', 1, 2, 2);
    expect(held?.text).toBe(ayat[1]);
    expect(held?.notes.map(({ marker, text }) => ({ marker, text }))).toEqual(
      notes.map(({ marker, text }) => ({ marker, text })),
    );
    // Minhaj-ul-Quran's own translation stays first: the public list orders by slug.
    const slugs = (await admitted.translations()).map((work) => work.slug);
    expect(slugs.indexOf('irfan-ul-quran-en')).toBeGreaterThanOrEqual(0);
    expect(slugs.indexOf('irfan-ul-quran-en')).toBeLessThan(slugs.indexOf(SAHEEH.key));

    // A new edition staged: the same words, and the attribution names it.
    await stage(3, { ...edition, version: '1.1.3', lastUpdate: 1790000000 });
    expect(await run()).toMatchObject({ saved: 0, unchanged: 1, version: '1.1.3' });
    expect((await saheeh())?.attribution).toContain('v1.1.3, via QuranEnc.com');
  }, 600_000);

  it('imports the Surah names verbatim through the admin service, keeps an operator’s, and resumes', async () => {
    const metadata = utf8(tanzilFixture().metadata);
    const names = readTanzilSurahNames({
      metadata,
      expectedSha256: sha256Hex(metadata),
    });

    // A metadata file the corpus was NOT registered with changes nothing,
    // however well formed it is.
    const other = utf8(
      tanzilFixture().metadata.replace(
        'ename="NON_QURAN_FIXTURE meaning 9"',
        'ename="NON_QURAN_FIXTURE other meaning 9"',
      ),
    );
    await expect(
      importSurahNames({
        owner,
        runtime,
        names: readTanzilSurahNames({
          metadata: other,
          expectedSha256: sha256Hex(other),
        }),
        operator,
        environment: process.env,
      }),
    ).rejects.toThrow(/not the one the reference corpus was registered with/);
    expect(await count(db.admin, 'SurahName')).toBe(0);

    // An account without quran.administer saves nothing.
    const reader = await accountWith(db.admin, ['quran.read']);
    await expect(
      importSurahNames({
        owner,
        runtime,
        names,
        operator: reader,
        environment: process.env,
      }),
    ).rejects.toThrow(/Quran Surah names import failed/);
    expect(await count(db.admin, 'SurahName')).toBe(0);

    // An operator's own English name for Surah 2 is kept; an Urdu name for
    // Surah 3 is carried over beside the imported English one.
    await db.admin.query(`
      INSERT INTO [dbo].[SurahName] ([surahNumber],[locale],[name]) VALUES
        (2, N'en', N'NON_QURAN_FIXTURE operator name'),
        (3, N'ur', N'NON_QURAN_FIXTURE اردو نام');
    `);

    const first = (await importSurahNames({
      owner,
      runtime,
      names,
      operator,
      environment: process.env,
    })) as { saved: number; unchanged: number; kept: unknown[] };
    expect(first).toMatchObject({ saved: 113, unchanged: 0 });
    expect(first.kept).toEqual([{ surah: 2, reason: 'operator-name' }]);

    const surahs = await admitted.surahs();
    const byNumber = new Map(surahs.map((surah) => [surah.number, surah]));
    expect(byNumber.get(1)).toMatchObject({
      names: { en: fixtureTransliteration(1) },
      meanings: { en: fixtureMeaning(1) },
    });
    expect(byNumber.get(6)?.names.en).toBe("NON_QURAN_FIXTURE_Aa'-6");
    expect(byNumber.get(2)?.names).toEqual({ en: 'NON_QURAN_FIXTURE operator name' });
    expect(byNumber.get(2)?.meanings).toEqual({});
    expect(byNumber.get(3)?.names).toEqual({
      en: fixtureTransliteration(3),
      ur: 'NON_QURAN_FIXTURE اردو نام',
    });
    const [audit] = await db.admin.query<{ saved: number; actors: number }>(`
      SELECT COUNT_BIG(*) AS [saved], COUNT(DISTINCT [actorId]) AS [actors]
      FROM [dbo].[AuditLog] WHERE [action] = N'quran.surah.names-saved';
    `);
    expect([Number(audit?.saved), Number(audit?.actors)]).toEqual([113, 1]);

    // A second run changes nothing.
    const second = (await importSurahNames({
      owner,
      runtime,
      names,
      operator,
      environment: process.env,
    })) as { saved: number; unchanged: number; kept: unknown[] };
    expect(second).toMatchObject({ saved: 0, unchanged: 113 });
    expect(second.kept).toEqual([{ surah: 2, reason: 'operator-name' }]);
  }, 600_000);
});
