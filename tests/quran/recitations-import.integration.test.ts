import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MalwareScannerPort } from '../../packages/contracts/src/platform/storage.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { syntheticSilentMp3 } from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  importMp3QuranRecitations,
  irfanNarrationEvidence,
  mp3quranEvidence,
  registerRecitationProvenance,
} from '../../packages/database/src/lifecycle/quran-recitations.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { HAFS, MP3QURAN_ENDPOINTS } from '../../scripts/quran/mp3quran.ts';
import type { QuranReferenceRunner } from '../../apps/web/src/composition/quran-reference-runner.ts';
import type * as Runtime from '../../scripts/quran/recitations-runtime.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { accountWith, count, n, NEUTRAL } from './fixture-sql.ts';

/**
 * Quran Part 5 — the two staging recitation imports over a REAL SQL Server,
 * through the REAL runtime tooling (`scripts/quran/recitations-runtime.ts`),
 * composed in-process as the RUNTIME principal exactly as its child process
 * composes it.
 *
 * NO NETWORK. mp3quran's API is a STUB `get` returning canned bodies shaped
 * like the real endpoints; the narration archive is a ZIP built here of 114
 * synthetic silent MP3s.
 *
 * WHAT ONLY THE DATABASE AND THE REAL SERVICES CAN PROVE:
 *
 *   - the owner side refuses, with nothing written, without the active Tanzil
 *     reference corpus; a provenance source is registered once and refused
 *     with other evidence;
 *   - an operator without `people.administer` writes nothing at all;
 *   - each curated, timed read becomes a People Person (names verbatim, no
 *     biography), a STREAMED recitation of its CDN folder beside the
 *     reference provenance, and one timed segment per Surah — a Surah whose
 *     timing does not cover its ayat is skipped and reported, never adjusted —
 *     then published; a Person of that slug with ANOTHER name is left alone;
 *     a second run adds nothing;
 *   - the narration archive's members become one first-party, untimed segment
 *     per Surah, the archive's digest is re-checked, and a second run stores
 *     nothing.
 *
 * THE SCANNER. Storage's malware scan is ClamAV's where one answers on this
 * machine; where none does, the narration proof substitutes a scanner that
 * answers clean — a TEST DOUBLE for the scanner only, named in the test's
 * title, so the import's own logic (archive, segments, idempotency) is still
 * proved and nothing claims ClamAV ran. `tests/storage/quran-recitation
 * .integration.test.ts` is where the real scanner's verdicts are proved.
 *
 * NOTHING HERE IS THE QURAN. The corpus is 114 one-Ayah `NON_QURAN_FIXTURE`
 * Surahs; the reciters' names are sentinels; the audio is generated silence.
 */

const live = databaseConfigured ? describe : describe.skip;

const HOST = process.env['CLAMAV_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['CLAMAV_PORT'] ?? 3310);

async function scannerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port: PORT });
    let reply = '';
    const settle = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(5_000);
    socket.on('timeout', () => settle(false));
    socket.on('error', () => settle(false));
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
      if (reply.includes('PONG')) settle(true);
    });
    socket.on('close', () => settle(reply.includes('PONG')));
  });
}

const CLAMAV = databaseConfigured ? await scannerReady() : false;

/** The two curated reads the stub API offers; every other curated read is untimed here. */
const MISHARY = {
  read: 123,
  folder: 'audio/mishary-alafasy/r1',
  slug: 'mishary-alafasy',
} as const;
const ABDULBASIT = {
  read: 53,
  folder: 'audio/abdulbasit-abdulsamad/r3',
  slug: 'abdulbasit-abdulsamad',
} as const;
const NAMES = {
  123: {
    en: 'NON_QURAN_FIXTURE Reciter One',
    ar: 'NON_QURAN_FIXTURE القارئ الأول',
  },
  53: {
    en: 'NON_QURAN_FIXTURE Reciter Two',
    ar: 'NON_QURAN_FIXTURE القارئ الثاني',
  },
} as const;
const MOSHAF = "Rewayat Hafs A'n Assem - Murattal";
/** The Surah whose stub timing does not cover its one Ayah. */
const BAD_SURAH = 2;

/** The stub API: canned bodies shaped like mp3quran's, and nothing else. */
function stubApi() {
  const asked: string[] = [];
  const reads = [MISHARY, ABDULBASIT].map((entry) => ({
    id: entry.read,
    name: NAMES[entry.read].ar,
    rewaya: HAFS,
    folder_url: `https://cdn.mp3quran.net/${entry.folder}/`,
    soar_count: 114,
    soar_link: `https://www.mp3quran.net/api/v3/ayat_timing/soar?read=${String(entry.read)}`,
  }));
  const reciters = (language: 'en' | 'ar') => ({
    reciters: [MISHARY, ABDULBASIT].map((entry, index) => ({
      id: 900 + index,
      name: NAMES[entry.read][language],
      letter: 'N',
      moshaf: [
        {
          id: entry.read,
          name: language === 'en' ? MOSHAF : 'حفص عن عاصم - مرتل',
          rewaya_id: 1,
          server: `https://cdn.mp3quran.net/${entry.folder}/`,
          surah_total: 114,
          moshaf_type: 11,
          surah_list: '1',
        },
      ],
    })),
  });
  async function get(url: string): Promise<unknown> {
    asked.push(url);
    if (url === MP3QURAN_ENDPOINTS.timedReads) return reads;
    if (url === MP3QURAN_ENDPOINTS.reciters('eng')) return reciters('en');
    if (url === MP3QURAN_ENDPOINTS.reciters('ar')) return reciters('ar');
    const timing = /ayat_timing\?surah=(\d+)&read=(\d+)$/.exec(url);
    if (timing !== null && Number(timing[2]) === MISHARY.read) {
      const surah = Number(timing[1]);
      const entry = (ayah: number, start: number, end: number) => ({
        ayah,
        polygon: 'NON_QURAN_FIXTURE polygon — never read',
        start_time: start,
        end_time: end,
        x: '0',
        y: '0',
        page: 'NON_QURAN_FIXTURE page — never read',
      });
      // The corpus's Surah has ONE Ayah; this one is timed for two.
      if (surah === BAD_SURAH) return [entry(1, 1000, 2000), entry(2, 2000, 3000)];
      return [entry(1, 1000 + surah, 5000 + surah)];
    }
    throw new Error(`The stub API was asked an unexpected address: ${url}`);
  }
  return { get, asked };
}

/** A one-disk ZIP of deflated members. */
function zipOf(members: readonly { readonly name: string; readonly data: Uint8Array }[]) {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const data = Buffer.from(member.data);
    const body = deflateRawSync(data);
    const name = Buffer.from(member.name, 'latin1');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

/** 114 Surahs of one Ayah each, accepted as a canonical FIXTURE corpus (never activated). */
async function seedCorpus(admin: SqlSession): Promise<void> {
  const source = randomUUID();
  const run = randomUUID();
  const surahs = Array.from({ length: 114 }, (_, index) => index + 1);
  await admin.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script]) VALUES
      (${n(source)}, N'NON_QURAN_FIXTURE_RECITATIONS_${source.slice(0, 8)}', N'fixture', N'NON_QURAN_FIXTURE source', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE');
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic]) VALUES
      ${surahs.map((surah) => `(${n(source)}, ${surah}, 1, NULL, N'NON_QURAN_FIXTURE_SURAH_${surah}')`).join(',')};
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES
      ${surahs.map((surah) => `(${n(source)}, ${surah}, 1, 1, ${n(`NON_QURAN_FIXTURE_${surah}_1 ${NEUTRAL}`)})`).join(',')};
    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
      VALUES (${n(run)}, N'corpus-acceptance', N'passed', ${n(source)}, 114, 0, NULL, SYSUTCDATETIME());
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

live('Quran Part 5 recitation imports against real SQL Server', () => {
  let db: DisposableDatabase;
  let owner: SqlSession;
  let runtime: SqlServerConnection;
  let root: string;
  let tooling: typeof Runtime;
  let runner: QuranReferenceRunner;
  let operator: string;
  let mp3quranSource: string;

  const scalar = async (sql: string): Promise<number> => {
    const [row] = await db.admin.query<{ n: number }>(sql);
    return Number(row?.n ?? -1);
  };

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
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-recitations-import-'));
    process.env['DATABASE_URL'] = runtimeUrl;
    process.env['STORAGE_ROOT'] = root;

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
  }, 600_000);

  afterAll(async () => {
    await owner?.close();
    await db?.close();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }, 120_000);

  it('refuses, writing nothing, without the active Tanzil reference corpus', async () => {
    await expect(
      importMp3QuranRecitations({ owner, runtime, operator, environment: process.env }),
    ).rejects.toThrow(/not the Tanzil reference corpus/);
    expect(await count(db.admin, 'QuranRecitation')).toBe(0);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [n] FROM [dbo].[QuranSource] WHERE [authority] = N'reference';`,
      ),
    ).toBe(0);
  });

  it('registers a provenance source once, and never with other evidence', async () => {
    const first = await registerRecitationProvenance(
      owner,
      'mp3quran',
      mp3quranEvidence(),
    );
    expect(first.state).toBe('registered');
    expect(
      await registerRecitationProvenance(owner, 'mp3quran', mp3quranEvidence()),
    ).toEqual({
      id: first.id,
      state: 'kept',
    });
    await expect(
      registerRecitationProvenance(owner, 'mp3quran', `${mp3quranEvidence()} (edited)`),
    ).rejects.toThrow(/different evidence; nothing was changed/);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [n] FROM [dbo].[QuranSource] WHERE [id] = ${n(first.id)} AND [authority] = N'reference'
           AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranSourceAyah] WHERE [sourceId] = ${n(first.id)});`,
      ),
    ).toBe(1);
    mp3quranSource = first.id;
  });

  it('refuses an operator without people.administer before anything is fetched or written', async () => {
    const quranOnly = await accountWith(db.admin, ['quran.read', 'quran.administer']);
    const api = stubApi();
    const people = await count(db.admin, 'Person');
    await expect(
      tooling.importMp3Quran(runner, {
        operator: quranOnly,
        source: mp3quranSource,
        get: api.get,
      }),
    ).rejects.toThrow(/does not hold people\.administer/);
    expect(api.asked).toEqual([]);
    expect(await count(db.admin, 'Person')).toBe(people);
    expect(await count(db.admin, 'QuranRecitation')).toBe(0);
  });

  it('imports each timed read as a streamed, timed, published recitation — names verbatim, a bad Surah skipped', async () => {
    // A Person already holds the second read's slug, under ANOTHER name: it is
    // someone else, and is left alone.
    const other = randomUUID();
    await db.admin.query(`
      INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (${n(other)}, ${n(ABDULBASIT.slug)}, N'ar', N'published');
      INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (${n(other)}, N'ar', N'NON_QURAN_FIXTURE someone else', NULL);
    `);

    const api = stubApi();
    const summary = (await tooling.importMp3Quran(runner, {
      operator,
      source: mp3quranSource,
      get: api.get,
    })) as {
      reads: number;
      published: number;
      segmentsAdded: number;
      reports: {
        read: number;
        recitation: string | null;
        skip: string | null;
        person: string | null;
        created: boolean;
        added: number;
        kept: number;
        skipped: { surah: number; reason: string }[];
        published: boolean;
      }[];
    };
    expect(summary).toMatchObject({ reads: 12, published: 1, segmentsAdded: 113 });
    const byRead = new Map(summary.reports.map((report) => [report.read, report]));
    expect(byRead.get(MISHARY.read)).toEqual({
      read: MISHARY.read,
      recitation: 'mishary-alafasy-r1',
      skip: null,
      person: 'created',
      created: true,
      added: 113,
      kept: 0,
      skipped: [{ surah: BAD_SURAH, reason: 'coverage' }],
      published: true,
    });
    expect(byRead.get(ABDULBASIT.read)).toMatchObject({
      skip: 'person-slug-taken',
      added: 0,
    });
    for (const report of summary.reports)
      if (report.read !== MISHARY.read && report.read !== ABDULBASIT.read)
        expect(report.skip, String(report.read)).toBe('not-timed');
    // Only the API's own host, and only the timed read's Surahs, were asked.
    expect(api.asked.every((url) => new URL(url).host === 'www.mp3quran.net')).toBe(true);
    expect(api.asked.filter((url) => url.includes('read=53'))).toEqual([]);

    // The reciter: a published Person, the source's names verbatim, nothing more.
    const people = await db.admin.query<{
      id: string;
      status: string;
      primaryLocale: string;
      locale: string;
      name: string;
      biography: string | null;
    }>(`
      SELECT p.[id], p.[status], p.[primaryLocale], t.[locale], t.[name], t.[biography]
      FROM [dbo].[Person] p JOIN [dbo].[PersonTranslation] t ON t.[personId] = p.[id]
      WHERE p.[slug] = ${n(MISHARY.slug)} ORDER BY t.[locale];
    `);
    expect(
      people.map(({ status, primaryLocale, locale, name, biography }) => ({
        status,
        primaryLocale,
        locale,
        name,
        biography,
      })),
    ).toEqual([
      {
        status: 'published',
        primaryLocale: 'ar',
        locale: 'ar',
        name: NAMES[MISHARY.read].ar,
        biography: null,
      },
      {
        status: 'published',
        primaryLocale: 'ar',
        locale: 'en',
        name: NAMES[MISHARY.read].en,
        biography: null,
      },
    ]);
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [n] FROM [dbo].[PersonTranslation] WHERE [personId] = ${n(other)};`,
      ),
    ).toBe(1);

    // The recitation: streamed from its folder, Arabic, beside the provenance.
    const [recitation] = await db.admin.query<{
      id: string;
      personId: string;
      name: string;
      style: string | null;
      attribution: string | null;
      languageCode: string;
      streamProvider: string;
      streamPath: string;
      sourceId: string;
      state: string;
    }>(`SELECT [id],[personId],[name],[style],[attribution],[languageCode],[streamProvider],[streamPath],[sourceId],[state]
        FROM [dbo].[QuranRecitation] WHERE [slug] = N'mishary-alafasy-r1';`);
    expect(recitation).toMatchObject({
      personId: people[0]?.id,
      name: `${NAMES[MISHARY.read].en} — ${MOSHAF}`,
      style: 'Murattal',
      attribution: `Recitation: ${NAMES[MISHARY.read].en} (${MOSHAF}). Audio and timings: mp3quran.net`,
      languageCode: 'ar',
      streamProvider: 'mp3quran',
      streamPath: MISHARY.folder,
      sourceId: mp3quranSource,
      state: 'published',
    });
    const id = recitation?.id ?? '';
    const [segments] = await db.admin.query<{
      segments: number;
      files: number;
      timings: number;
      bad: number;
      wholeSurahs: number;
    }>(`
      SELECT COUNT_BIG(*) AS [segments],
             SUM(CASE WHEN s.[assetId] IS NULL THEN 0 ELSE 1 END) AS [files],
             (SELECT COUNT_BIG(*) FROM [dbo].[QuranRecitationTiming] t JOIN [dbo].[QuranRecitationSegment] g ON g.[id] = t.[segmentId] WHERE g.[recitationId] = ${n(id)}) AS [timings],
             SUM(CASE WHEN s.[surahNumber] = ${BAD_SURAH} THEN 1 ELSE 0 END) AS [bad],
             SUM(CASE WHEN s.[startAyah] = 1 AND s.[endAyah] = 1 THEN 1 ELSE 0 END) AS [wholeSurahs]
      FROM [dbo].[QuranRecitationSegment] s WHERE s.[recitationId] = ${n(id)};
    `);
    expect(
      Object.fromEntries(
        Object.entries(segments ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
    ).toEqual({ segments: 113, files: 0, timings: 113, bad: 0, wholeSurahs: 113 });
    // Exactly the source's start and end, unadjusted.
    const [timing] = await db.admin.query<{ startMs: number; endMs: number }>(`
      SELECT t.[startMs], t.[endMs] FROM [dbo].[QuranRecitationTiming] t
      JOIN [dbo].[QuranRecitationSegment] g ON g.[id] = t.[segmentId]
      WHERE g.[recitationId] = ${n(id)} AND g.[surahNumber] = 36;
    `);
    expect(timing).toEqual({ startMs: 1036, endMs: 5036 });

    // A second run adds nothing, and keeps the Person and the recitation.
    const again = (await tooling.importMp3Quran(runner, {
      operator,
      source: mp3quranSource,
      get: stubApi().get,
    })) as typeof summary;
    expect(again.segmentsAdded).toBe(0);
    expect(again.reports.find((report) => report.read === MISHARY.read)).toMatchObject({
      person: 'kept',
      created: false,
      added: 0,
      kept: 113,
      skipped: [{ surah: BAD_SURAH, reason: 'coverage' }],
      published: true,
    });
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [n] FROM [dbo].[Person] WHERE [slug] = ${n(MISHARY.slug)};`,
      ),
    ).toBe(1);
    expect(await count(db.admin, 'QuranRecitation')).toBe(1);
  }, 900_000);

  it(
    CLAMAV
      ? 'stores the narration archive as one untimed first-party segment per Surah (real ClamAV)'
      : 'stores the narration archive as one untimed first-party segment per Surah (scanner TEST DOUBLE: no ClamAV answers here)',
    async () => {
      const audio = syntheticSilentMp3(2);
      const zip = zipOf(
        Array.from({ length: 114 }, (_, index) => ({
          name: `${String(index + 1).padStart(3, '0')}. NON_QURAN_FIXTURE.mp3`,
          data: audio,
        })),
      );
      const file = path.join(root, 'narration-fixture.zip');
      writeFileSync(file, zip);
      const sha256 = createHash('sha256').update(zip).digest('hex');
      const source = await registerRecitationProvenance(
        owner,
        'irfan',
        irfanNarrationEvidence(sha256),
      );

      let narrationRunner = runner;
      if (!CLAMAV) {
        const [
          { createStorageService },
          { createFilesystemStore },
          database,
          quranContext,
        ] = await Promise.all([
          import('../../packages/storage/src/service.ts'),
          import('../../packages/storage/src/filesystem.ts'),
          import('../../packages/database/src/index.ts'),
          import('../../apps/web/src/contexts/quran/index.ts'),
        ]);
        const clean: MalwareScannerPort = {
          scan: () => Promise.resolve({ status: 'clean' }),
        };
        const storage = createStorageService({
          files: await createFilesystemStore(root),
          assets: database.createAssetPersistence(),
          scanner: clean,
          maxBytes: 64 * 1024 * 1024,
        });
        narrationRunner = {
          ...runner,
          upload: quranContext.createRecitationUpload({
            persistence: database.createQuranPersistence(),
            authority: {
              permits: (accountId, permission) => runner.permits(accountId, permission),
              verifyCanonical: () => Promise.resolve(false),
            },
            storage: () => Promise.resolve(storage),
          }),
        };
      }

      // Another archive than the one recorded changes nothing.
      await expect(
        tooling.importIrfanNarration(narrationRunner, {
          operator,
          source: source.id,
          zip: file,
          sha256: 'f'.repeat(64),
        }),
      ).rejects.toThrow(/not the one recorded; nothing was changed/);
      expect(
        await scalar(
          `SELECT COUNT_BIG(*) AS [n] FROM [dbo].[QuranRecitation] WHERE [slug] = N'irfan-ul-quran-urdu-narration';`,
        ),
      ).toBe(0);

      const first = await tooling.importIrfanNarration(narrationRunner, {
        operator,
        source: source.id,
        zip: file,
        sha256,
      });
      expect(first).toMatchObject({
        mode: 'irfan-urdu',
        person: 'created',
        stored: 114,
        kept: 0,
        skipped: [],
        published: true,
      });

      const [row] = await db.admin.query<{
        state: string;
        languageCode: string;
        streamPath: string | null;
        attribution: string;
        sourceId: string;
        segments: number;
        files: number;
        timings: number;
        bytes: number;
        narrator: string;
        biography: string | null;
      }>(`
        SELECT r.[state], r.[languageCode], r.[streamPath], r.[attribution], r.[sourceId],
               (SELECT COUNT_BIG(*) FROM [dbo].[QuranRecitationSegment] s WHERE s.[recitationId] = r.[id]) AS [segments],
               (SELECT COUNT_BIG(*) FROM [dbo].[QuranRecitationSegment] s JOIN [dbo].[Asset] a ON a.[id] = s.[assetId]
                  WHERE s.[recitationId] = r.[id] AND a.[state] = N'clean' AND a.[mediaType] = N'audio/mpeg') AS [files],
               (SELECT COUNT_BIG(*) FROM [dbo].[QuranRecitationTiming] t JOIN [dbo].[QuranRecitationSegment] s ON s.[id] = t.[segmentId]
                  WHERE s.[recitationId] = r.[id]) AS [timings],
               (SELECT MAX(a.[byteSize]) FROM [dbo].[QuranRecitationSegment] s JOIN [dbo].[Asset] a ON a.[id] = s.[assetId]
                  WHERE s.[recitationId] = r.[id]) AS [bytes],
               (SELECT t.[name] FROM [dbo].[PersonTranslation] t WHERE t.[personId] = r.[personId] AND t.[locale] = N'en') AS [narrator],
               (SELECT t.[biography] FROM [dbo].[PersonTranslation] t WHERE t.[personId] = r.[personId] AND t.[locale] = N'en') AS [biography]
        FROM [dbo].[QuranRecitation] r WHERE r.[slug] = N'irfan-ul-quran-urdu-narration';
      `);
      expect({
        ...row,
        segments: Number(row?.segments),
        files: Number(row?.files),
        timings: Number(row?.timings),
        bytes: Number(row?.bytes),
      }).toEqual({
        state: 'published',
        languageCode: 'ur',
        streamPath: null,
        attribution: 'Irfan-ul-Quran, Urdu narration — Minhaj-ul-Quran International',
        sourceId: source.id,
        segments: 114,
        files: 114,
        timings: 0,
        // Stored exactly as the archive holds it: never altered.
        bytes: audio.byteLength,
        narrator: 'Tasleem Ahmed Sabri',
        biography: null,
      });

      const second = await tooling.importIrfanNarration(narrationRunner, {
        operator,
        source: source.id,
        zip: file,
        sha256,
      });
      expect(second).toMatchObject({
        person: 'kept',
        stored: 0,
        kept: 114,
        published: true,
      });
    },
    1_200_000,
  );
});
