import { randomUUID } from 'node:crypto';

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
  importIrfanTranslations,
  importQuranReference,
  importSurahNames,
  inspectReference,
  liveCanonicalSession,
  QURAN_REFERENCE_SOURCE_CODE,
  registerIrfanProvenance,
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
 *   - the Surah names import (Quran Part 2) refuses metadata the corpus was not
 *     registered with and an operator without `quran.administer`, saves each
 *     English name and meaning verbatim through the admin service with its
 *     audit record, keeps a name an operator recorded and every other locale's
 *     name, and changes nothing on a second run.
 */

const live = databaseConfigured ? describe : describe.skip;

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

  it('registers Irfan-ul-Quran once and, with nothing staged, saves and publishes nothing', async () => {
    const first = await registerIrfanProvenance(db.admin);
    expect(await registerIrfanProvenance(db.admin)).toEqual(first);
    const [row] = await db.admin.query<{ references: number; ayat: number }>(`
      SELECT COUNT_BIG(*) AS [references],
             (SELECT COUNT_BIG(*) FROM [dbo].[QuranSourceAyah] WHERE [sourceId] IN (${n(first.ur)}, ${n(first.en)})) AS [ayat]
      FROM [dbo].[QuranSource] WHERE [id] IN (${n(first.ur)}, ${n(first.en)}) AND [authority] = N'reference';
    `);
    expect([Number(row?.references), Number(row?.ayat)]).toEqual([2, 0]);

    const summary = (await importIrfanTranslations({
      owner,
      runtime,
      operator,
      environment: process.env,
    })) as Record<string, { saved: number; skipped: unknown[]; published: boolean }>;
    for (const language of ['ur', 'en']) {
      expect(summary[language]?.saved, language).toBe(0);
      expect(summary[language]?.skipped, language).toHaveLength(114);
      expect(summary[language]?.published, language).toBe(false);
    }
    expect(await admitted.translations()).toEqual([]);
  }, 300_000);

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
