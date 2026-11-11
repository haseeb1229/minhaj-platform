import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  NARRATION_TIMING_SHA256,
  importNarrationAlignment,
  narrationAlignmentEvidence,
  registerRecitationProvenance,
} from '../../packages/database/src/lifecycle/quran-recitations.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { QuranPersistencePort } from '../../packages/contracts/src/quran/index.ts';
import type { QuranReferenceRunner } from '../../apps/web/src/composition/quran-reference-runner.ts';
import type * as Runtime from '../../scripts/quran/recitations-runtime.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { accountWith, asset, count, n, NEUTRAL } from './fixture-sql.ts';
import { EXCERPT_AYAH_COUNTS, wholeFile } from './narration-timing-fixture.ts';

/**
 * Quran translation audio — the narration's alignment imported over a REAL SQL
 * Server, through the REAL runtime tooling (`importNarrationTiming`) composed
 * in-process as the RUNTIME principal, and the owner side's refusals.
 *
 * WHAT ONLY THE DATABASE AND THE REAL SERVICES CAN PROVE:
 *
 *   - a file whose digest is not the one handed in, an operator without
 *     `quran.administer`, a missing narration or reference recitation, and a
 *     file that does not hold together each change NOTHING;
 *   - each accepted Surah's stored narration segment receives its timing, its
 *     alignment (the provenance source handed in, the reference recitation)
 *     and its passage spans, exactly as the file says; a Surah without its
 *     segment is skipped and reported; a second run keeps everything;
 *   - the owner side refuses any file but the pinned one before it registers
 *     anything.
 *
 * NOTHING HERE IS THE QURAN. The corpus is `NON_QURAN_FIXTURE` text, 114
 * Surahs of one Ayah except 103, 112 and 114, which have the ayat the excerpt
 * times; the excerpt is times only, copied from the real alignment file.
 */

const live = databaseConfigured ? describe : describe.skip;

/** 114 Surahs, one Ayah each but the excerpt's, accepted as a FIXTURE corpus (never activated). */
async function seedCorpus(admin: SqlSession): Promise<void> {
  const source = randomUUID();
  const run = randomUUID();
  const surahs = Array.from({ length: 114 }, (_, index) => index + 1);
  const ayat = surahs.flatMap((surah) =>
    Array.from({ length: EXCERPT_AYAH_COUNTS.get(surah) ?? 1 }, (_, index) => [
      surah,
      index + 1,
    ]),
  );
  await admin.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script]) VALUES
      (${n(source)}, N'NON_QURAN_FIXTURE_NARRATION_${source.slice(0, 8)}', N'fixture', N'NON_QURAN_FIXTURE source', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE');
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic]) VALUES
      ${surahs.map((surah) => `(${n(source)}, ${surah}, ${EXCERPT_AYAH_COUNTS.get(surah) ?? 1}, NULL, N'NON_QURAN_FIXTURE_SURAH_${surah}')`).join(',')};
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES
      ${ayat.map(([surah, ayah]) => `(${n(source)}, ${surah}, ${ayah}, 1, ${n(`NON_QURAN_FIXTURE_${surah}_${ayah} ${NEUTRAL}`)})`).join(',')};
    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
      VALUES (${n(run)}, N'corpus-acceptance', N'passed', ${n(source)}, ${ayat.length}, 0, NULL, SYSUTCDATETIME());
    INSERT INTO [dbo].[Juz] ([number],[sourceId],[createdAt]) VALUES (1, ${n(source)}, SYSUTCDATETIME());
    INSERT INTO [dbo].[Surah] ([number],[ayahCount],[revelation],[nameArabic],[sourceId],[createdAt],[updatedAt])
      SELECT [number], [ayahCount], NULL, [nameArabic], [sourceId], SYSUTCDATETIME(), SYSUTCDATETIME()
      FROM [dbo].[QuranSourceSurah] WHERE [sourceId] = ${n(source)};
    INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[hizb],[page],[text],[sourceId],[version],[createdAt],[updatedAt])
      SELECT [surahNumber],[ayahNumber],[juzNumber],NULL,NULL,[text],[sourceId],1,SYSUTCDATETIME(),SYSUTCDATETIME()
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId] = ${n(source)};
    INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
      SELECT [surahNumber],[ayahNumber],1,[text],[sourceId],${n(run)},NULL,NULL,NULL,SYSUTCDATETIME()
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId] = ${n(source)};
  `);
}

live(
  'Quran translation audio: the narration alignment import against real SQL Server',
  () => {
    let db: DisposableDatabase;
    let owner: SqlSession;
    let runtime: SqlServerConnection;
    let root: string;
    let tooling: typeof Runtime;
    let runner: QuranReferenceRunner;
    let persistence: QuranPersistencePort;
    let operator: string;
    let alignmentSource: string;
    let narrationId: string;
    let file: string;
    let digest: string;

    const tables = async () => ({
      timings: await count(db.admin, 'QuranRecitationTiming'),
      alignments: await count(db.admin, 'QuranRecitationAlignment'),
      spans: await count(db.admin, 'QuranRecitationTranslationSpan'),
    });
    const NOTHING = { timings: 0, alignments: 0, spans: 0 };

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
      owner = await openSession(parseSqlServerUrl(db.url), { requestTimeoutMs: 300_000 });
      root = mkdtempSync(path.join(tmpdir(), 'minhaj-narration-timing-'));
      process.env['DATABASE_URL'] = runtimeUrl;

      await seedCorpus(db.admin);
      operator = await accountWith(db.admin, [
        'quran.read',
        'quran.administer',
        'people.administer',
      ]);
      tooling = await import('../../scripts/quran/recitations-runtime.ts');
      const { composeQuranReferenceRunner } =
        await import('../../apps/web/src/composition/quran-reference-runner.ts');
      runner = composeQuranReferenceRunner();
      persistence = (
        await import('../../packages/database/src/index.ts')
      ).createQuranPersistence();

      file = path.join(root, 'narration-timing.json');
      const bytes = Buffer.from(JSON.stringify(wholeFile()), 'utf8');
      writeFileSync(file, bytes);
      digest = createHash('sha256').update(bytes).digest('hex');

      alignmentSource = (
        await registerRecitationProvenance(
          owner,
          'alignment',
          narrationAlignmentEvidence(NARRATION_TIMING_SHA256),
        )
      ).id;
    }, 600_000);

    afterAll(async () => {
      await owner?.close();
      await db?.close();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }, 120_000);

    const run = (
      overrides: Partial<{ operator: string; sha256: string; file: string }> = {},
    ) =>
      tooling.importNarrationTiming(runner, {
        operator: overrides.operator ?? operator,
        source: alignmentSource,
        file: overrides.file ?? file,
        sha256: overrides.sha256 ?? digest,
      });

    it('records its evidence within the source’s bound, once', async () => {
      expect(
        narrationAlignmentEvidence(NARRATION_TIMING_SHA256).length,
      ).toBeLessThanOrEqual(2000);
      expect(
        await registerRecitationProvenance(
          owner,
          'alignment',
          narrationAlignmentEvidence(NARRATION_TIMING_SHA256),
        ),
      ).toEqual({ id: alignmentSource, state: 'kept' });
    });

    it('the owner side refuses any file but the pinned one, registering nothing', async () => {
      const sources = await count(db.admin, 'QuranSource');
      await expect(
        importNarrationAlignment({
          owner,
          runtime,
          operator,
          file,
          sha256: digest,
          environment: process.env,
        }),
      ).rejects.toThrow(/not the recorded alignment file digest/);
      await expect(
        importNarrationAlignment({
          owner,
          runtime,
          operator,
          file,
          sha256: NARRATION_TIMING_SHA256,
          environment: process.env,
        }),
      ).rejects.toThrow(/not the recorded one/);
      expect(await count(db.admin, 'QuranSource')).toBe(sources);
      expect(await tables()).toEqual(NOTHING);
    });

    it('refuses, changing nothing, before the narration and its reference are recorded', async () => {
      await expect(run()).rejects.toThrow(/narration is not recorded/);
      expect(await tables()).toEqual(NOTHING);
    });

    it('refuses another file, an operator without quran.administer, and a file that does not hold', async () => {
      // The narration (Surahs 103 and 112 stored; 114 has no segment) and the
      // reference recitation, as the two earlier imports record them.
      const reciter = randomUUID();
      const irfan = randomUUID();
      const mp3quran = randomUUID();
      await db.admin.query(`
      INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (${n(reciter)}, N'non-quran-fixture-narrator', N'en', N'published');
      INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES
        (${n(irfan)}, N'non-quran-fixture-irfan', N'reference', N'NON_QURAN_FIXTURE', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE evidence'),
        (${n(mp3quran)}, N'non-quran-fixture-mp3quran', N'reference', N'NON_QURAN_FIXTURE', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE evidence');
    `);
      const actor = { accountId: operator };
      const narration = await runner.quran.createRecitation(actor, {
        value: {
          slug: tooling.IRFAN_NARRATION.slug,
          name: 'NON_QURAN_FIXTURE narration',
          reciterId: reciter,
          style: null,
          attribution: null,
          sourceId: irfan,
          languageCode: 'ur',
        },
      });
      narrationId = narration.id;
      let version = narration.version;
      for (const surah of [103, 112]) {
        const added = await runner.quran.addRecitationSegment(actor, {
          id: narration.id,
          expectedVersion: version,
          value: { surah, startAyah: 1, endAyah: EXCERPT_AYAH_COUNTS.get(surah) ?? 1 },
        });
        const segment = added.segments.find((entry) => entry.surah === surah)!;
        version = (
          await persistence.attachSegmentAsset({
            actorId: operator,
            id: narration.id,
            expectedVersion: added.version,
            segmentId: segment.id,
            assetId: await asset(db.admin),
          })
        ).version;
      }
      await expect(run()).rejects.toThrow(/reference recitation is not recorded/);
      await runner.quran.createStreamedRecitation(actor, {
        value: {
          slug: 'abdulrahman-sudais-r1',
          name: 'NON_QURAN_FIXTURE reference recitation',
          reciterId: reciter,
          style: null,
          attribution: null,
          sourceId: mp3quran,
          languageCode: 'ar',
        },
        stream: { provider: 'mp3quran', path: 'audio/abdulrahman-sudais/r1' },
      });

      await expect(run({ sha256: 'f'.repeat(64) })).rejects.toThrow(
        /not the one recorded/,
      );
      const quranOnly = await accountWith(db.admin, ['quran.read']);
      await expect(run({ operator: quranOnly })).rejects.toThrow(
        /does not hold quran\.administer/,
      );
      const broken = path.join(root, 'broken.json');
      const body = wholeFile();
      (body['groups'] as Record<string, unknown>)['112'] = [[1, 2]];
      const brokenBytes = Buffer.from(JSON.stringify(body), 'utf8');
      writeFileSync(broken, brokenBytes);
      await expect(
        run({
          file: broken,
          sha256: createHash('sha256').update(brokenBytes).digest('hex'),
        }),
      ).rejects.toThrow(/partition.*Surah 112.*nothing was changed/);
      expect(await tables()).toEqual(NOTHING);
    });

    it('records each stored Surah’s timing, alignment and spans exactly; a Surah without its segment is reported', async () => {
      const summary = await run();
      expect(summary).toMatchObject({
        mode: 'narration-timing',
        recitationId: narrationId,
        surahs: 3,
        rejected: 111,
        ayat: 13,
        passages: 8,
        aligned: 2,
        kept: 0,
        skipped: [{ surah: 114, reason: 'no-segment' }],
      });
      // 103: one passage of three ayat; 112: four passages of one.
      expect(await tables()).toEqual({ timings: 7, alignments: 2, spans: 5 });
      const [span] = await db.admin.query<{
        startAyah: number;
        endAyah: number;
        startMs: number;
        endMs: number;
      }>(`
      SELECT x.[startAyah],x.[endAyah],x.[startMs],x.[endMs]
      FROM [dbo].[QuranRecitationTranslationSpan] x
      JOIN [dbo].[QuranRecitationSegment] s ON s.[id] = x.[segmentId]
      WHERE s.[surahNumber] = 103;
    `);
      expect(span).toEqual({ startAyah: 1, endAyah: 3, startMs: 23800, endMs: 81200 });
      expect(
        await count(
          db.admin,
          'QuranRecitationAlignment',
          `[sourceId] = ${n(alignmentSource)}`,
        ),
      ).toBe(2);
    });

    it('keeps everything on a second run', async () => {
      expect(await run()).toMatchObject({ aligned: 0, kept: 2 });
      expect(await tables()).toEqual({ timings: 7, alignments: 2, spans: 5 });
    });
  },
);
