import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
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
  localizedPath,
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
 * (three ayat in Surah 1, four in Surah 2, forty-five in Surah 3 — one more
 * than a reading window — Juz 2 beginning at 2:3, and made-up hizb and page
 * numbers) is engineering scaffolding that claims nothing about any real
 * Surah, count, Juz, hizb or mushaf page; the reciter is fictional; the audio is synthetic silence; and
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

/**
 * The fictional structure: [surah, ayah, juz, hizb, page]. Not a real count,
 * boundary or page. Surah 3 is longer than one reading window (40 ayat), so
 * the windows, the deep links and the loading of the next window are proved
 * against it; its pages and hizb are as made up as the rest.
 */
const STRUCTURE: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1],
  [1, 2, 1, 1, 1],
  [1, 3, 1, 1, 2],
  [2, 1, 1, 1, 2],
  [2, 2, 1, 2, 3],
  [2, 3, 2, 3, 3],
  [2, 4, 2, 3, 4],
  ...Array.from(
    { length: 45 },
    (_, index) =>
      [3, index + 1, 2, index < 19 ? 3 : 4, 4 + Math.floor(index / 15)] as const,
  ),
];

/** The highest made-up page above. */
const LAST_PAGE = 6;

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

/** A second, Urdu-language translation's text: a sentinel and neutral Urdu ("test text"). */
const urduText = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_URDU_${String(surah)}_${String(ayah)} آزمائشی متن`;

const ids = {
  source: randomUUID(),
  correctionSource: randomUUID(),
  acceptance: randomUUID(),
  translation: randomUUID(),
  urdu: randomUUID(),
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
  urdu: `fixture-urdu-${run}`,
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
  urdu: `NON_QURAN_FIXTURE urdu translation ${run}`,
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

/** Waits until the reader's island has mounted, so its controls answer. */
async function readerReady(page: Page): Promise<void> {
  await expect(page.locator('#quran-reader')).toHaveAttribute('data-enhanced', '');
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
/** Horizontal overflow, naming the innermost elements beyond the viewport. */
async function overflowOf(
  page: Page,
): Promise<{ overflow: number; offenders: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    if (overflow <= 0) return { overflow, offenders: [] };
    const beyond = [...document.body.querySelectorAll('*')].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > root.clientWidth + 0.5 || box.left < -0.5);
    });
    const innermost = beyond.filter(
      (element) => !beyond.some((other) => other !== element && element.contains(other)),
    );
    return {
      overflow,
      offenders: innermost
        .slice(0, 5)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ${String(Math.round(element.getBoundingClientRect().width))}px`,
        ),
    };
  });
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
    ([surah, ayah, juz, hizb, page]) =>
      `(N'${ids.source}', ${String(surah)}, ${String(ayah)}, ${String(juz)}, ${String(hizb)}, ${String(page)}, ${n(canonicalText(surah, ayah))})`,
  ).join(',');
  await sql.query(`
    INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[script]) VALUES
      (N'${ids.source}', N'NON_QURAN_FIXTURE_BROWSER_${run}', N'fixture', N'NON_QURAN_FIXTURE browser source', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE'),
      (N'${ids.correctionSource}', N'NON_QURAN_FIXTURE_BROWSER_CORRECTION_${run}', N'fixture', N'NON_QURAN_FIXTURE browser correction source', N'fixture-2', N'utf-8', NULL);
    INSERT INTO [dbo].[QuranSourceSurah] ([sourceId],[number],[ayahCount],[revelation],[nameArabic]) VALUES
      (N'${ids.source}', 1, 3, N'meccan', N'NON_QURAN_FIXTURE_SURAH_1'),
      (N'${ids.source}', 2, 4, NULL, N'NON_QURAN_FIXTURE_SURAH_2'),
      (N'${ids.source}', 3, 45, N'medinan', N'NON_QURAN_FIXTURE_SURAH_3'),
      (N'${ids.correctionSource}', 1, 1, NULL, NULL);
    INSERT INTO [dbo].[QuranSourceAyah] ([sourceId],[surahNumber],[ayahNumber],[juzNumber],[hizb],[page],[text]) VALUES
      ${ayat},
      (N'${ids.correctionSource}', 1, 1, 1, 1, 1, ${n(CORRECTED)});

    INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
      VALUES (N'${ids.acceptance}', N'corpus-acceptance', N'passed', N'${ids.source}', ${String(STRUCTURE.length)}, 0, NULL, SYSUTCDATETIME());
    INSERT INTO [dbo].[Juz] ([number],[sourceId],[createdAt]) VALUES
      (1, N'${ids.source}', SYSUTCDATETIME()), (2, N'${ids.source}', SYSUTCDATETIME());
    INSERT INTO [dbo].[Surah] ([number],[ayahCount],[revelation],[nameArabic],[sourceId],[createdAt],[updatedAt]) VALUES
      (1, 3, N'meccan', N'NON_QURAN_FIXTURE_SURAH_1', N'${ids.source}', SYSUTCDATETIME(), SYSUTCDATETIME()),
      (2, 4, NULL, N'NON_QURAN_FIXTURE_SURAH_2', N'${ids.source}', SYSUTCDATETIME(), SYSUTCDATETIME()),
      (3, 45, N'medinan', N'NON_QURAN_FIXTURE_SURAH_3', N'${ids.source}', SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[hizb],[page],[text],[sourceId],[version],[createdAt],[updatedAt])
      SELECT [surahNumber],[ayahNumber],[juzNumber],[hizb],[page],[text],[sourceId],1,SYSUTCDATETIME(),SYSUTCDATETIME()
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${ids.source}';
    INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
      SELECT [surahNumber],[ayahNumber],1,[text],[sourceId],N'${ids.acceptance}',NULL,NULL,NULL,SYSUTCDATETIME()
      FROM [dbo].[QuranSourceAyah] WHERE [sourceId]=N'${ids.source}';
    INSERT INTO [dbo].[SurahName] ([surahNumber],[locale],[name],[meaning]) VALUES
      (1, N'en', N'NON_QURAN_FIXTURE Surah One', N'NON_QURAN_FIXTURE meaning one'),
      (2, N'en', N'NON_QURAN_FIXTURE Surah Two', N'NON_QURAN_FIXTURE meaning two'),
      (3, N'en', N'NON_QURAN_FIXTURE Surah Three', NULL);
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
  const urduRows = STRUCTURE.map(
    ([surah, ayah]) =>
      `(N'${ids.urdu}', ${String(surah)}, ${String(ayah)}, ${n(urduText(surah, ayah))})`,
  ).join(',');
  await sql.query(`
    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${ids.reciter}', N'${slug.reciter}', N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (N'${ids.reciter}', N'en', ${n(NAME.reciter)}, NULL);

    INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[description],[attribution],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.translation}', N'${slug.translation}', N'en', ${n(NAME.translation)}, N'NON_QURAN_FIXTURE browser translation.', NULL, N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES ${translationRows};
    UPDATE [dbo].[QuranTranslation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.translation}';

    INSERT INTO [dbo].[QuranTranslation] ([id],[slug],[languageCode],[name],[description],[attribution],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.urdu}', N'${slug.urdu}', N'ur', ${n(NAME.urdu)}, N'NON_QURAN_FIXTURE browser Urdu-language translation.', NULL, N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTranslationText] ([translationId],[surahNumber],[ayahNumber],[text]) VALUES ${urduRows};
    UPDATE [dbo].[QuranTranslation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.urdu}';

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
    const response = await page.goto('/quran');
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
    expect(hrefs).toContain('/');
    expect(hrefs.filter((href) => href.includes('/quran'))).toEqual([]);
    const main = page.getByRole('main');
    await expect(main).not.toContainText('NON_QURAN_FIXTURE');
    await expect(main).not.toContainText(/\bayat\b|\bayah\b|\bSurah\b|\bJuz\b/);
    await expect(main.getByRole('search')).toHaveCount(0);
    await expectNoLearningLinks(page, '/quran');

    // Quran search, too, is honestly unavailable rather than an empty search.
    const search = await page.goto(`/quran/search?q=${WORD}`);
    expect(search?.status()).toBe(200);
    expect(search?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByText(UNAVAILABLE)).toBeVisible();
    await expect(page.getByRole('main').getByRole('search')).toHaveCount(0);
  });

  test('a Surah, an Ayah, a Juz, a topic view and the Listen catalogue are absent', async ({
    request,
  }) => {
    for (const missing of [
      '/quran/surah/1',
      '/quran/surah/1/1',
      '/quran/juz/1',
      `/quran/topics/${slug.topic}`,
      '/listen/recitations',
      '/ur/listen/recitations',
      '/quran/teachers',
    ]) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
      expect(response.headers()['set-cookie'], missing).toBeUndefined();
    }
  });

  test('Listen links no recitation catalogue', async ({ page }) => {
    await page.goto('/listen');
    await expect(page.getByRole('heading', { level: 1, name: 'Listen' })).toBeVisible();
    const hrefs = await hrefsIn(page);
    expect(hrefs).toContain('/listen/lectures');
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
    await visitFixture(page, '/quran');
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
      expect(hrefs, section).toContain(`/quran/${section}`);
    // Full-text search sits in the hero beside the quick jump: a GET form to
    // the Quran's own search, so it works without script.
    const search = page
      .getByRole('main')
      .getByRole('search', { name: 'Search the Quran' });
    await expect(search).toHaveAttribute('action', '/quran/search');
    await expect(search).toHaveAttribute('method', 'get');
    await expect(search.getByLabel('Search the Quran for')).toHaveAttribute('name', 'q');
    // No statistics and no sample verse on the landing.
    await expect(page.getByRole('main')).not.toContainText('NON_QURAN_FIXTURE_CANONICAL');

    // THE NAVIGATION IS UNCONDITIONAL (owner direction 2026-11-08): the Quran
    // is one of the nine domains whatever corpus is active, so the header's
    // Quran menu leads here, and the footer's Knowledge column to the Surah
    // index, while the fixture reads at its address under its banner.
    await expect(
      page
        .getByRole('banner')
        .getByRole('navigation', { name: 'Main navigation' })
        .locator('a[href="/quran"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole('contentinfo').locator('a[href="/quran/surah"]'),
    ).toHaveCount(1);
  });

  test('reads Surah index → Surah → Ayah by keyboard alone, with a visible focus', async ({
    page,
  }) => {
    await visitFixture(page, '/quran/surah');
    const index = page.getByRole('list', { name: 'Surahs' });
    await expect(index.getByRole('listitem')).toHaveCount(3);
    await expect(index).toContainText('3 ayat');
    await expect(index).toContainText('4 ayat');
    await expect(index).toContainText('45 ayat');

    await tabTo(page, index.getByRole('link', { name: /^Surah 1\b/ }));
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/quran\/surah\/1$/);
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();

    const article = page.getByRole('article', { name: 'Surah 1, Ayah 2' });
    await expect(article).toBeVisible();
    await expect(page.locator('li#ayah-1-2')).toContainText(canonicalText(1, 2));
    const citation = article.getByRole('link', { name: '1:2' });
    await expect(citation).toHaveAttribute('href', '/quran/surah/1/2');

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
    await page.waitForURL(/\/quran\/surah\/1\/2$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Surah 1, Ayah 2' }),
    ).toBeVisible();

    const next = page
      .getByRole('navigation', { name: 'Previous and next Ayah' })
      .getByRole('link', { name: 'Next Ayah (1:3)' });
    await tabTo(page, next);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/quran\/surah\/1\/3$/);
  });

  test('Part 2: the Surah index — names and meanings, a filter as you type and without script, orders, RTL and 320px', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    await visitFixture(page, '/quran/surah');
    const list = page.getByRole('list', { name: 'Surahs' });
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    // Each row: the recorded name (the link), its meaning, its facts — ayat,
    // revelation where the source recorded it, the Juz it spans — and the
    // source's Arabic name, marked Arabic.
    await expect(
      rows.first().getByRole('link', { name: 'Surah 1 · NON_QURAN_FIXTURE Surah One' }),
    ).toHaveAttribute('href', '/quran/surah/1');
    await expect(rows.first()).toContainText('NON_QURAN_FIXTURE meaning one');
    await expect(rows.first()).toContainText('3 ayat · Meccan · Juz 1');
    await expect(rows.nth(1)).toContainText('4 ayat · Juz 1–2');
    await expect(rows.nth(2)).toContainText('45 ayat · Medinan · Juz 2');
    await expect(rows.first().locator('[lang="ar"]')).toHaveText(
      'NON_QURAN_FIXTURE_SURAH_1',
    );
    const status = page.getByRole('status').filter({ hasText: 'Showing' });
    await expect(status).toHaveText('Showing 3 of 3 Surahs');

    // Typing narrows the list at once — by meaning, by number, by name — and
    // keeps the address in step so the filtered list can be shared.
    const filter = page.getByRole('searchbox', { name: 'Find a Surah' });
    await filter.fill('meaning two');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('NON_QURAN_FIXTURE Surah Two');
    await expect(status).toHaveText('Showing 1 of 3 Surahs');
    await expect(page).toHaveURL(/\/quran\/surah\?q=meaning\+two$/);
    await filter.fill('3');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('NON_QURAN_FIXTURE Surah Three');
    await filter.fill('zzzz');
    await expect(list).toHaveCount(0);
    await expect(page.getByText('No Surah matches “zzzz”.')).toBeVisible();
    await page.getByRole('link', { name: 'Show every Surah' }).click();
    await expect(rows).toHaveCount(3);
    await expect(filter).toHaveValue('');

    // Orders: longest first, and grouped by place of revelation.
    const order = page.getByRole('combobox', { name: 'Order', exact: true });
    await order.selectOption({ label: 'Longest first' });
    await expect(rows.first()).toContainText('NON_QURAN_FIXTURE Surah Three');
    await expect(page).toHaveURL(/\/quran\/surah\?sort=longest$/);
    await order.selectOption({ label: 'By place of revelation' });
    for (const [heading, surah] of [
      ['Meccan', 'One'],
      ['Medinan', 'Three'],
      ['Place of revelation not recorded', 'Two'],
    ] as const) {
      const group = page.getByRole('list', { name: new RegExp(`^${heading}`) });
      await expect(group.getByRole('listitem'), heading).toHaveCount(1);
      await expect(group, heading).toContainText(`NON_QURAN_FIXTURE Surah ${surah}`);
    }

    // The same list without JavaScript: the address is answered on the server,
    // and the form is a plain GET.
    const noScript = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(noScript);
    const plain = await noScript.newPage();
    const answered = await plain.goto('/quran/surah?q=two&sort=longest');
    expect(answered?.status()).toBe(200);
    await expect(
      plain.getByRole('list', { name: 'Surahs' }).getByRole('listitem'),
    ).toHaveCount(1);
    await expect(plain.getByRole('combobox', { name: 'Order', exact: true })).toHaveValue(
      'longest',
    );
    await plain.getByRole('searchbox', { name: 'Find a Surah' }).fill('surah three');
    await plain.getByRole('button', { name: 'Apply' }).click();
    await plain.waitForURL(/\/quran\/surah\?q=surah\+three&sort=longest$/);
    await expect(plain.getByRole('list', { name: 'Surahs' })).toContainText(
      'NON_QURAN_FIXTURE Surah Three',
    );
    await expect(
      plain.getByRole('list', { name: 'Surahs' }).getByRole('listitem'),
    ).toHaveCount(1);
    const nothing = await plain.goto('/quran/surah?q=zzzz&sort=nonsense');
    expect(nothing?.status()).toBe(200);
    await expect(plain.getByText('No Surah matches “zzzz”.')).toBeVisible();

    // The quick jump now resolves a recorded meaning, too, without script.
    const jump = await request.get(`/quran/read?q=${encodeURIComponent('meaning two')}`, {
      maxRedirects: 0,
    });
    expect(new URL(jump.headers()['location'] ?? '', baseUrl()).pathname).toBe(
      '/quran/surah/2',
    );

    // Urdu and Arabic: the title is the source's Arabic name, marked Arabic;
    // no English meaning is passed off in their place; English names still
    // filter.
    for (const locale of ['ur', 'ar'] as const) {
      await visitFixture(page, localizedPath(locale, '/quran/surah'), locale);
      const own = page
        .getByRole('main')
        .getByRole('list')
        .filter({
          has: page.locator('a[href$="/quran/surah/1"]'),
        });
      const title = own.locator('a[href$="/quran/surah/1"] [lang]').first();
      await expect(title, locale).toHaveAttribute('lang', 'ar');
      await expect(title, locale).toHaveText('NON_QURAN_FIXTURE_SURAH_1');
      await expect(own, locale).not.toContainText('NON_QURAN_FIXTURE meaning one');
      await expect(page.locator('html'), locale).toHaveAttribute('dir', 'rtl');
    }

    // No sideways scroll at 320px — long source names wrap rather than
    // squeezing a row — and no serious accessibility finding.
    await page.setViewportSize({ width: 320, height: 800 });
    for (const target of [
      '/quran/surah',
      '/ur/quran/surah',
      '/ar/quran/surah?sort=revelation',
      '/quran',
    ]) {
      await page.goto(target);
      const { overflow, offenders } = await overflowOf(page);
      expect(
        overflow,
        `320px ${target} — beyond the viewport: ${offenders.join(', ')}`,
      ).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const target of ['/quran/surah', '/ur/quran/surah?sort=revelation']) {
      await page.goto(target);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      for (const finding of results.violations.filter((v) => !blocking.includes(v)))
        testInfo.annotations.push({
          type: 'axe',
          description: `${target}: ${finding.id} (${String(finding.impact)})`,
        });
      expect(
        blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
        target,
      ).toEqual([]);
    }
  });

  test('marks the Arabic as Arabic, right-to-left, in every interface locale', async ({
    page,
  }) => {
    for (const locale of ['en', 'ur', 'ar'] as const) {
      await visitFixture(
        page,
        localizedPath(locale, `/quran/surah/1/2?translation=${slug.translation}`),
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
      await visitFixture(page, localizedPath(locale, '/quran/surah/2'), locale);
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
    await page.goto('/quran/surah/2');
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 3' })).toBeVisible();
  });

  test('withholds the canonical claim, even with reading preferences in the address', async ({
    page,
  }) => {
    await visitFixture(
      page,
      `/quran/surah/1/2?translation=${slug.translation}&reciter=${slug.recitation}`,
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
    await visitFixture(page, '/quran/surah/1/2?translation=nope&tafsir=nope');
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
    await visitFixture(page, `/quran/surah/1?translation=${slug.adminTranslation}`);
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
        `/quran/surah/1?translation=${slug.translation}&transliteration=${slug.transliteration}&tafsir=${slug.tafsir}&reciter=${slug.recitation}&size=larger`,
        '/ur/quran/surah/2',
        `/ar/quran/surah/1/1?translation=${slug.translation}`,
      ]) {
        await page.goto(target);
        const { overflow, offenders } = await overflowOf(page);
        expect(
          overflow,
          `${String(width)}px ${target} — beyond the viewport: ${offenders.join(', ')}`,
        ).toBeLessThanOrEqual(0);
      }
    }

    // NO MOTION ON SCRIPTURE — with no reduced-motion preference, so a real
    // animation or transition would show here.
    await page.goto(`/quran/surah/1?translation=${slug.translation}`);
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

  test('R2 reader: quick jump, a presentational end mark, settings kept in this browser, and Copy carries the exact Arabic', async ({
    page,
    request,
  }) => {
    // The quick jump without script: the GET form's server path redirects to
    // an address built from confirmed numbers, and says so when nothing matches.
    const jump = await request.get('/quran/read?q=2:3', { maxRedirects: 0 });
    expect(jump.status()).toBeGreaterThanOrEqual(300);
    expect(jump.status()).toBeLessThan(400);
    expect(new URL(jump.headers()['location'] ?? '', baseUrl()).pathname).toBe(
      '/quran/surah/2/3',
    );
    for (const missing of ['2:99', '9', 'zzzz', 'https://example.invalid/']) {
      const response = await request.get(`/quran/read?q=${encodeURIComponent(missing)}`, {
        maxRedirects: 0,
      });
      expect(response.status(), missing).toBe(200);
    }

    // …and with script, from the landing, straight to the citation.
    await visitFixture(page, '/quran');
    await page.getByLabel('Go to a Surah, Ayah, Juz or page').fill('1:2');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/quran\/surah\/1\/2$/);

    // The end-of-Ayah mark is a separate, hidden element: the Arabic text node
    // is still exactly the stored text.
    await visitFixture(page, '/quran/surah/1');
    const article = page.getByRole('article', { name: 'Surah 1, Ayah 2' });
    await expect(article.locator('p[lang="ar"]')).toHaveText(canonicalText(1, 2));
    await expect(article.locator('.quran-ayah-end')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // Both public translations are rendered; the English interface shows the
    // English one without asking, and the Urdu-language one waits, hidden.
    const english = article.locator(`[data-translation-work="${NAME.translation}"]`);
    const urdu = article.locator(`[data-translation-work="${NAME.urdu}"]`);
    await expect(english).toBeVisible();
    await expect(urdu).toBeHidden();

    await readerReady(page);
    // Settings: the Urdu-language work as well, then no translation at all —
    // each kept across a reload in this browser only.
    await page.getByRole('button', { name: 'Settings' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reading settings' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('checkbox', { name: new RegExp(NAME.urdu) }).check();
    await expect(urdu).toBeVisible();
    await expect(english).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await readerReady(page);
    await expect(urdu).toBeVisible();
    await page.getByRole('switch', { name: 'Translation' }).uncheck();
    await expect(english).toBeHidden();
    await expect(urdu).toBeHidden();
    await page.reload();
    await expect(
      page
        .getByRole('article', { name: 'Surah 1, Ayah 2' })
        .locator('[data-translation-index]'),
    ).toHaveCount(2);
    await expect(english).toBeHidden();
    await expect(urdu).toBeHidden();
    await readerReady(page);
    await page.getByRole('switch', { name: 'Translation' }).check();
    await expect(english).toBeVisible();

    // Copy: the clipboard begins with the stored Arabic, byte for byte.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .getByRole('article', { name: 'Surah 1, Ayah 2' })
      .getByRole('button', { name: 'Copy with citation' })
      .click();
    await expect(page.getByText('Copied with its citation.')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.startsWith(canonicalText(1, 2))).toBe(true);
    expect(copied).toContain('1:2');
  });

  test('Part 1: a long Surah is read in windows, and a deep link lands on its Ayah', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    // WITHOUT SCRIPT: the first window, complete, with a plain link onwards…
    const first = await request.get('/quran/surah/3');
    expect(first.status()).toBe(200);
    const html = await first.text();
    expect(html).toContain('id="ayah-3-40"');
    expect(html).not.toContain('id="ayah-3-41"');
    expect(html).toContain('href="/quran/surah/3?from=41"');
    // …and the next window at that address, with the way back.
    const second = await request.get('/quran/surah/3?from=41');
    const rest = await second.text();
    expect(rest).toContain('id="ayah-3-41"');
    expect(rest).toContain('id="ayah-3-45"');
    expect(rest).not.toContain('id="ayah-3-40"');
    expect(rest).toContain('Earlier ayat: 1–40');
    // Any Ayah opens the window it is in; noise is the first window.
    expect(await (await request.get('/quran/surah/3?from=44')).text()).toContain(
      'id="ayah-3-44"',
    );
    expect(await (await request.get('/quran/surah/3?from=x41')).text()).toContain(
      'id="ayah-3-1"',
    );

    // WITH SCRIPT: the next window arrives as the reader nears it.
    await visitFixture(page, '/quran/surah/3');
    const rows = page.locator('#quran-ayat > li[data-ayah]');
    await expect(rows).toHaveCount(40);
    await page.locator('a[data-window-next]').scrollIntoViewIfNeeded();
    await expect(rows).toHaveCount(45);
    await expect(page.locator('a[data-window-next]')).toHaveCount(0);
    await expect(page.locator('#ayah-3-45')).toContainText(canonicalText(3, 45));

    // On the page that already holds it, a fragment is landed in place.
    await page.evaluate(() => {
      window.location.hash = '#ayah-3-42';
    });
    await expect(page.locator('#ayah-3-42')).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#ayah-3-42')).toBeInViewport();

    // A deep link, OPENED, to an Ayah the first window does not hold lands on
    // it — in the current anchor form and in the earlier one.
    for (const fragment of ['#ayah-3-44', '#ayah-44']) {
      await page.goto('about:blank');
      await page.goto(`/quran/surah/3${fragment}`);
      await page.waitForURL(/\/quran\/surah\/3\?from=41#ayah-3-44$/);
      const target = page.locator('#ayah-3-44');
      await expect(target).toHaveAttribute('aria-current', 'location');
      await expect(target).toBeInViewport();
    }
    // The canonical citation and the Surah's own "Go to an Ayah" reach it too.
    await visitFixture(page, '/quran/surah/3/44');
    await visitFixture(page, '/quran/surah/3');
    await readerReady(page);
    await page.getByLabel('Ayah number').fill('44');
    await page.getByRole('form', { name: 'Go to an Ayah' }).getByRole('button').click();
    await page.waitForURL(/\/quran\/surah\/3\?from=41#ayah-3-44$/);
    await expect(page.locator('#ayah-3-44')).toBeInViewport();

    // The page header: names, count, the Juz and pages it spans.
    await visitFixture(page, '/quran/surah/2');
    await expect(page.getByRole('main').locator('header').first()).toContainText(
      '4 ayat · Juz 1–2 · Pages 2–4',
    );
  });

  test('Part 1: three reading modes, remembered, over one document', async ({ page }) => {
    await visitFixture(page, '/quran/surah/2');
    await readerReady(page);
    const reader = page.locator('#quran-reader');
    await expect(reader).toHaveAttribute('data-mode', 'translation');
    // Divisions where they begin, from the stored numbers only.
    await expect(page.locator('#ayah-2-2 .quran-mark-page')).toContainText('Page 3');
    await expect(page.locator('#ayah-2-2 .quran-mark-division')).toHaveText('Hizb 2');
    await expect(page.locator('#ayah-2-3 .quran-mark-division')).toHaveText([
      'Juz 2',
      'Hizb 3',
    ]);
    await expect(page.locator('#ayah-2-3 .quran-mark-page')).toHaveCount(0);

    const modes = page.getByRole('group', { name: 'Reading mode' }).first();
    await modes.getByText('Reading', { exact: true }).click();
    await expect(modes.getByLabel('Reading')).toBeChecked();
    await expect(reader).toHaveAttribute('data-mode', 'reading');
    const article = page.getByRole('article', { name: 'Surah 2, Ayah 3' });
    await expect(article.locator('[data-translation-index]').first()).toBeHidden();
    await expect(article.locator('p[lang="ar"]')).toHaveText(canonicalText(2, 3));
    // Every Ayah is one keyboard stop that opens its translation.
    const open = article.getByRole('button', {
      name: /Surah 2, Ayah 3: show its translation$/,
    });
    await open.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Surah 2, Ayah 3' });
    await expect(sheet).toContainText(translationText(2, 3));
    await expect(sheet.locator('p[lang="ar"]')).toHaveText(canonicalText(2, 3));
    await expect(
      sheet.getByRole('link', { name: 'Open this Ayah’s page' }),
    ).toHaveAttribute('href', '/quran/surah/2/3');
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();

    // Mushaf mode: the same ayat under page headers, kept across a reload and
    // in place before the island has loaded (the boot script).
    await modes.getByText('Page', { exact: true }).click();
    await expect(modes.getByLabel('Page')).toBeChecked();
    await expect(reader).toHaveAttribute('data-mode', 'mushaf');
    await expect(page.locator('#ayah-2-2 .quran-mark-page')).toContainText(
      'Page 3 · Juz 1 · Hizb 2',
    );
    await page.reload({ waitUntil: 'commit' });
    await expect(page.locator('#quran-reader')).toHaveAttribute('data-mode', 'mushaf');
    // The island answers only once it has mounted.
    await expect(reader).toHaveAttribute('data-enhanced', '');

    // Settings: line spacing and the translations' layout, kept as well.
    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Reading settings' });
    await settings.getByLabel('Spacious').check();
    await settings.getByLabel('Side by side on wide screens').check();
    await settings.getByLabel('Translation', { exact: true }).check();
    await page.keyboard.press('Escape');
    await expect(reader).toHaveAttribute('data-leading', 'spacious');
    await expect(reader).toHaveAttribute('data-layout', 'side');
    await expect(reader).toHaveAttribute('data-mode', 'translation');
    await page.reload();
    await expect(page.locator('#quran-reader')).toHaveAttribute(
      'data-leading',
      'spacious',
    );
    await expect(reader).toHaveAttribute('data-enhanced', '');

    // The Save tool opens the private island in place — signed out, it offers
    // sign-in — and without leaving the Surah.
    await page
      .getByRole('article', { name: 'Surah 2, Ayah 3' })
      .getByRole('link', { name: 'Save to My Minhaj' })
      .click();
    await expect(page).toHaveURL(/\/quran\/surah\/2$/);
    await expect(page.getByRole('dialog', { name: 'Surah 2, Ayah 3' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Part 1: a mushaf page by its number, and absent outside the corpus', async ({
    page,
    request,
  }) => {
    await visitFixture(page, '/quran/page/3');
    await expect(page.getByRole('heading', { level: 1, name: 'Page 3' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 2' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 3' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 1' })).toHaveCount(0);
    const pages = page.getByRole('navigation', { name: 'Previous and next page' });
    await expect(pages.getByRole('link', { name: 'Previous page (2)' })).toHaveAttribute(
      'href',
      '/quran/page/2',
    );
    await expect(pages.getByRole('link', { name: 'Next page (4)' })).toHaveAttribute(
      'href',
      '/quran/page/4',
    );
    // A page that opens a Surah names it; the last page offers no next page.
    await visitFixture(page, `/quran/page/${String(LAST_PAGE)}`);
    await expect(
      page
        .getByRole('navigation', { name: 'Previous and next page' })
        .getByRole('link', { name: /Next page/ }),
    ).toHaveCount(0);
    await visitFixture(page, '/ur/quran/page/1', 'ur');

    for (const missing of [
      `/quran/page/${String(LAST_PAGE + 1)}`,
      '/quran/page/0',
      '/quran/page/01',
      '/quran/page/abc',
      '/quran/page/1000',
    ]) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
    }
    // Reached from the reader entry and the quick jump, by number only.
    const jump = await request.get('/quran/read?q=page%204', { maxRedirects: 0 });
    expect(new URL(jump.headers()['location'] ?? '', baseUrl()).pathname).toBe(
      '/quran/page/4',
    );
    const go = await request.get('/quran/read?page=5', { maxRedirects: 0 });
    expect(new URL(go.headers()['location'] ?? '', baseUrl()).pathname).toBe(
      '/quran/page/5',
    );
    const far = await request.get(`/quran/read?page=${String(LAST_PAGE + 1)}`, {
      maxRedirects: 0,
    });
    expect(far.status()).toBe(200);
    expect(await far.text()).toContain('That page is not in this text.');
  });

  test('Part 1: no sideways scroll and no serious accessibility finding in any mode', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    for (const mode of ['translation', 'reading', 'mushaf'] as const) {
      await page.addInitScript((value) => {
        try {
          window.localStorage.setItem(
            'minhaj.quran.reader',
            JSON.stringify({ mode: value }),
          );
        } catch {
          /* Storage unavailable: the default mode is still proved. */
        }
      }, mode);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 800 });
        for (const target of [
          '/ur/quran/surah/2',
          '/ar/quran/surah/3',
          '/ur/quran/page/3',
        ]) {
          await page.goto(target);
          await expect(page.locator('#quran-reader')).toHaveAttribute('data-mode', mode);
          const { overflow, offenders } = await overflowOf(page);
          expect(
            overflow,
            `${mode} ${String(width)}px ${target} — beyond the viewport: ${offenders.join(', ')}`,
          ).toBeLessThanOrEqual(0);
        }
      }
      for (const target of ['/quran/surah/2', '/ur/quran/surah/2', '/quran/read']) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(target);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const blocking = results.violations.filter(
          (violation) =>
            violation.impact === 'serious' || violation.impact === 'critical',
        );
        for (const finding of results.violations.filter((v) => !blocking.includes(v)))
          testInfo.annotations.push({
            type: 'axe',
            description: `${mode} ${target}: ${finding.id} (${String(finding.impact)})`,
          });
        expect(
          blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
          `${mode} ${target}`,
        ).toEqual([]);
      }
    }
  });

  test('Part 1: where to begin — popular places, the quick jump and this browser’s last place', async ({
    page,
  }) => {
    await visitFixture(page, '/quran/read');
    // Only the starting points the corpus holds: the first Surah's opening.
    const start = page.getByRole('region', { name: 'Popular places to begin' });
    await expect(start.getByRole('link')).toHaveCount(1);
    await expect(start.getByRole('link')).toHaveAttribute('href', '/quran/surah/1');
    // No place read yet: no card.
    await expect(
      page.getByRole('region', { name: 'Continue where you stopped' }),
    ).toHaveCount(0);

    // Read a little of Surah 3's second window; the card offers it back.
    await page.goto('/quran/surah/3?from=41#ayah-3-43');
    await expect(page.locator('#ayah-3-43')).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem('minhaj.quran.lastRead')),
      )
      .not.toBeNull();
    await page.goto('/quran/read');
    const card = page.getByRole('region', { name: 'Continue where you stopped' });
    await expect(card).toContainText('Last read on this device');
    await expect(card.getByRole('link')).toHaveAttribute(
      'href',
      /^\/quran\/surah\/3\?from=41#ayah-3-4\d$/,
    );
  });

  test('a Juz lists its ayat, each linking to its citation', async ({ page }) => {
    await visitFixture(page, '/quran/juz');
    const list = page.getByRole('list', { name: 'Juz' });
    await expect(list.getByRole('link', { name: 'Juz 1' })).toHaveAttribute(
      'href',
      '/quran/juz/1',
    );
    await expect(list).toContainText('From 2:3 to 3:45');

    await visitFixture(page, '/quran/juz/2');
    for (const ayah of [3, 4]) {
      const article = page.getByRole('article', {
        name: `Surah 2, Ayah ${String(ayah)}`,
      });
      await expect(
        article.getByRole('link', { name: `2:${String(ayah)}` }),
      ).toHaveAttribute('href', `/quran/surah/2/${String(ayah)}`);
      await expect(article.locator('p[lang="ar"]')).toHaveText(canonicalText(2, ayah));
    }
    await expect(page.getByRole('article', { name: 'Surah 2, Ayah 2' })).toHaveCount(0);
  });

  test('Part 3: the Juz index — opening words verbatim, ranges, a filter by number, the quick jump’s hizb, RTL and 320px', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(240_000);
    await visitFixture(page, '/quran/juz');
    const list = page.getByRole('list', { name: 'Juz', exact: true });
    const cards = list.getByRole('listitem');
    await expect(cards).toHaveCount(2);
    const second = cards.nth(1);
    await expect(
      second.getByRole('link', { name: 'Juz 2', exact: true }),
    ).toHaveAttribute('href', '/quran/juz/2');
    // The opening words are a slice of the first Ayah's stored text, never a
    // name written anywhere: the first three words of 2:3, then a quiet "…".
    const opening = second.locator('span[lang="ar"]').first();
    const words = canonicalText(2, 3).split(' ').slice(0, 3).join(' ');
    expect(await opening.evaluate((element) => element.firstChild?.textContent)).toBe(
      words,
    );
    expect(canonicalText(2, 3).startsWith(words)).toBe(true);
    await expect(opening.locator('[aria-hidden="true"]')).toHaveText(' …');
    await expect(second).toContainText('From 2:3 to 3:45 · 47 ayat');
    await expect(second).toContainText(
      'NON_QURAN_FIXTURE Surah Two–NON_QURAN_FIXTURE Surah Three',
    );
    await expect(second).toContainText('Pages 3–6 · Hizb 3–4');
    await expect(cards.first()).toContainText('Pages 1–3 · Hizb 1–2');

    // A filter by number, or by a hizb a Juz holds, kept in the address.
    const status = page.getByRole('status').filter({ hasText: 'Showing' });
    await expect(status).toHaveText('Showing 2 of 2 Juz');
    const filter = page.getByRole('searchbox', { name: 'Find a Juz' });
    await filter.fill('2');
    await expect(cards).toHaveCount(1);
    await expect(page).toHaveURL(/\/quran\/juz\?q=2$/);
    await filter.fill('hizb 1');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByRole('link')).toHaveAttribute('href', '/quran/juz/1');
    await filter.fill('kahf');
    await expect(list).toHaveCount(0);
    await expect(page.getByText('No Juz matches “kahf”.')).toBeVisible();
    await page.getByRole('link', { name: 'Show every Juz' }).click();
    await expect(cards).toHaveCount(2);

    // The same filter without JavaScript: a plain GET answered on the server.
    const noScript = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(noScript);
    const plain = await noScript.newPage();
    expect((await plain.goto('/quran/juz?q=hizb+4'))?.status()).toBe(200);
    const plainCards = plain
      .getByRole('list', { name: 'Juz', exact: true })
      .getByRole('listitem');
    await expect(plainCards).toHaveCount(1);
    await expect(plainCards.first()).toContainText('Juz 2');
    await plain.getByRole('searchbox', { name: 'Find a Juz' }).fill('1');
    await plain.getByRole('button', { name: 'Apply' }).click();
    await plain.waitForURL(/\/quran\/juz\?q=1$/);
    await expect(plainCards).toHaveCount(1);
    await expect(plainCards.first()).toContainText('Juz 1');

    // The quick jump opens a recorded hizb in its Juz — and nothing else.
    const jump = await request.get('/quran/read?q=hizb%204', { maxRedirects: 0 });
    const target = new URL(jump.headers()['location'] ?? '', baseUrl());
    expect(`${target.pathname}${target.search}`).toBe('/quran/juz/2?hizb=4');
    const missing = await request.get('/quran/read?q=hizb%209', { maxRedirects: 0 });
    expect(missing.status()).toBe(200);

    // Urdu and Arabic: right to left, the opening words marked Arabic.
    for (const locale of ['ur', 'ar'] as const) {
      await visitFixture(page, localizedPath(locale, '/quran/juz'), locale);
      await expect(page.locator('html'), locale).toHaveAttribute('dir', 'rtl');
      await expect(
        page.getByRole('main').locator('ol span[lang="ar"]').first(),
        locale,
      ).toContainText(canonicalText(1, 1).split(' ').slice(0, 3).join(' '));
    }

    await page.setViewportSize({ width: 320, height: 800 });
    for (const target of ['/quran/juz', '/ur/quran/juz', '/ar/quran/juz?q=2']) {
      await page.goto(target);
      const { overflow, offenders } = await overflowOf(page);
      expect(
        overflow,
        `320px ${target} — beyond the viewport: ${offenders.join(', ')}`,
      ).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const target of ['/quran/juz', '/ur/quran/juz']) {
      await page.goto(target);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      for (const finding of results.violations.filter((v) => !blocking.includes(v)))
        testInfo.annotations.push({
          type: 'axe',
          description: `${target}: ${finding.id} (${String(finding.impact)})`,
        });
      expect(
        blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
        target,
      ).toEqual([]);
    }
  });

  test('Part 3: a Juz is read hizb by hizb — contents, windows that load on, neighbours, no script, RTL, 320px', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);

    // Without JavaScript: one window, complete, and plain links to the rest.
    const noScript = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(noScript);
    const plain = await noScript.newPage();
    expect((await plain.goto('/quran/juz/2'))?.status()).toBe(200);
    await expect(plain.getByRole('heading', { level: 1 })).toHaveText('Juz 2');
    const header = plain.locator('main header').first();
    await expect(
      header.getByRole('link', { name: 'NON_QURAN_FIXTURE Surah Two 2:3' }),
    ).toHaveAttribute('href', '/quran/surah/2/3');
    await expect(
      header.getByRole('link', { name: 'NON_QURAN_FIXTURE Surah Three 3:45' }),
    ).toHaveAttribute('href', '/quran/surah/3/45');
    await expect(header).toContainText('47 ayat · Pages 3–6 · Hizb 3–4');
    await expect(plain.locator('#ayah-2-3')).toHaveCount(1);
    await expect(plain.locator('#ayah-3-19')).toHaveCount(1);
    await expect(plain.locator('#ayah-3-20')).toHaveCount(0);
    await expect(plain.getByText('Ayat 1–21 of 47 in this Juz')).toBeVisible();
    // Surah 3 opens inside the window: its heading is there.
    await expect(
      plain.getByRole('heading', { level: 2, name: /NON_QURAN_FIXTURE Surah Three/ }),
    ).toHaveCount(1);

    const contents = plain.getByRole('navigation', { name: 'In this Juz' });
    await expect(contents.getByRole('link', { name: /^Hizb 3/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(contents.getByRole('link', { name: /^Hizb 4/ })).toHaveAttribute(
      'href',
      '/quran/juz/2?hizb=4',
    );
    await expect(
      contents.getByRole('link', { name: /NON_QURAN_FIXTURE Surah Three/ }),
    ).toHaveAttribute('href', '/quran/juz/2#ayah-3-1');

    const more = plain.getByRole('link', { name: 'Continue reading: Hizb 4' });
    await expect(more).toHaveAttribute('href', '/quran/juz/2?hizb=4');
    await more.click();
    await plain.waitForURL('**/quran/juz/2?hizb=4');
    await expect(plain.locator('#ayah-3-20')).toHaveCount(1);
    await expect(plain.locator('#ayah-3-45')).toHaveCount(1);
    await expect(plain.locator('#ayah-2-3')).toHaveCount(0);
    await expect(plain.getByText('Ayat 22–47 of 47 in this Juz')).toBeVisible();
    await expect(plain.getByRole('link', { name: 'Earlier: Hizb 3' })).toHaveAttribute(
      'href',
      '/quran/juz/2',
    );
    await expect(plain.getByRole('link', { name: /^Continue reading/ })).toHaveCount(0);

    // Neighbours: Juz 1 before, nothing after the last Juz the corpus has.
    const neighbours = plain.getByRole('navigation', { name: 'Previous and next Juz' });
    await expect(
      neighbours.getByRole('link', { name: /Previous: Juz 1/ }),
    ).toHaveAttribute('href', '/quran/juz/1');
    await expect(neighbours.getByRole('link', { name: /Next/ })).toHaveCount(0);

    // Unknown windows and the old paging are the first window, not an error.
    for (const odd of [
      '/quran/juz/2?hizb=99',
      '/quran/juz/2?offset=100',
      '/quran/juz/2?part=x',
    ])
      expect((await plain.goto(odd))?.status(), odd).toBe(200);
    await expect(plain.locator('#ayah-2-3')).toHaveCount(1);

    // With JavaScript: the next hizb is appended as the reader nears it, its
    // ids stay unique, and the link goes once the Juz is read to its end.
    await visitFixture(page, '/quran/juz/2');
    await readerReady(page);
    await page.locator('a[data-window-next]').scrollIntoViewIfNeeded();
    await expect(page.locator('#ayah-3-45')).toHaveCount(1);
    await expect(page.locator('[data-window-nav]')).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        return ids.length - new Set(ids).size;
      }),
    ).toBe(0);

    // Urdu and Arabic read right to left; nothing is wider than 320px.
    for (const locale of ['ur', 'ar'] as const) {
      await visitFixture(page, localizedPath(locale, '/quran/juz/2'), locale);
      await expect(page.locator('html'), locale).toHaveAttribute('dir', 'rtl');
      await expect(
        page.locator('#ayah-2-3 p[lang="ar"]').first(),
        locale,
      ).toHaveAttribute('dir', 'rtl');
    }
    await page.setViewportSize({ width: 320, height: 800 });
    for (const target of ['/quran/juz/2', '/ur/quran/juz/2', '/ar/quran/juz/2?hizb=4']) {
      await page.goto(target);
      const { overflow, offenders } = await overflowOf(page);
      expect(
        overflow,
        `320px ${target} — beyond the viewport: ${offenders.join(', ')}`,
      ).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const target of ['/quran/juz/2', '/ur/quran/juz/2?hizb=4']) {
      await page.goto(target);
      await readerReady(page);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      for (const finding of results.violations.filter((v) => !blocking.includes(v)))
        testInfo.annotations.push({
          type: 'axe',
          description: `${target}: ${finding.id} (${String(finding.impact)})`,
        });
      expect(
        blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
        target,
      ).toEqual([]);
    }
  });

  test('the study pages render the published fixture works', async ({ page }) => {
    await visitFixture(page, '/quran/translations');
    await page.getByRole('link', { name: NAME.translation }).click();
    await page.waitForURL(`**/quran/translations/${slug.translation}`);
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.translation);
    expect(await hrefsIn(page)).toContain(
      `/quran/surah/1?translation=${slug.translation}`,
    );

    await visitFixture(page, `/quran/tafsir/${slug.tafsir}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.tafsir);
    const entry = page.getByRole('link', { name: 'Surah 1, ayat 1–3' });
    await expect(entry).toHaveAttribute('href', `/quran/surah/1/1?tafsir=${slug.tafsir}`);
    const commentary = page.locator(
      'ol[aria-labelledby="tafsir-entries"] div[lang="ur"]',
    );
    await expect(commentary).toHaveAttribute('dir', 'rtl');
    await expect(commentary).toContainText('NON_QURAN_FIXTURE_TAFSIR_1_1');

    await visitFixture(page, '/quran/transliteration');
    await expect(page.getByRole('main')).toContainText(NAME.transliteration);

    await visitFixture(page, '/quran/tajweed');
    await page.getByRole('link', { name: NAME.rule }).click();
    await page.waitForURL(`**/quran/tajweed/${slug.rule}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.rule);
    await expect(page.getByRole('main')).toContainText('NON_QURAN_FIXTURE rule body.');

    // A layer chosen on an Ayah page: the tafsir in its own language, open.
    await visitFixture(
      page,
      `/quran/surah/1/1?tafsir=${slug.tafsir}&transliteration=${slug.transliteration}`,
    );
    await expect(
      page.locator('section[aria-labelledby="ayah-tafsir"] [lang="ur"]'),
    ).toContainText('NON_QURAN_FIXTURE_TAFSIR_1_1');
    await expect(
      page.locator('[aria-labelledby="ayah-transliteration"] p[lang="en"]'),
    ).toHaveText('NON_QURAN_FIXTURE_TRANSLITERATION_1_1');
  });

  test('a topic view lists its ayat and points at the Topic hub', async ({ page }) => {
    await visitFixture(page, `/quran/topics/${slug.topic}`);
    const ayah = page.getByRole('article', { name: 'Surah 1, Ayah 2' });
    await expect(ayah.getByRole('link')).toHaveAttribute('href', '/quran/surah/1/2');
    expect(await hrefsIn(page)).toContain(`/topics/${slug.topic}`);
    await expect(page.getByRole('article', { name: 'Surah 1, Ayah 1' })).toHaveCount(0);

    // The hub composes the same ayat, under the banner, and links the view.
    const hub = await page.goto(`/topics/${slug.topic}`);
    expect(hub?.status()).toBe(200);
    await expect(page.getByRole('note').filter({ hasText: BANNER.en })).toBeVisible();
    expect(await hrefsIn(page)).toContain(`/quran/topics/${slug.topic}`);

    const unknown = await page.goto(`/quran/topics/no-such-topic-${run}`);
    expect(unknown?.status()).toBe(404);
  });

  test('the recitation player is the browser’s own, silent until asked, with no download', async ({
    page,
    request,
  }) => {
    await visitFixture(page, `/quran/surah/1?reciter=${slug.recitation}`);
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
    // Scoped to the page's content: the shell's own navigation is not a
    // download of this recitation.
    await expect(
      page.getByRole('main').getByRole('link', { name: /download/i }),
    ).toHaveCount(0);
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
    await visitFixture(page, `/quran/recitations/${slug.reciter}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(NAME.reciter);
    await expect(page.locator('audio[controls]')).toHaveCount(1);
    expect(await page.locator('audio[autoplay]').count()).toBe(0);
  });

  test('Listen projects Quran’s recitation catalogue — and only Quran’s', async ({
    page,
  }) => {
    await page.goto('/listen');
    expect(await hrefsIn(page)).toContain('/listen/recitations');

    await visitFixture(page, '/listen/recitations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Recitations' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'All recitations in the Quran section' }),
    ).toHaveAttribute('href', '/quran/recitations');
    const rows = page.getByRole('list', { name: 'Recitations' }).getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByRole('heading')).toHaveText(NAME.recitation);
    await expect(rows.first().getByRole('link', { name: NAME.reciter })).toHaveAttribute(
      'href',
      `/quran/recitations/${slug.reciter}`,
    );
    // Nothing of Media's: no lecture, no audio track, no Media byte route.
    const hrefs = await hrefsIn(page);
    expect(hrefs.filter((href) => href.includes('/listen/lectures'))).toEqual([]);
    await expect(page.locator('audio[src*="/assets/media/"]')).toHaveCount(0);

    // The Quran section's own catalogue lists the same recitation.
    await visitFixture(page, '/quran/recitations');
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
          const response = await page.goto(`/quran/search?q=${encodeURIComponent(WORD)}`);
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
    await expect(hit).toHaveAttribute('href', '/quran/surah/1/2');
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
      personal: { progress: Record<string, string> };
    }
  ).personal;
  /** R2: the My Minhaj home page's "Continue" module heading. */
  const CONTINUE = (
    JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')) as {
      my: { home: { continue: { heading: string } } };
    }
  ).my.home.continue.heading;

  const AYAH = '/quran/surah/2/3';
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
      `/signin?returnTo=${encodeURIComponent(AYAH)}`,
    );
    await expect(region.getByRole('button')).toHaveCount(0);
  });

  test('set from the Ayah, shown on My Minhaj, refused from a stale page, and cleared', async () => {
    test.setTimeout(120_000);
    await reader.goto('/my/progress/quran');
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

    await reader.goto('/my/progress/quran');
    await expect(
      reader.getByRole('link', { name: PROGRESS.progress['continue'] }),
    ).toHaveAttribute('href', AYAH);
    // R2: the home page offers the position under "Continue", linked to the ayah.
    await reader.goto('/my');
    const continuing = reader
      .getByRole('main')
      .getByRole('region', { name: CONTINUE, exact: true });
    await expect(continuing.locator(`a[href="${AYAH}"]`)).toHaveCount(1);

    // A STALE PAGE. One tab read the position's version before another moved
    // it; its own attempt is a conflict, not an overwrite — and, refreshed,
    // its retry is honoured.
    const stale = await reader.context().newPage();
    await openWithIsland(stale, '/quran/surah/2/4');
    await openWithIsland(reader, '/quran/surah/2/2');
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

    await reader.goto('/my/progress/quran');
    await reader.getByRole('button', { name: PROGRESS.progress['clear'] }).click();
    await expect(reader.getByRole('main')).toContainText(
      PROGRESS.progress['empty'] ?? '',
    );
    expect(await position()).toBeNull();
    // Cleared: the home page no longer offers it (a module renders only with
    // something in it). (The card on /quran/read is proved below.)
    await reader.goto('/my');
    await expect(
      reader
        .getByRole('main')
        .getByRole('region', { name: CONTINUE, exact: true })
        .locator(`a[href="${AYAH}"]`),
    ).toHaveCount(0);
  });
});

test.describe('the reading position, read back by the reader (Part 1)', () => {
  let reader: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.242.9' },
    });
    contexts.push(context);
    reader = await context.newPage();
    await registerAndSignIn(reader, 'quran-continue');
  });

  test('the private read answers only the session’s own position, and refuses cross-site', async ({
    request,
  }) => {
    const anonymous = await request.get('/api/my/quran-position');
    expect(anonymous.status()).toBe(200);
    expect(anonymous.headers()['cache-control']).toBe('private, no-store');
    expect(anonymous.headers()['x-robots-tag']).toBe('noindex');
    expect(await anonymous.json()).toEqual({ signedIn: false });

    for (const site of ['cross-site', 'same-site']) {
      const refused = await reader.context().request.get('/api/my/quran-position', {
        headers: { 'sec-fetch-site': site },
      });
      expect(refused.status(), site).toBe(403);
    }
    // The address names nothing: no query can choose another account or target.
    const named = await reader
      .context()
      .request.get('/api/my/quran-position?accountId=someone-else');
    expect(named.status()).toBe(400);

    const none = await reader.context().request.get('/api/my/quran-position');
    expect(await none.json()).toEqual({ signedIn: true, position: null });
  });

  test('the card offers the signed-in position; the page itself is the same for everyone', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const state = reader.waitForResponse((response) =>
      response.url().includes('/api/my/target-state'),
    );
    await reader.goto('/quran/surah/3/42');
    await state;
    const positionSet = (
      JSON.parse(readFileSync(path.join(MESSAGES, 'en.json'), 'utf8')) as {
        personalIsland: Record<string, string>;
      }
    ).personalIsland['positionSet'];
    await reader
      .locator('#personal')
      .getByRole('button', { name: positionSet ?? '' })
      .click();
    await expect
      .poll(async () =>
        (await reader.context().request.get('/api/my/quran-position')).json(),
      )
      .toEqual({ signedIn: true, position: { surah: 3, ayah: 42 } });

    await reader.goto('/quran/read');
    const card = reader.getByRole('region', { name: 'Continue where you stopped' });
    await expect(card).toContainText('Your reading position');
    await expect(card.getByRole('link')).toHaveAttribute(
      'href',
      '/quran/surah/3?from=41#ayah-3-42',
    );

    // BYTE FOR BYTE: the start page carries nothing per visitor.
    const { anonymous, signedIn } = await asTwoVisitors(
      request,
      reader.context().request,
      '/quran/read',
    );
    expect(anonymous.headers()['set-cookie']).toBeUndefined();
    expect(signedIn.headers()['set-cookie']).toBeUndefined();
    expect(
      documentDifference(
        knowledgeOf(await anonymous.text()),
        knowledgeOf(await signedIn.text()),
      ),
      'the reader entry differs signed in',
    ).toBe('identical');
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
    await page.goto('/admin/quran/ayat/1/1');
    await page.waitForURL(/\/signin\?returnTo=/);

    for (const surface of [
      'surahs',
      'ayat',
      'ayat/1/1',
      'translations',
      `translations/${ids.translation}`,
    ]) {
      const response = await nobody.goto(`/admin/quran/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('quran.read reads the canonical text, and is offered nothing to change', async () => {
    const response = await reader.goto('/admin/quran/ayat/1/1');
    expect(response?.status()).toBe(200);
    const main = reader.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Canonical text' })).toBeVisible();
    await expect(
      main.locator('p[lang="ar"]', { hasText: canonicalText(1, 1) }).first(),
    ).toBeVisible();
    await expect(main).toContainText('Read-only.');
    await expect(main.getByRole('link', { name: 'Begin a correction' })).toHaveCount(0);

    // Asking for the correction by address shows nothing either.
    await reader.goto('/admin/quran/ayat/1/1?correct=1');
    await expect(
      reader.getByRole('heading', { name: 'Canonical correction' }),
    ).toHaveCount(0);
    await expect(reader.locator('textarea')).toHaveCount(0);

    // Layered works are read, not edited.
    await reader.goto(`/admin/quran/translations/${ids.translation}?surah=1`);
    await expect(reader.getByRole('main')).toContainText(translationText(1, 2));
    await expect(reader.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: 'Save changed texts' })).toHaveCount(
      0,
    );
    await reader.goto('/admin/quran/translations');
    await expect(reader.getByRole('heading', { name: 'New translation' })).toHaveCount(0);
  });

  test('quran.administer creates, edits and publishes a translation — and never touches the Arabic', async () => {
    test.setTimeout(120_000);
    const page = administrator;
    await page.goto('/admin/quran/translations');
    await page.locator('#new-translation-slug').fill(slug.adminTranslation);
    await page.locator('#new-translation-name').fill(NAME.adminTranslation);
    await page.locator('#new-translation-language').selectOption('en');
    await page.locator('#new-translation-source').selectOption(ids.source);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/admin\/quran\/translations\/[0-9a-f-]{36}$/);
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
      `/quran/surah/1/3?translation=${slug.adminTranslation}`,
    );
    expect(reading?.status()).toBe(200);
    await expect(
      page.locator('[aria-labelledby="ayah-translation"] p[lang="en"]'),
    ).toHaveText('NON_QURAN_FIXTURE_ADMIN_TRANSLATION_1_3');

    // And the canonical text offers this account no control at all.
    await page.goto('/admin/quran/ayat/1/1');
    await expect(page.getByRole('link', { name: 'Begin a correction' })).toHaveCount(0);
    await page.goto('/admin/quran/ayat/1/1?correct=1');
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
    const correctionUrl = `/admin/quran/ayat/1/1?correct=1&source=${ids.correctionSource}`;
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
    await page.goto('/admin/quran/ayat/1/1');
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

    await page.goto('/admin/quran/ayat/1/1');
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
    await visitFixture(page, '/quran/surah/1/1');
    await expect(page.locator('[aria-labelledby="ayah-arabic"] p')).toHaveText(CORRECTED);
  });
});
