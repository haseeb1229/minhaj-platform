import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Locator, Page, Response } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  sha256,
  syntheticSilentMp3,
  syntheticStorageKey,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  PASSWORD,
  accountIdFor,
  baseUrl,
  browserEnvironment,
  enrolSecondFactorInBrowser,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
  totpCodeFor,
  asTwoVisitors,
  knowledgeOf,
  firstDifference as documentDifference,
} from './support';

/**
 * Phase 18 — the Quran in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that while no corpus is active every Quran
 * page says so honestly, or is absent, and nothing links a catalogue that does
 * not exist; that a fixture corpus is read Surah → Surah → Ayah by keyboard
 * alone, with a visible focus, the Arabic marked `lang="ar" dir="rtl"` in every
 * interface locale, each layer in its own labelled group with its own
 * language, an unknown reading preference said out loud rather than widened,
 * no motion on scripture, and no sideways scroll at 320 pixels or at 200%
 * zoom; that every page of it carries the fixture banner and `noindex`; that
 * the recitation player is the browser's own, never playing by itself and
 * never offering a download; that search finds a citation; and that the
 * administration separates reading, layered-work management and the one
 * canonical correction — the last only behind its OWN step-up purpose, and only
 * to a registered source's exact text.
 *
 * ONE SERIAL FILE, BECAUSE THE CORPUS IS A SINGLETON. A database holds at most
 * one canonical corpus and at most one activation, for its whole life. The
 * inactive proofs therefore have to run before the activation, and the
 * correction has to run against the corpus this file accepted — so they are one
 * ordered journey rather than independent files. Other spec files still run in
 * parallel with it; the one that can observe the activation (`listen.spec.ts`)
 * asserts the contract for whichever state it finds.
 *
 * NOTHING HERE IS THE QURAN. Every text is a `NON_QURAN_FIXTURE_…` sentinel
 * followed by the neutral Arabic phrase "non-Quranic test text"; the structure
 * (three ayat in Surah 1, four in Surah 2, Juz 2 beginning at 2:3) is
 * engineering scaffolding that claims nothing about any real Surah, count or
 * Juz boundary; the reciter is fictional; the audio is synthetic silence; and
 * every source is of `fixture` authority. Owner-only rows — the registered
 * sources, the accepted corpus, the activation — are written on the MIGRATION
 * connection, exactly as the operator writes them, because no HTTP path may.
 *
 * THE CANONICAL LINK IS NOT OBSERVABLE HERE, and the spec says so rather than
 * pretending. A fixture corpus is never indexable, and this deployment is
 * pre-adoption besides (ROUTE_MAP.md §9.5), so every Quran page withholds its
 * canonical link and alternates entirely — which is what is asserted below. The
 * indexable half (the bare citation, `/topics/{slug}`, `/quran/recitations`) is
 * proved where an approved, indexable corpus can be constructed:
 * `tests/seo/quran.test.ts`.
 */

// NO RETRY. The journey accepts and activates a corpus — singletons for the
// life of the run's database — so a retry could only meet its own corpus and
// refuse. A failure here is reported once, as itself, never re-run until lucky.
test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

/** Neutral Arabic: "non-Quranic test text". Never scripture. */
const NEUTRAL = 'نص اختبار غير قرآني';
/** Beh with fatha, and beh with kasra: the one-code-point difference. */
const BEH_FATHA = 'بَ';
const BEH_KASRA = 'بِ';

/** A unique word the search proof looks for, carried by one translation text. */
const WORD = `qurfixture${run}`;

/** The fictional structure: [surah, ayah, juz]. Not a real count or boundary. */
const STRUCTURE = [
  [1, 1, 1],
  [1, 2, 1],
  [1, 3, 1],
  [2, 1, 1],
  [2, 2, 1],
  [2, 3, 2],
  [2, 4, 2],
] as const;

const canonicalText = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_CANONICAL_${String(surah)}_${String(ayah)} ${NEUTRAL}${
    surah === 1 && ayah === 1 ? ` ${BEH_FATHA}` : ''
  }`;

/** The correction source's text for 1:1 — what the correction may change it to. */
const CORRECTED = `NON_QURAN_FIXTURE_CORRECTED_1_1 ${NEUTRAL} ${BEH_KASRA}`;
/** The same text with the kasra replaced by a fatha: one code point apart. */
const NEAR_MISS = `NON_QURAN_FIXTURE_CORRECTED_1_1 ${NEUTRAL} ${BEH_FATHA}`;

const translationText = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_TRANSLATION_${String(surah)}_${String(ayah)}${
    surah === 1 && ayah === 2 ? ` ${WORD}` : ''
  }`;

const ids = {
  source: randomUUID(),
  correctionSource: randomUUID(),
  acceptance: randomUUID(),
  translation: randomUUID(),
  transliteration: randomUUID(),
  tafsir: randomUUID(),
  tafsirEntry: randomUUID(),
  rule: randomUUID(),
  recitation: randomUUID(),
  segment: randomUUID(),
  asset: randomUUID(),
  reciter: randomUUID(),
  topic: randomUUID(),
};

const slug = {
  translation: `fixture-translation-${run}`,
  transliteration: `fixture-transliteration-${run}`,
  tafsir: `fixture-tafsir-${run}`,
  rule: `fixture-tajweed-${run}`,
  recitation: `fixture-recitation-${run}`,
  reciter: `fixture-reciter-${run}`,
  // Neither the slug nor the name contains the word the taxonomy spec uses to
  // find the canonical `quran` topic's row, so the two specs never collide.
  topic: `fixture-topic-${run}`,
  adminTranslation: `fixture-admin-translation-${run}`,
};

const NAME = {
  translation: `NON_QURAN_FIXTURE translation ${run}`,
  transliteration: `NON_QURAN_FIXTURE transliteration ${run}`,
  tafsir: `NON_QURAN_FIXTURE tafsir ${run}`,
  rule: `NON_QURAN_FIXTURE tajweed rule ${run}`,
  recitation: `NON_QURAN_FIXTURE recitation ${run}`,
  reciter: `Fixture Reciter One ${run}`,
  topic: `Non-scriptural fixture topic ${run}`,
  adminTranslation: `NON_QURAN_FIXTURE admin translation ${run}`,
  adminTranslationRenamed: `NON_QURAN_FIXTURE admin translation renamed ${run}`,
};

const AUDIO = syntheticSilentMp3(120);

const MESSAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'messages',
);

/** The fixture banner in each interface locale, from the shipped catalogues. */
const BANNER = Object.fromEntries(
  (['en', 'ur', 'ar'] as const).map((locale) => [
    locale,
    (
      JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as {
        quran: { fixture: string };
      }
    ).quran.fixture,
  ]),
) as Record<'en' | 'ur' | 'ar', string>;

const UNAVAILABLE = 'The Quran corpus is not yet available on this site.';

/** A SQL Server Unicode literal. Values are this file's own constants. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

async function scalar(statement: string): Promise<number> {
  const [row] = await sql.query<{ value: number }>(statement);
  return Number(row?.value ?? Number.NaN);
}

/* ===========================================================================
 * Page helpers
 * ========================================================================= */

/** Every link target in the page's main region. */
function hrefsIn(page: Page): Promise<string[]> {
  return page
    .getByRole('main')
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

/**
 * No Quran page links a teacher surface — none exists (§5). `/quran/courses` is
 * Learning's related view since Phase 22, so it is no longer absent.
 */
async function expectNoLearningLinks(page: Page, where: string): Promise<void> {
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(
    hrefs.filter((href) => /\/quran\/teachers\b/.test(href)),
    where,
  ).toEqual([]);
}

/**
 * Visits a public fixture-corpus page and asserts what EVERY such page owes:
 * a 200 with no cookie, the fixture banner in words, `noindex`, no canonical
 * claim, and no link to a surface that does not exist.
 */
async function visitFixture(
  page: Page,
  target: string,
  locale: 'en' | 'ur' | 'ar' = 'en',
): Promise<Response> {
  const response = await page.goto(target);
  expect(response?.status(), target).toBe(200);
  expect(response?.headers()['set-cookie'], target).toBeUndefined();
  await expect(
    page.getByRole('note').filter({ hasText: BANNER[locale] }).first(),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  await expectNoLearningLinks(page, target);
  return response as Response;
}

/** Moves focus by Tab alone until it lands on `target`. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  const handle = await target.elementHandle();
  if (handle === null) throw new Error('The keyboard target is not on the page.');
  let reached = false;
  for (let step = 0; step < 120 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await handle.evaluate((element) => document.activeElement === element);
  }
  expect(reached, 'reached by Tab alone').toBe(true);
}

/** Horizontal overflow of the document, in CSS pixels (≤ 0 means none). */
function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/* ===========================================================================
 * Fixture
 * ========================================================================= */

/** A clean audio Asset row, and its synthetic bytes in the run's storage root. */
async function seedAsset(id: string): Promise<void> {
  const key = syntheticStorageKey();
  const file = path.join(browserEnvironment().storageRoot, ...key.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, AUDIO);
  await sql.query(
    `INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt]) VALUES (N'${id}',N'${key}',N'audio/mpeg',${String(AUDIO.byteLength)},N'${sha256(AUDIO)}',N'clean',SYSUTCDATETIME());`,
  );
}

/**
 * The registered sources and the ACCEPTED canonical corpus — but no activation.
 * Until `QuranActivation` has its row, the public Quran is inactive whatever
 * else exists, which is the first state this file proves.
 */
async function seedCorpus(): Promise<void> {
  const ayat = STRUCTURE.map(
    ([surah, ayah, juz]) =>
      `(N'${ids.source}', ${String(surah)}, ${String(ayah)}, ${String(juz)}, ${n(canonicalText(surah, ayah))})`,
  ).join(',');
  await sql.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script]) VALUES
      (N'${ids.source}', N'NON_QURAN_FIXTURE_BROWSER_${run}', N'fixture', N'NON_QURAN_FIXTURE browser source', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE'),
      (N'${ids.correctionSource}', N'NON_QURAN_FIXTURE_BROWSER_CORRECTION_${run}', N'fixture', N'NON_QURAN_FIXTURE browser correction source', N'fixture-2', N'utf-8', NULL);
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic]) VALUES
      (N'${ids.source}', 1, 3, NULL, N'NON_QURAN_FIXTURE_SURAH_1'),
      (N'${ids.source}', 2, 4, NULL, N'NON_QURAN_FIXTURE_SURAH_2'),
      (N'${ids.correctionSource}', 1, 1, NULL, NULL);
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[text]) VALUES
      ${ayat},
      (N'${ids.correctionSource}', 1, 1, 1, ${n(CORRECTED)});

    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
      VALUES (N'${ids.acceptance}', N'corpus-acceptance', N'passed', N'${ids.source}', ${String(STRUCTURE.length)}, 0, NULL, SYSUTCDATETIME());
    INSERT INTO [dbo].[Juz] ([number],[sourceId],[createdAt]) VALUES
      (1, N'${ids.source}', SYSUTCDATETIME()), (2, N'${ids.source}', SYSUTCDATETIME());
    INSERT INTO [dbo].[Surah] ([number],[ayahCount],[revelation],[nameArabic],[sourceId],[createdAt],[updatedAt]) VALUES
      (1, 3, NULL, N'NON_QURAN_FIXTURE_SURAH_1', N'${ids.source}', SYSUTCDATETIME(), SYSUTCDATETIME()),
      (2, 4, NULL, N'NON_QURAN_FIXTURE_SURAH_2', N'${ids.source}', SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],[version],[createdAt],[updatedAt])
      SELECT [surahNumber],[ayahNumber],[juzNumber],[text],[sourceId],1,SYSUTCDATETIME(),SYSUTCDATETIME()
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${ids.source}';
    INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
      SELECT [surahNumber],[ayahNumber],1,[text],[sourceId],N'${ids.acceptance}',NULL,NULL,NULL,SYSUTCDATETIME()
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${ids.source}';
    INSERT INTO [dbo].[SurahName] ([surahNumber],[locale],[name]) VALUES
      (1, N'en', N'NON_QURAN_FIXTURE Surah One'),
      (2, N'en', N'NON_QURAN_FIXTURE Surah Two');
  `);
}

/**
 * The layered works, each PUBLISHED with the registered fixture source — so the
 * only thing standing between them and the public is the activation.
 */
async function seedWorks(): Promise<void> {
  await seedAsset(ids.asset);
  const translationRows = STRUCTURE.map(
    ([surah, ayah]) =>
      `(N'${ids.translation}', ${String(surah)}, ${String(ayah)}, ${n(translationText(surah, ayah))})`,
  ).join(',');
  await sql.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${ids.reciter}', N'${slug.reciter}', N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (N'${ids.reciter}', N'en', ${n(NAME.reciter)}, NULL);

    INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[description],[attribution],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.translation}', N'${slug.translation}', N'en', ${n(NAME.translation)}, N'NON_QURAN_FIXTURE browser translation.', NULL, N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES ${translationRows};
    UPDATE [dbo].[QuranTranslation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.translation}';

    INSERT INTO [dbo].[QuranTransliteration] ([id],[slug],[languageCode],[name],[scheme],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.transliteration}', N'${slug.transliteration}', N'en', ${n(NAME.transliteration)}, N'NON_QURAN_FIXTURE scheme', N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTransliterationText] ([transliterationId],[surahNumber],[ayahNumber],[text]) VALUES
      (N'${ids.transliteration}', 1, 1, N'NON_QURAN_FIXTURE_TRANSLITERATION_1_1'),
      (N'${ids.transliteration}', 1, 2, N'NON_QURAN_FIXTURE_TRANSLITERATION_1_2');
    UPDATE [dbo].[QuranTransliteration] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.transliteration}';

    INSERT INTO [dbo].[QuranTafsir] ([id],[slug],[languageCode],[name],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.tafsir}', N'${slug.tafsir}', N'ur', ${n(NAME.tafsir)}, N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTafsirText] ([id],[tafsirId],[surahNumber],[startAyah],[endAyah],[text]) VALUES
      (N'${ids.tafsirEntry}', N'${ids.tafsir}', 1, 1, 3, ${n(`NON_QURAN_FIXTURE_TAFSIR_1_1 ${NEUTRAL}`)});
    UPDATE [dbo].[QuranTafsir] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.tafsir}';

    INSERT INTO [dbo].[QuranTajweedRule] ([id],[slug],[position],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.rule}', N'${slug.rule}', 0, N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTajweedRuleText] ([ruleId],[languageCode],[title],[body]) VALUES
      (N'${ids.rule}', N'en', ${n(NAME.rule)}, N'NON_QURAN_FIXTURE rule body.');
    UPDATE [dbo].[QuranTajweedRule] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.rule}';

    INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[style],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.recitation}', N'${slug.recitation}', N'${ids.reciter}', ${n(NAME.recitation)}, N'NON_QURAN_FIXTURE style', N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah],[assetId],[createdAt]) VALUES
      (N'${ids.segment}', N'${ids.recitation}', 1, 1, 3, N'${ids.asset}', SYSUTCDATETIME());
    UPDATE [dbo].[QuranRecitation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.recitation}';

    INSERT INTO [dbo].[Topic] ([id],[slug],[parentId],[position],[status],[system]) VALUES
      (N'${ids.topic}', N'${slug.topic}', NULL, 951, N'active', 0);
    INSERT INTO [dbo].[TopicTranslation] ([topicId],[locale],[name],[description]) VALUES
      (N'${ids.topic}', N'en', ${n(NAME.topic)}, NULL);
    INSERT INTO [dbo].[QuranTopic] ([surahNumber],[ayahNumber],[topicId]) VALUES (1, 2, N'${ids.topic}');
  `);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  // THE CORPUS IS A SINGLETON FOR THE LIFE OF THE DATABASE. A second attempt in
  // the same run (a CI retry) finds the first attempt's corpus and cannot
  // re-prove the inactive state, so it fails here, saying why, rather than
  // failing later on a trigger refusal that would look like a product defect.
  const existing = await scalar(
    'SELECT (SELECT COUNT_BIG(*) FROM [dbo].[Ayah]) + (SELECT COUNT_BIG(*) FROM [dbo].[QuranActivation]) AS [value];',
  );
  if (existing !== 0)
    throw new Error(
      'This run’s database already holds a Quran corpus; the Quran journey can run once per database.',
    );

  await seedCorpus();
  await seedWorks();
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. No corpus is active
 * ========================================================================= */

test.describe('while no corpus is active', () => {
  test('the landing says so honestly — no cards, no counts, no banner, no cookie', async ({
    page,
  }) => {
    const response = await page.goto('/en/quran');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1, name: 'Quran' })).toBeVisible();
    await expect(page.getByText(UNAVAILABLE)).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );

    // Nothing to enter: no section card, no count, no sample, no search — only
    // the way home.
    const hrefs = await hrefsIn(page);
    expect(hrefs).toContain('/en');
    expect(hrefs.filter((href) => href.includes('/quran'))).toEqual([]);
    const main = page.getByRole('main');
    await expect(main).not.toContainText('NON_QURAN_FIXTURE');
    await expect(main).not.toContainText(/\bayat\b|\bayah\b|\bSurah\b|\bJuz\b/);
    await expect(main.getByRole('search')).toHaveCount(0);
    await expectNoLearningLinks(page, '/en/quran');

    // Quran search, too, is honestly unavailable rather than an empty search.
    const search = await page.goto(`/en/quran/search?q=${WORD}`);
    expect(search?.status()).toBe(200);
    expect(search?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByText(UNAVAILABLE)).toBeVisible();
    await expect(page.getByRole('search')).toHaveCount(0);
  });

  test('a Surah, an Ayah, a Juz, a topic view and the Listen catalogue are absent', async ({
    request,
  }) => {
    for (const missing of [
      '/en/quran/surah/1',
      '/en/quran/surah/1/1',
      '/en/quran/juz/1',
      `/en/quran/topics/${slug.topic}`,
      '/en/listen/recitations',
      '/ur/listen/recitations',
      '/en/quran/teachers',
    ]) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
      expect(response.headers()['set-cookie'], missing).toBeUndefined();
    }
  });

  test('Listen links no recitation catalogue', async ({ page }) => {
    await page.goto('/en/listen');
    await expect(page.getByRole('heading', { level: 1, name: 'Listen' })).toBeVisible();
    const hrefs = await hrefsIn(page);
    expect(hrefs).toContain('/en/listen/lectures');
    expect(hrefs.some((href) => href.includes('recitation'))).toBe(false);
  });
});

/* ===========================================================================
 * 2. A fixture corpus is active
 * ========================================================================= */

test.describe('a fixture corpus', () => {
  test.beforeAll(async () => {
    // THE OPERATOR'S ACT: activation, checked by the database against the
    // accepted corpus. Its search intents are owed from now on — written after
    // the activation, because the projection is empty while no corpus is
    // active and an earlier sweep would have consumed them for nothing.
    await sql.query(`
      INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[activatedAt],[authorisedBy])
        VALUES (1, N'${ids.source}', SYSUTCDATETIME(), N'NON_QURAN_FIXTURE browser operator');
      INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES
        ${STRUCTURE.map(([surah, ayah]) => `(N'quran-ayah', N'${String(surah)}:${String(ayah)}')`).join(',')};
    `);
  });

  test('the landing offers only what exists, under the banner', async ({ page }) => {
    await visitFixture(page, '/en/quran');
    await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
    const hrefs = await hrefsIn(page);
    for (const section of [
      'read',
      'surah',
      'juz',
      'translations',
      'tafsir',
      'transliteration',
      'tajweed',
      'recitations',
    ])
      expect(hrefs, section).toContain(`/en/quran/${section}`);
    // No statistics and no sample verse on the landing.
    await expect(page.getByRole('main')).not.toContainText('NON_QURAN_FIXTURE_CANONICAL');
  });

  test('reads Surah index → Surah → Ayah by keyboard alone, with a visible focus', async ({
    page,
  }) => {
    await visitFixture(page, '/en/quran/surah');
    const index = page.getByRole('list', { name: 'Surahs' });
    await expect(index.getByRole('listitem')).toHaveCount(2);
    await expect(index).toContainText('3 ayat');
    await expect(index).toContainText('4 ayat');

    await tabTo(page, index.getByRole('link', { name: /^Surah 1\b/ }));
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/en\/quran\/surah\/1$/);
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();

    const article = page.getByRole('article', { name: 'Surah 1, Ayah 2' });
    await expect(article).toBeVisible();
    await expect(page.locator('li#ayah-2')).toContainText(canonicalText(1, 2));
    const citation = article.getByRole('link', { name: '1:2' });
    await expect(citation).toHaveAttribute('href', '/en/quran/surah/1/2');

    await tabTo(page, citation);
    const focus = await citation.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        visible: element.matches(':focus-visible'),
        outline: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
        shadow: style.boxShadow,
      };
    });
    expect(focus.visible).toBe(true);
    expect(
      (focus.outline !== 'none' && focus.width > 0) || focus.shadow !== 'none',
      JSON.stringify(focus),
    ).toBe(true);

    await page.keyboard.press('Enter');
    await page.waitForURL(/\/en\/quran\/surah\/1\/2$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Surah 1, Ayah 2' }),
    ).toBeVisible();

    const next = page
      .getByRole('navigation', { name: 'Previous and next Ayah' })
      .getByRole('link', { name: 'Next Ayah (1:3)' });
    await tabTo(page, next);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/en\/quran\/surah\/1\/3$/);
  });

  test('marks the Arabic as Arabic, right-to-left, in every interface locale', async ({
    page,
  }) => {
    for (const locale of ['en', 'ur', 'ar'] as const) {
      await visitFixture(
        page,
        `/${locale}/quran/surah/1/2?translation=${slug.translation}`,
        locale,
      );
      const arabic = page.locator('[aria-labelledby="ayah-arabic"] p');
      await expect(arabic).toHaveText(canonicalText(1, 2));
      await expect(arabic).toHaveAttribute('lang', 'ar');
      await expect(arabic).toHaveAttribute('dir', 'rtl');

      // The translation is its OWN labelled group, in its own language and
      // direction — English, even inside an Urdu or Arabic interface.
      const translation = page.locator('[aria-labelledby="ayah-translation"]');
      await expect(translation).toHaveCount(1);
      const text = translation.locator('p[lang]');
      await expect(text).toHaveText(translationText(1, 2));
      await expect(text).toHaveAttribute('lang', 'en');
      await expect(text).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('#ayah-translation')).toContainText(NAME.translation);

      // On the Surah page every Ayah is a named article with Arabic marked too.
      await visitFixture(page, `/${locale}/quran/surah/2`, locale);
      const scripture = page.locator('article p[lang="ar"]');
      await expect(scripture).toHaveCount(4);
      for (const element of await scripture.all()) {
        await expect(element).toHaveAttribute('dir', 'rtl');
      }
      const named = await page
        .locator('li[id^="ayah-"] > article')
        .evaluateAll((articles) =>
          articles.map((a) => a.getAttribute('aria-label') ?? ''),
        );
      expect(named).toHaveLength(4);
      for (const name of named) expect(name.length, locale).toBeGreaterThan(0);
    }
    await page.goto('/en/quran/surah/2');
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 3' })).toBeVisible();
  });

  test('withholds the canonical claim, even with reading preferences in the address', async ({
    page,
  }) => {
    await visitFixture(
      page,
      `/en/quran/surah/1/2?translation=${slug.translation}&reciter=${slug.recitation}`,
    );
    // The preferences are honoured on the page...
    await expect(page.locator('[aria-labelledby="ayah-translation"]')).toHaveCount(1);
    await expect(page.locator('audio')).toHaveCount(1);
    // ...and the page makes NO canonical or alternate claim at all: fixture text
    // is never indexable. The bare-citation canonical of an approved corpus is
    // proved in `tests/seo/quran.test.ts`.
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  });

  test('says an unknown reading preference is unavailable, and shows no layer for it', async ({
    page,
  }) => {
    await visitFixture(page, '/en/quran/surah/1/2?translation=nope&tafsir=nope');
    const main = page.getByRole('main');
    await expect(
      main.getByText(
        'The translation you asked for is not available, so no translation is shown.',
      ),
    ).toBeVisible();
    await expect(
      main.getByText('The tafsir you asked for is not available, so no tafsir is shown.'),
    ).toBeVisible();
    await expect(page.locator('[aria-labelledby="ayah-translation"]')).toHaveCount(0);
    await expect(page.locator('#ayah-tafsir')).toHaveCount(0);
    // Not widened to another work: the form offers the public works, but none
    // is chosen, and no layer text is on the page.
    await expect(page.locator('#reading-translation')).toHaveValue('');
    await expect(page.locator('#reading-tafsir')).toHaveValue('');
    await expect(main).not.toContainText('NON_QURAN_FIXTURE_TRANSLATION');
    await expect(main).not.toContainText('NON_QURAN_FIXTURE_TAFSIR');

    // A draft work is as unknown as a made-up one: naming it reaches nothing.
    await visitFixture(page, `/en/quran/surah/1?translation=${slug.adminTranslation}`);
    await expect(
      main.getByText(
        'The translation you asked for is not available, so no translation is shown.',
      ),
    ).toBeVisible();
  });

  test('a Surah reflows at 320px and at 200% zoom, and nothing on scripture moves', async ({
    page,
  }) => {
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of [
        `/en/quran/surah/1?translation=${slug.translation}&transliteration=${slug.transliteration}&tafsir=${slug.tafsir}&reciter=${slug.recitation}&size=larger`,
        '/ur/quran/surah/2',
        `/ar/quran/surah/1/1?translation=${slug.translation}`,
      ]) {
        await page.goto(target);
        expect(
          await overflowOf(page),
          `${String(width)}px ${target}`,
        ).toBeLessThanOrEqual(0);
      }
    }

    // NO MOTION ON SCRIPTURE — with no reduced-motion preference, so a real
    // animation or transition would show here.
    await page.goto(`/en/quran/surah/1?translation=${slug.translation}`);
    const motion = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          'main [lang="ar"], main [role="group"], main li[id^="ayah-"], main li[id^="ayah-"] > article',
        ),
      ].map((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          animation: style.animationName,
          transition: style.transitionDuration,
        };
      }),
    );
    expect(motion.length).toBeGreaterThan(6);
    for (const style of motion) {
      expect(style.animation).toBe('none');
      for (const part of style.transition.split(', '))
        expect(Number.parseFloat(part), style.transition).toBe(0);
    }
  });

  test('a Juz lists its ayat, each linking to its citation', async ({ page }) => {
    await visitFixture(page, '/en/quran/juz');
    const list = page.getByRole('list', { name: 'Juz' });
    await expect(list.getByRole('link', { name: 'Juz 1' })).toHaveAttribute(
      'href',
      '/en/quran/juz/1',
    );
    await expect(list).toContainText('From 2:3 to 2:4');

    await visitFixture(page, '/en/quran/juz/2');
    for (const ayah of [3, 4]) {
      const article = page.getByRole('article', {
        name: `Surah 2, Ayah ${String(ayah)}`,
      });
      await expect(
        article.getByRole('link', { name: `2:${String(ayah)}` }),
      ).toHaveAttribute('href', `/en/quran/surah/2/${String(ayah)}`);
      await expect(article.locator('p[lang="ar"]')).toHaveText(canonicalText(2, ayah));
    }
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 2' })).toHaveCount(0);
  });

  test('the study pages render the published fixture works', async ({ page }) => {
    await visitFixture(page, '/en/quran/translations');
    await page.getByRole('link', { name: NAME.translation }).click();
    await page.waitForURL(`**/en/quran/translations/${slug.translation}`);
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.translation);
    expect(await hrefsIn(page)).toContain(
      `/en/quran/surah/1?translation=${slug.translation}`,
    );

    await visitFixture(page, `/en/quran/tafsir/${slug.tafsir}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.tafsir);
    const entry = page.getByRole('link', { name: 'Surah 1, ayat 1–3' });
    await expect(entry).toHaveAttribute(
      'href',
      `/en/quran/surah/1/1?tafsir=${slug.tafsir}`,
    );
    const commentary = page.locator(
      'ol[aria-labelledby="tafsir-entries"] div[lang="ur"]',
    );
    await expect(commentary).toHaveAttribute('dir', 'rtl');
    await expect(commentary).toContainText('NON_QURAN_FIXTURE_TAFSIR_1_1');

    await visitFixture(page, '/en/quran/transliteration');
    await expect(page.getByRole('main')).toContainText(NAME.transliteration);

    await visitFixture(page, '/en/quran/tajweed');
    await page.getByRole('link', { name: NAME.rule }).click();
    await page.waitForURL(`**/en/quran/tajweed/${slug.rule}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.rule);
    await expect(page.getByRole('main')).toContainText('NON_QURAN_FIXTURE rule body.');

    // A layer chosen on an Ayah page: the tafsir in its own language, open.
    await visitFixture(
      page,
      `/en/quran/surah/1/1?tafsir=${slug.tafsir}&transliteration=${slug.transliteration}`,
    );
    await expect(
      page.locator('section[aria-labelledby="ayah-tafsir"] [lang="ur"]'),
    ).toContainText('NON_QURAN_FIXTURE_TAFSIR_1_1');
    await expect(
      page.locator('[aria-labelledby="ayah-transliteration"] p[lang="en"]'),
    ).toHaveText('NON_QURAN_FIXTURE_TRANSLITERATION_1_1');
  });

  test('a topic view lists its ayat and points at the Topic hub', async ({ page }) => {
    await visitFixture(page, `/en/quran/topics/${slug.topic}`);
    const ayah = page.getByRole('article', { name: 'Surah 1, Ayah 2' });
    await expect(ayah.getByRole('link')).toHaveAttribute('href', '/en/quran/surah/1/2');
    expect(await hrefsIn(page)).toContain(`/en/topics/${slug.topic}`);
    await expect(page.getByRole('article', { name: 'Surah 1, Ayah 1' })).toHaveCount(0);

    // The hub composes the same ayat, under the banner, and links the view.
    const hub = await page.goto(`/en/topics/${slug.topic}`);
    expect(hub?.status()).toBe(200);
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();
    expect(await hrefsIn(page)).toContain(`/en/quran/topics/${slug.topic}`);

    const unknown = await page.goto(`/en/quran/topics/no-such-topic-${run}`);
    expect(unknown?.status()).toBe(404);
  });

  test('the recitation player is the browser’s own, silent until asked, with no download', async ({
    page,
    request,
  }) => {
    await visitFixture(page, `/en/quran/surah/1?reciter=${slug.recitation}`);
    const audio = page.locator('audio');
    await expect(audio).toHaveCount(1);
    await expect(audio).toHaveAttribute('controls', '');
    await expect(audio).toHaveAttribute('preload', 'none');
    await expect(audio).toHaveAttribute(
      'src',
      `/assets/quran/recitations/${ids.recitation}/${ids.segment}/${ids.asset}`,
    );
    await expect(audio).toHaveAttribute(
      'aria-label',
      `${NAME.recitation} — Surah 1, ayat 1–3`,
    );
    expect(await audio.getAttribute('autoplay')).toBeNull();
    expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(
      true,
    );
    await expect(page.getByRole('link', { name: /download/i })).toHaveCount(0);
    expect(
      await page.locator('a[download]').count(),
      'no download attribute anywhere',
    ).toBe(0);

    // The bytes are first-party, cookie-free, and served only for this segment.
    const bytes = await request.get(
      `/assets/quran/recitations/${ids.recitation}/${ids.segment}/${ids.asset}`,
    );
    expect(bytes.status()).toBe(200);
    expect(bytes.headers()['content-type']).toBe('audio/mpeg');
    expect(bytes.headers()['set-cookie']).toBeUndefined();
    const wrong = await request.get(
      `/assets/quran/recitations/${ids.recitation}/${randomUUID()}/${ids.asset}`,
    );
    expect(wrong.status()).toBe(404);

    // The reciter's page, by the PERSON's slug, carries the same native player.
    await visitFixture(page, `/en/quran/recitations/${slug.reciter}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(NAME.reciter);
    await expect(page.locator('audio[controls]')).toHaveCount(1);
    expect(await page.locator('audio[autoplay]').count()).toBe(0);
  });

  test('Listen projects Quran’s recitation catalogue — and only Quran’s', async ({
    page,
  }) => {
    await page.goto('/en/listen');
    expect(await hrefsIn(page)).toContain('/en/listen/recitations');

    await visitFixture(page, '/en/listen/recitations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Recitations' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'All recitations in the Quran section' }),
    ).toHaveAttribute('href', '/en/quran/recitations');
    const rows = page.getByRole('list', { name: 'Recitations' }).getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByRole('heading')).toHaveText(NAME.recitation);
    await expect(rows.first().getByRole('link', { name: NAME.reciter })).toHaveAttribute(
      'href',
      `/en/quran/recitations/${slug.reciter}`,
    );
    // Nothing of Media's: no lecture, no audio track, no Media byte route.
    const hrefs = await hrefsIn(page);
    expect(hrefs.filter((href) => href.includes('/listen/lectures'))).toEqual([]);
    await expect(page.locator('audio[src*="/assets/media/"]')).toHaveCount(0);

    // The Quran section's own catalogue lists the same recitation.
    await visitFixture(page, '/en/quran/recitations');
    await expect(page.getByRole('main')).toContainText(NAME.recitation);
  });

  test('search finds the citation — on a page that is never indexed', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // DERIVED WORK: the running sweep indexes asynchronously (§8.5), so the
    // page is polled — never slept on — until the citation appears.
    await expect
      .poll(
        async () => {
          const response = await page.goto(
            `/en/quran/search?q=${encodeURIComponent(WORD)}`,
          );
          expect(response?.status()).toBe(200);
          await page.getByRole('heading', { level: 1 }).waitFor();
          return page.getByRole('main').innerText();
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toContain('Surah 1, Ayah 2');

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();
    const hit = page.getByRole('link', { name: 'Surah 1, Ayah 2' });
    await expect(hit).toHaveAttribute('href', '/en/quran/surah/1/2');
    await expect(page.getByRole('main')).toContainText(translationText(1, 2));
    await expect(page.getByRole('link', { name: 'Surah 1, Ayah 1' })).toHaveCount(0);
  });
});

/* ===========================================================================
 * 2b. A reader's own reading position (Phase 21)
 * ========================================================================= */

/**
 * HERE, BECAUSE THE CORPUS IS. A reading position can only be set on an Ayah
 * that is public now, and this file owns the run's one corpus — so the island
 * on an Ayah page is proved against it, while it is active, rather than by a
 * spec that would have to hope another had activated it first.
 */
test.describe('a reader’s own reading position', () => {
  const ISLAND = (
    JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')) as {
      personalIsland: Record<string, string>;
    }
  ).personalIsland;
  const PROGRESS = (
    JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')) as {
      personal: { progress: Record<string, string>; home: Record<string, string> };
    }
  ).personal;

  const AYAH = '/en/quran/surah/2/3';
  let reader: Page;
  let readerId: string;

  const island = (page: Page) =>
    page.getByRole('region', { name: ISLAND['heading'] ?? '' });

  /** Opens a citation and waits for the island's private read. */
  async function openWithIsland(page: Page, target: string): Promise<void> {
    const state = page.waitForResponse((response) =>
      response.url().includes('/api/my/target-state'),
    );
    await visitFixture(page, target);
    expect((await state).status(), target).toBe(200);
  }

  async function position(): Promise<{ surah: number; ayah: number } | null> {
    const [row] = await sql.query<{ surah: number; ayah: number }>(
      `SELECT [surahNumber] AS [surah],[ayahNumber] AS [ayah] FROM [dbo].[QuranReadingProgress] WHERE [userId]=N'${readerId}';`,
    );
    return row === undefined
      ? null
      : { surah: Number(row.surah), ayah: Number(row.ayah) };
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.242.1' },
    });
    contexts.push(context);
    reader = await context.newPage();
    const { email } = await registerAndSignIn(reader, 'quran-position');
    readerId = await accountIdFor(sql, email);
  });

  test('the citation is the same document signed in and signed out', async ({
    request,
  }) => {
    const { anonymous, signedIn } = await asTwoVisitors(
      request,
      reader.context().request,
      AYAH,
    );
    expect(anonymous.status()).toBe(200);
    expect(signedIn.status()).toBe(200);
    expect(anonymous.headers()['set-cookie']).toBeUndefined();
    expect(signedIn.headers()['set-cookie']).toBeUndefined();
    const html = await anonymous.text();
    expect(html).toContain(canonicalText(2, 3));
    // BYTE FOR BYTE: nothing per-visitor reaches the shared render.
    expect(
      documentDifference(knowledgeOf(html), knowledgeOf(await signedIn.text())),
      'the Ayah differs signed in',
    ).toBe('identical');
    expect(html).not.toContain('aria-pressed');
  });

  test('signed out, the island offers sign-in with the way back to the Ayah', async ({
    page,
  }) => {
    await openWithIsland(page, AYAH);
    const region = island(page);
    await expect(region).toContainText(ISLAND['signedOutPrompt'] ?? '');
    await expect(region.getByRole('link', { name: ISLAND['signIn'] })).toHaveAttribute(
      'href',
      `/en/signin?returnTo=${encodeURIComponent(AYAH)}`,
    );
    await expect(region.getByRole('button')).toHaveCount(0);
  });

  test('set from the Ayah, shown on My Minhaj, refused from a stale page, and cleared', async () => {
    test.setTimeout(120_000);
    await reader.goto('/en/my/progress/quran');
    await expect(reader.getByRole('main')).toContainText(
      PROGRESS.progress['empty'] ?? '',
    );

    await openWithIsland(reader, AYAH);
    const region = island(reader);
    await region.getByRole('button', { name: ISLAND['positionSet'] }).click();
    await expect(reader.getByText(ISLAND['positionSaved'] ?? '')).toBeVisible();
    await expect(region).toContainText(ISLAND['positionCurrent'] ?? '');
    await expect(region.getByRole('button', { name: ISLAND['positionSet'] })).toHaveCount(
      0,
    );
    expect(await position()).toEqual({ surah: 2, ayah: 3 });

    await reader.goto('/en/my/progress/quran');
    await expect(
      reader.getByRole('link', { name: PROGRESS.progress['continue'] }),
    ).toHaveAttribute('href', AYAH);
    await reader.goto('/en/my');
    const main = reader.getByRole('main');
    await expect(main).not.toContainText(PROGRESS.home['quranNone'] ?? '');
    await expect(
      main.getByRole('link', { name: PROGRESS.progress['continue'] }),
    ).toHaveAttribute('href', AYAH);

    // A STALE PAGE. One tab read the position's version before another moved
    // it; its own attempt is a conflict, not an overwrite — and, refreshed,
    // its retry is honoured.
    const stale = await reader.context().newPage();
    await openWithIsland(stale, '/en/quran/surah/2/4');
    await openWithIsland(reader, '/en/quran/surah/2/2');
    await island(reader).getByRole('button', { name: ISLAND['positionSet'] }).click();
    await expect(reader.getByText(ISLAND['positionSaved'] ?? '')).toBeVisible();
    expect(await position()).toEqual({ surah: 2, ayah: 2 });

    await island(stale).getByRole('button', { name: ISLAND['positionSet'] }).click();
    await expect(stale.getByText(ISLAND['positionConflict'] ?? '')).toBeVisible();
    expect(await position()).toEqual({ surah: 2, ayah: 2 });
    await island(stale).getByRole('button', { name: ISLAND['positionSet'] }).click();
    await expect(stale.getByText(ISLAND['positionSaved'] ?? '')).toBeVisible();
    expect(await position()).toEqual({ surah: 2, ayah: 4 });
    await stale.close();

    await reader.goto('/en/my/progress/quran');
    await reader.getByRole('button', { name: PROGRESS.progress['clear'] }).click();
    await expect(reader.getByRole('main')).toContainText(
      PROGRESS.progress['empty'] ?? '',
    );
    expect(await position()).toBeNull();
    await reader.goto('/en/my');
    await expect(reader.getByRole('main')).toContainText(
      PROGRESS.home['quranNone'] ?? '',
    );
  });
});

/* ===========================================================================
 * 3. Administration
 * ========================================================================= */

test.describe('Quran administration', () => {
  let nobody: Page;
  let reader: Page;
  let administrator: Page;
  let canonical: Page;
  let canonicalAccount: string;
  let canonicalTotp: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts: [string, readonly string[]][] = [
      ['quran-nobody', []],
      ['quran-reader', ['quran.read']],
      ['quran-administer', ['quran.read', 'quran.administer']],
      ['quran-canonical', ['quran.read', 'quran.editCanonical']],
    ];
    const pages: Page[] = [];
    for (const [index, [prefix, keys]] of accounts.entries()) {
      const context = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.248.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, prefix);
      const accountId = await accountIdFor(sql, email);
      if (keys.length > 0) await grantRole(sql, accountId, keys, 'Quran browser proof');
      if (prefix === 'quran-canonical') canonicalAccount = accountId;
      pages.push(page);
    }
    [nobody, reader, administrator, canonical] = pages as [Page, Page, Page, Page];

    // The canonical authority needs a COMPLETE privileged posture: a second
    // factor enrolled and its recovery codes confirmed, through the UI.
    canonicalTotp = (await enrolSecondFactorInBrowser(canonical)).totpUri;
  });

  test('an anonymous visitor is sent to sign in; an account without a Quran key is refused', async ({
    page,
  }) => {
    await page.goto('/en/admin/quran/ayat/1/1');
    await page.waitForURL(/\/en\/signin\?returnTo=/);

    for (const surface of [
      'surahs',
      'ayat',
      'ayat/1/1',
      'translations',
      `translations/${ids.translation}`,
    ]) {
      const response = await nobody.goto(`/en/admin/quran/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('quran.read reads the canonical text, and is offered nothing to change', async () => {
    const response = await reader.goto('/en/admin/quran/ayat/1/1');
    expect(response?.status()).toBe(200);
    const main = reader.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Canonical text' })).toBeVisible();
    await expect(
      main.locator('p[lang="ar"]', { hasText: canonicalText(1, 1) }).first(),
    ).toBeVisible();
    await expect(main).toContainText('Read-only.');
    await expect(main.getByRole('link', { name: 'Begin a correction' })).toHaveCount(0);

    // Asking for the correction by address shows nothing either.
    await reader.goto('/en/admin/quran/ayat/1/1?correct=1');
    await expect(
      reader.getByRole('heading', { name: 'Canonical correction' }),
    ).toHaveCount(0);
    await expect(reader.locator('textarea')).toHaveCount(0);

    // Layered works are read, not edited.
    await reader.goto(`/en/admin/quran/translations/${ids.translation}?surah=1`);
    await expect(reader.getByRole('main')).toContainText(translationText(1, 2));
    await expect(reader.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: 'Save changed texts' })).toHaveCount(
      0,
    );
    await reader.goto('/en/admin/quran/translations');
    await expect(reader.getByRole('heading', { name: 'New translation' })).toHaveCount(0);
  });

  test('quran.administer creates, edits and publishes a translation — and never touches the Arabic', async () => {
    test.setTimeout(120_000);
    const page = administrator;
    await page.goto('/en/admin/quran/translations');
    await page.locator('#new-translation-slug').fill(slug.adminTranslation);
    await page.locator('#new-translation-name').fill(NAME.adminTranslation);
    await page.locator('#new-translation-language').selectOption('en');
    await page.locator('#new-translation-source').selectOption(ids.source);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/en\/admin\/quran\/translations\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop() ?? '';

    // Edit its metadata.
    await page.locator('#translation-name').fill(NAME.adminTranslationRenamed);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved.' }).first(),
    ).toBeVisible();

    // Edit its texts, Surah 1, beside the read-only Arabic.
    await page.locator('#surah-picker').selectOption('1');
    await page.getByRole('button', { name: 'Show' }).click();
    await page.waitForURL(/\?surah=1/);
    for (const ayah of [1, 2, 3])
      await page
        .locator(`#text-${String(ayah)}`)
        .fill(`NON_QURAN_FIXTURE_ADMIN_TRANSLATION_1_${String(ayah)}`);
    await page.getByRole('button', { name: 'Save changed texts' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved.' }).first(),
    ).toBeVisible();

    // Publish it.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .poll(async () => {
        const [row] = await sql.query<{ state: string; name: string; count: number }>(
          `SELECT [state],[name],(SELECT COUNT(*) FROM [dbo].[QuranTranslationText] WHERE [translationId]=N'${id}') AS [count] FROM [dbo].[QuranTranslation] WHERE [id]=N'${id}';`,
        );
        return row;
      })
      .toEqual({ state: 'published', name: NAME.adminTranslationRenamed, count: 3 });

    // It is public now, read beside the canonical Arabic.
    const reading = await page.goto(
      `/en/quran/surah/1/3?translation=${slug.adminTranslation}`,
    );
    expect(reading?.status()).toBe(200);
    await expect(
      page.locator('[aria-labelledby="ayah-translation"] p[lang="en"]'),
    ).toHaveText('NON_QURAN_FIXTURE_ADMIN_TRANSLATION_1_3');

    // And the canonical text offers this account no control at all.
    await page.goto('/en/admin/quran/ayat/1/1');
    await expect(page.getByRole('link', { name: 'Begin a correction' })).toHaveCount(0);
    await page.goto('/en/admin/quran/ayat/1/1?correct=1');
    await expect(page.getByRole('heading', { name: 'Canonical correction' })).toHaveCount(
      0,
    );
    await expect(page.locator('textarea[name="reviewedText"]')).toHaveCount(0);
    const [ayah] = await sql.query<{ version: number }>(
      'SELECT [version] FROM [dbo].[Ayah] WHERE [surahNumber]=1 AND [ayahNumber]=1;',
    );
    expect(ayah?.version).toBe(1);
  });

  test('quran.editCanonical corrects one Ayah only behind its own step-up, and only to the exact source text', async () => {
    test.setTimeout(240_000);
    const page = canonical;
    const correctionUrl = `/en/admin/quran/ayat/1/1?correct=1&source=${ids.correctionSource}`;
    const failedRuns = () =>
      scalar(
        "SELECT COUNT_BIG(*) AS [value] FROM [dbo].[QuranVerificationRun] WHERE [kind]=N'ayah-correction' AND [outcome]=N'failed';",
      );
    const ayah = async () => {
      const [row] = await sql.query<{ version: number; text: string }>(
        'SELECT [version],[text] FROM [dbo].[Ayah] WHERE [surahNumber]=1 AND [ayahNumber]=1;',
      );
      return row;
    };
    const submit = async (text: string) => {
      await page.locator('#correction-text').fill(text);
      await page
        .locator('#correction-reason')
        .fill('NON_QURAN_FIXTURE browser correction');
      await page.locator('input[name="confirm"]').check();
      await page.getByRole('button', { name: 'Correct this Ayah' }).click();
    };
    const stepUp = async (purpose?: string) => {
      await page.locator('#step-up-password-quran-canonical-edit').fill(PASSWORD);
      await page
        .locator('#step-up-code-quran-canonical-edit')
        .fill(await totpCodeFor(canonicalTotp));
      if (purpose !== undefined) {
        // Changed on the HYDRATED form, immediately before submitting, so it
        // is the value the real step-up action receives.
        await page.waitForLoadState('networkidle');
        await page
          .locator('input[type="hidden"][name="purpose"]')
          .evaluate((input: HTMLInputElement, value) => {
            input.value = value;
          }, purpose);
      }
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(
        page.getByText('Confirmed. You can make administrative changes'),
      ).toBeVisible();
    };

    // Entered on purpose, behind a warning, with the purpose's own prompt.
    await page.goto('/en/admin/quran/ayat/1/1');
    await page.getByRole('link', { name: 'Begin a correction' }).click();
    await page.waitForURL(/correct=1/);
    await expect(
      page.getByText('You are about to change canonical Quran text.'),
    ).toBeVisible();
    await expect(
      page.getByText(
        'A confirmation earned for any other administrative change does not count here.',
      ),
    ).toBeVisible();

    // Only registered sources are offered; the comparison is computed server-side.
    await page.locator('#correction-source').selectOption(ids.correctionSource);
    await page.getByRole('button', { name: 'Compare with this source' }).click();
    await page.waitForURL(new RegExp(`source=${ids.correctionSource}`));
    const firstDifference = [...canonicalText(1, 1)].findIndex(
      (point, index) => point !== [...CORRECTED][index],
    );
    await expect(
      page.getByText(
        `The texts first differ at code point ${String(firstDifference)} (counting from 0).`,
      ),
    ).toBeVisible();

    // 1. WITHOUT ANY STEP-UP: refused, and nothing changes.
    await submit(CORRECTED);
    await expect(
      page.getByText(
        'Confirm it is you with the form above, then submit the correction again.',
      ),
    ).toBeVisible();
    expect(await ayah()).toEqual({ version: 1, text: canonicalText(1, 1) });

    // 2. A `privilege-administration` grant — earned through the real step-up
    // action with only the purpose changed — does NOT unlock it.
    await page.goto(correctionUrl);
    await stepUp('privilege-administration');
    const purposes = await sql.query<{ purpose: string }>(
      `SELECT [purpose] FROM [dbo].[StepUpGrant] WHERE [userId]=N'${canonicalAccount}';`,
    );
    expect(purposes.map((row) => row.purpose)).toEqual(['privilege-administration']);
    await page.goto(correctionUrl);
    await submit(CORRECTED);
    await expect(
      page.getByText(
        'Confirm it is you with the form above, then submit the correction again.',
      ),
    ).toBeVisible();
    expect(await ayah()).toEqual({ version: 1, text: canonicalText(1, 1) });

    // 3. With the `quran-canonical-edit` step-up: a reviewed text ONE CODE
    // POINT from the source fails verification, says where, and changes nothing.
    await page.goto(correctionUrl);
    await stepUp();
    const failedBefore = await failedRuns();
    await page.goto(correctionUrl);
    await submit(NEAR_MISS);
    await expect(
      page.getByText(
        'The text you entered does not match the source, so nothing was changed.',
      ),
    ).toBeVisible();
    const offset = [...CORRECTED].length - 1;
    const report = page.locator('section[aria-labelledby="correction-report"]');
    await expect(report).toContainText('The text differs from the source');
    await expect(report).toContainText(
      `first difference at code point ${String(offset)}`,
    );
    expect(await ayah()).toEqual({ version: 1, text: canonicalText(1, 1) });
    expect(await failedRuns()).toBe(failedBefore + 1);

    // 4. The exact source text succeeds, and history gains version 2.
    await page.goto(correctionUrl);
    await submit(CORRECTED);
    await expect(
      page.getByText("Corrected. The Ayah now has the source's text"),
    ).toBeVisible();
    expect(await ayah()).toEqual({ version: 2, text: CORRECTED });

    await page.goto('/en/admin/quran/ayat/1/1');
    const history = page.locator('section[aria-labelledby="ayah-history"]');
    await expect(history.getByText('Version 2', { exact: true })).toBeVisible();
    await expect(history.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(history).toContainText('NON_QURAN_FIXTURE browser correction');
    const [revision] = await sql.query<{ actorId: string; stepUpGrantId: string | null }>(
      'SELECT [actorId],[stepUpGrantId] FROM [dbo].[QuranAyahRevision] WHERE [surahNumber]=1 AND [ayahNumber]=1 AND [version]=2;',
    );
    expect(revision?.actorId).toBe(canonicalAccount);
    expect(revision?.stepUpGrantId).not.toBeNull();

    // The public citation reads the corrected text.
    await visitFixture(page, '/en/quran/surah/1/1');
    await expect(page.locator('[aria-labelledby="ayah-arabic"] p')).toHaveText(CORRECTED);
  });
});
