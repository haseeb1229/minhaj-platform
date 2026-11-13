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
import { registerProvenanceSource } from '../../packages/database/src/lifecycle/quran-recitations.ts';
import {
  TAJWEED_ANNOTATIONS_SHA256,
  TAJWEED_BASE_TEXT_SHA256,
  TAJWEED_PROVENANCE,
  importTajweedOverlay,
  tajweedEvidence,
} from '../../packages/database/src/lifecycle/quran-tajweed.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { QuranReferenceRunner } from '../../apps/web/src/composition/quran-reference-runner.ts';
import type * as Runtime from '../../scripts/quran/tajweed-runtime.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { accountWith, count, n, NEUTRAL } from './fixture-sql.ts';
import { BASE_TEXT_FILE, CANONICAL, annotationFile } from './tajweed-fixture.ts';

/**
 * Quran Part 9 — the tajweed colour overlay imported over a REAL SQL Server,
 * through the REAL runtime tooling (`importTajweed`) composed in-process as
 * the RUNTIME principal, and the owner side's refusals.
 *
 * WHAT ONLY THE DATABASE AND THE REAL SERVICES CAN PROVE:
 *
 *   - the owner side refuses any file but the pinned ones before it registers
 *     anything; the runtime refuses a file whose digest is not the one handed
 *     in, an operator without `quran.administer`, and a source naming an Ayah
 *     the corpus does not hold — each changing NOTHING;
 *   - every aligned Ayah is recorded, with ALL its spans and the SHA-256 the
 *     database itself computes over the Ayah's current text; a skipped Ayah
 *     records nothing; the overlay is a DRAFT; a second run keeps everything.
 *
 * NOTHING HERE IS THE QURAN. The corpus is short sentinel phrases
 * (`./tajweed-fixture.ts`) for Surahs 1 and 2 and `NON_QURAN_FIXTURE` text for
 * the other 112 Surahs, accepted as a fixture corpus (never activated).
 */

const live = databaseConfigured ? describe : describe.skip;

/** 114 Surahs — the fixture's six ayat in Surahs 1 and 2, one sentinel Ayah in each other. */
async function seedCorpus(admin: SqlSession): Promise<void> {
  const source = randomUUID();
  const run = randomUUID();
  const ayat = [
    ...CANONICAL,
    ...Array.from({ length: 112 }, (_, index) => ({
      surah: index + 3,
      ayah: 1,
      text: `NON_QURAN_FIXTURE_${String(index + 3)}_1 ${NEUTRAL}`,
    })),
  ];
  const counts = new Map<number, number>();
  for (const entry of ayat) counts.set(entry.surah, (counts.get(entry.surah) ?? 0) + 1);
  await admin.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script]) VALUES
      (${n(source)}, N'NON_QURAN_FIXTURE_TAJWEED_${source.slice(0, 8)}', N'fixture', N'NON_QURAN_FIXTURE source', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE');
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic]) VALUES
      ${[...counts].map(([surah, total]) => `(${n(source)}, ${String(surah)}, ${String(total)}, NULL, N'NON_QURAN_FIXTURE_SURAH_${String(surah)}')`).join(',')};
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES
      ${ayat.map((entry) => `(${n(source)}, ${String(entry.surah)}, ${String(entry.ayah)}, 1, ${n(entry.text)})`).join(',')};
    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
      VALUES (${n(run)}, N'corpus-acceptance', N'passed', ${n(source)}, ${String(ayat.length)}, 0, NULL, SYSUTCDATETIME());
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

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

live('Quran Part 9: the tajweed overlay import against real SQL Server', () => {
  let db: DisposableDatabase;
  let owner: SqlSession;
  let runtime: SqlServerConnection;
  let root: string;
  let tooling: typeof Runtime;
  let runner: QuranReferenceRunner;
  let operator: string;
  let source: string;
  let annotations: string;
  let text: string;
  let digests: { readonly sha256: string; readonly textSha256: string };

  const tables = async () => ({
    overlays: await count(db.admin, 'QuranTajweedOverlay'),
    ayat: await count(db.admin, 'QuranTajweedOverlayAyah'),
    spans: await count(db.admin, 'QuranTajweedSpan'),
  });
  const NOTHING = { overlays: 0, ayat: 0, spans: 0 };

  const write = (name: string, bytes: Uint8Array) => {
    const file = path.join(root, name);
    writeFileSync(file, bytes);
    return { file, digest: sha256(bytes) };
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
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-tajweed-'));
    process.env['DATABASE_URL'] = runtimeUrl;

    await seedCorpus(db.admin);
    operator = await accountWith(db.admin, ['quran.read', 'quran.administer']);
    tooling = await import('../../scripts/quran/tajweed-runtime.ts');
    const { composeQuranReferenceRunner } =
      await import('../../apps/web/src/composition/quran-reference-runner.ts');
    runner = composeQuranReferenceRunner();

    const json = write(
      'tajweed.hafs.uthmani-pause-sajdah.json',
      Buffer.from(JSON.stringify(annotationFile()), 'utf8'),
    );
    const base = write('quran-uthmani.txt', Buffer.from(BASE_TEXT_FILE, 'utf8'));
    annotations = json.file;
    text = base.file;
    digests = { sha256: json.digest, textSha256: base.digest };
    source = (
      await registerProvenanceSource(owner, TAJWEED_PROVENANCE, tajweedEvidence())
    ).id;
  }, 600_000);

  afterAll(async () => {
    await owner?.close();
    await db?.close();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }, 120_000);

  const run = (
    overrides: Partial<{
      operator: string;
      annotations: string;
      text: string;
      sha256: string;
      textSha256: string;
    }> = {},
  ) =>
    tooling.importTajweed(runner, {
      operator,
      source,
      annotations,
      text,
      ...digests,
      ...overrides,
    });

  it('records its evidence within the source’s bound, once', async () => {
    expect(tajweedEvidence().length).toBeLessThanOrEqual(2000);
    expect(tajweedEvidence()).toContain(TAJWEED_ANNOTATIONS_SHA256);
    expect(tajweedEvidence()).toContain('re-aligned');
    expect(
      await registerProvenanceSource(owner, TAJWEED_PROVENANCE, tajweedEvidence()),
    ).toEqual({ id: source, state: 'kept' });
    await expect(
      registerProvenanceSource(owner, TAJWEED_PROVENANCE, 'NON_QURAN_FIXTURE other'),
    ).rejects.toThrow(/different evidence/);
  });

  it('the owner side refuses any file but the pinned ones, registering nothing', async () => {
    const sources = await count(db.admin, 'QuranSource');
    const base = {
      owner,
      runtime,
      operator,
      annotations,
      text,
      environment: process.env,
    };
    await expect(importTajweedOverlay({ ...base, ...digests })).rejects.toThrow(
      /not the recorded tajweed file digests/,
    );
    await expect(
      importTajweedOverlay({
        ...base,
        sha256: TAJWEED_ANNOTATIONS_SHA256,
        textSha256: TAJWEED_BASE_TEXT_SHA256,
      }),
    ).rejects.toThrow(/not the recorded ones/);
    expect(await count(db.admin, 'QuranSource')).toBe(sources);
    expect(await tables()).toEqual(NOTHING);
  });

  it('refuses another file, an operator without quran.administer, and a source this corpus is not', async () => {
    await expect(run({ sha256: 'f'.repeat(64) })).rejects.toThrow(/not the one recorded/);
    const reader = await accountWith(db.admin, ['quran.read']);
    await expect(run({ operator: reader })).rejects.toThrow(
      /does not hold quran\.administer/,
    );
    // An annotated Ayah the corpus does not hold (Surah 1 has three).
    const body = annotationFile() as { surah: number; ayah: number; annotations: [] }[];
    const stray = write(
      'stray.json',
      Buffer.from(
        JSON.stringify([...body, { annotations: [], ayah: 2, surah: 3 }]),
        'utf8',
      ),
    );
    const strayBase = write(
      'stray.txt',
      Buffer.from(BASE_TEXT_FILE.replace('\r\n\r\n#', '\r\n3|2|نص\r\n\r\n#'), 'utf8'),
    );
    await expect(
      run({
        annotations: stray.file,
        sha256: stray.digest,
        text: strayBase.file,
        textSha256: strayBase.digest,
      }),
    ).rejects.toThrow(/not in the canonical corpus; nothing was changed/);
    const notJson = write('broken.json', Buffer.from('[{"surah":1,', 'utf8'));
    await expect(
      run({ annotations: notJson.file, sha256: notJson.digest }),
    ).rejects.toThrow(/not JSON; nothing was changed/);
    expect(await tables()).toEqual(NOTHING);
  });

  it('records every aligned Ayah with all its spans and the database’s own digest, as a draft', async () => {
    const summary = await run();
    expect(summary).toMatchObject({
      mode: 'tajweed',
      overlay: 'created',
      overlayState: 'draft',
      annotated: 6,
      canonical: 118,
      aligned: 5,
      unchanged: 2,
      remapped: 3,
      spans: 6,
      skipped: { 'span-on-changed-text': 1, 'too-different': 0, 'not-annotated': 112 },
      recorded: 5,
      kept: 0,
      differs: 0,
    });
    expect(await tables()).toEqual({ overlays: 1, ayat: 5, spans: 6 });
    // The skipped Ayah (1:3) records nothing; every digest is the text's own.
    expect(
      await count(
        db.admin,
        'QuranTajweedOverlayAyah',
        '[surahNumber] = 1 AND [ayahNumber] = 3',
      ),
    ).toBe(0);
    const [matched] = await db.admin.query<{ total: number }>(`
      SELECT COUNT_BIG(*) AS [total] FROM [dbo].[QuranTajweedOverlayAyah] o
      JOIN [dbo].[Ayah] a ON a.[surahNumber] = o.[surahNumber] AND a.[ayahNumber] = o.[ayahNumber]
      WHERE o.[textSha256] = HASHBYTES('SHA2_256', a.[text]);`);
    expect(Number(matched?.total)).toBe(5);
    // 2:1's spans, carried past the 2017 opening, cover the same letters.
    const spans = await db.admin.query<{ rule: string; start: number; end: number }>(`
      SELECT [rule], [startCodepoint] AS [start], [endCodepoint] AS [end]
      FROM [dbo].[QuranTajweedSpan] WHERE [surahNumber] = 2 AND [ayahNumber] = 1 ORDER BY [ordinal];`);
    expect(spans).toEqual([
      { rule: 'madd-2', start: 3, end: 5 },
      { rule: 'qalqalah', start: 6, end: 7 },
    ]);
    const [overlay] = await db.admin.query<{
      slug: string;
      state: string;
      sourceId: string;
      attribution: string;
    }>(
      `SELECT [slug],[state],[sourceId],[attribution] FROM [dbo].[QuranTajweedOverlay];`,
    );
    expect(overlay).toEqual({
      slug: tooling.TAJWEED_OVERLAY.slug,
      state: 'draft',
      sourceId: source,
      attribution: tooling.TAJWEED_OVERLAY.attribution,
    });
    // The audit names the Surah and the counts — never a letter of the text.
    const audit = await db.admin.query<{ afterState: string }>(
      `SELECT [afterState] FROM [dbo].[AuditLog] WHERE [action] LIKE N'quran.tajweed-overlay.%';`,
    );
    expect(audit.length).toBe(3);
    for (const entry of audit) expect(entry.afterState).not.toMatch(/[؀-ۿ]/u);
  });

  it('keeps everything on a second run, changing nothing', async () => {
    const before = await tables();
    expect(await run()).toMatchObject({
      overlay: 'kept',
      recorded: 0,
      kept: 5,
      differs: 0,
    });
    expect(await tables()).toEqual(before);
  });

  it('computes the same digest the database does', async () => {
    const [row] = await db.admin.query<{ digest: string }>(
      `SELECT LOWER(CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', [text]), 2)) AS [digest] FROM [dbo].[Ayah] WHERE [surahNumber] = 2 AND [ayahNumber] = 2;`,
    );
    expect(tooling.ayahTextDigest(CANONICAL[4]!.text)).toBe(row?.digest);
  });
});
