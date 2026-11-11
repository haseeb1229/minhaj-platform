import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Locator, Page, Response, TestInfo } from '@playwright/test';

import { ayahWords } from '../../packages/contracts/src/quran/values.ts';
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

/**
 * Quran Part 4: a neutral, invented phrase ("this is the key of life") written
 * with the Uthmani encoding's conventions — the dagger alef on a tatweel, the
 * alef wasla, a waw carrying the dagger alef. Never an Ayah. Carried by 3:42
 * alone, past the first reading window, so its place in the Surah is `?from=41`.
 */
const UTHMANI_SHAPED = 'هَـٰذَا مِفْتَـٰحُ ٱلْحَيَوٰةِ';
/** Its last word as stored, and as ordinary typing writes it. */
const UTHMANI_WORD = 'ٱلْحَيَوٰةِ';
const TYPED_WORD = 'الحياة';

const canonicalText = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_CANONICAL_${String(surah)}_${String(ayah)} ${NEUTRAL}${
    surah === 1 && ayah === 1 ? ` ${BEH_FATHA}` : ''
  }${surah === 3 && ayah === 42 ? ` ${UTHMANI_SHAPED}` : ''}`;

/** The correction source's text for 1:1 — what the correction may change it to. */
const CORRECTED = `NON_QURAN_FIXTURE_CORRECTED_1_1 ${NEUTRAL} ${BEH_KASRA}`;
/** The same text with the kasra replaced by a fatha: one code point apart. */
const NEAR_MISS = `NON_QURAN_FIXTURE_CORRECTED_1_1 ${NEUTRAL} ${BEH_FATHA}`;

/** 2:1 carries the mark "*" its translator's note answers (Quran Part 6). */
const translationText = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_TRANSLATION_${String(surah)}_${String(ayah)}${
    surah === 1 && ayah === 2 ? ` ${WORD}` : ''
  }${surah === 2 && ayah === 1 ? '*' : ''}`;

/**
 * A second, Urdu-language translation's text: a sentinel and neutral Urdu ("test
 * text"); 2:1 carries the Urdu mark "٭" its note answers.
 */
const urduText = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_URDU_${String(surah)}_${String(ayah)} آزمائشی متن${
    surah === 2 && ayah === 1 ? '٭' : ''
  }`;

/**
 * Quran Part 7: the fixture word-by-word work's glosses — invented sentinels,
 * never a meaning of any word: [surah, ayah, position, gloss]. 1:1 glosses its
 * first two words only, 1:2 its first; 1:3 has none, so it keeps its plain line.
 */
const GLOSSES: readonly (readonly [number, number, number, string])[] = [
  [1, 1, 1, 'NON_QURAN_FIXTURE gloss one'],
  [1, 1, 2, 'NON_QURAN_FIXTURE gloss two'],
  [1, 2, 1, 'NON_QURAN_FIXTURE gloss three'],
];

/**
 * Quran Part 6: the fixture translator's notes — invented sentinels, never a
 * real note. 2:1's answer the marks above; 2:2's English note is on the Ayah
 * as a whole (its text carries no mark), in two paragraphs.
 */
const NOTE = {
  en21: 'NON_QURAN_FIXTURE_NOTE_EN_2_1 an invented note',
  en22: 'NON_QURAN_FIXTURE_NOTE_EN_2_2 a note on the whole Ayah',
  en22second: 'NON_QURAN_FIXTURE_NOTE_EN_2_2 its second paragraph',
  ur21: 'NON_QURAN_FIXTURE_NOTE_UR_2_1 آزمائشی حاشیہ',
} as const;

const ids = {
  source: randomUUID(),
  correctionSource: randomUUID(),
  acceptance: randomUUID(),
  translation: randomUUID(),
  urdu: randomUUID(),
  transliteration: randomUUID(),
  // Quran Part 7: a fixture word-by-word work.
  wordByWord: randomUUID(),
  tafsir: randomUUID(),
  tafsirEntry: randomUUID(),
  rule: randomUUID(),
  recitation: randomUUID(),
  segment: randomUUID(),
  asset: randomUUID(),
  reciter: randomUUID(),
  // Quran Part 5: a second, UNTIMED recitation by a second fictional reciter.
  narration: randomUUID(),
  narrationSegment: randomUUID(),
  narrationAsset: randomUUID(),
  narrator: randomUUID(),
  topic: randomUUID(),
};

const slug = {
  translation: `fixture-translation-${run}`,
  urdu: `fixture-urdu-${run}`,
  transliteration: `fixture-transliteration-${run}`,
  wordByWord: `fixture-word-by-word-${run}`,
  adminWordByWord: `fixture-admin-word-by-word-${run}`,
  tafsir: `fixture-tafsir-${run}`,
  rule: `fixture-tajweed-${run}`,
  recitation: `fixture-recitation-${run}`,
  reciter: `fixture-reciter-${run}`,
  narration: `fixture-narration-${run}`,
  narrator: `fixture-reciter-two-${run}`,
  // Neither the slug nor the name contains the word the taxonomy spec uses to
  // find the canonical `quran` topic's row, so the two specs never collide.
  topic: `fixture-topic-${run}`,
  adminTranslation: `fixture-admin-translation-${run}`,
};

const NAME = {
  translation: `NON_QURAN_FIXTURE translation ${run}`,
  urdu: `NON_QURAN_FIXTURE urdu translation ${run}`,
  transliteration: `NON_QURAN_FIXTURE transliteration ${run}`,
  wordByWord: `NON_QURAN_FIXTURE word by word ${run}`,
  adminWordByWord: `NON_QURAN_FIXTURE admin word by word ${run}`,
  tafsir: `NON_QURAN_FIXTURE tafsir ${run}`,
  rule: `NON_QURAN_FIXTURE tajweed rule ${run}`,
  recitation: `NON_QURAN_FIXTURE recitation ${run}`,
  reciter: `Fixture Reciter One ${run}`,
  narration: `NON_QURAN_FIXTURE narration ${run}`,
  narrator: `Fixture Reciter Two ${run}`,
  topic: `Non-scriptural fixture topic ${run}`,
  adminTranslation: `NON_QURAN_FIXTURE admin translation ${run}`,
  adminTranslationRenamed: `NON_QURAN_FIXTURE admin translation renamed ${run}`,
};

/**
 * Synthetic silence, 400 frames — about ten seconds, long enough for the
 * player's follow-along proofs to see each fictional Ayah begin (Quran Part 5).
 */
const AUDIO = syntheticSilentMp3(400);

/**
 * The fixture recitation's per-Ayah timing in that silence: [ayah, startMs,
 * endMs]. Made up, like the structure — the opening before 1:1 stands for a
 * reciter's isti'adha, which the player lets be heard.
 */
const TIMING: readonly (readonly [number, number, number])[] = [
  [1, 500, 3500],
  [2, 3500, 6500],
  [3, 6500, 9500],
];

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

/** The recitation dock, once a press has made it appear (Quran Part 5). */
function dock(page: Page): Locator {
  return page.getByRole('region', { name: 'Recitation player' });
}

/** Waits until the dock reports this Ayah as the one being heard. */
async function hearing(page: Page, ayah: number): Promise<void> {
  await expect(dock(page)).toHaveAttribute('data-playing-ayah', String(ayah), {
    timeout: 30_000,
  });
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
  await seedAsset(ids.narrationAsset);
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
    INSERT INTO [dbo].[QuranTranslationNote] ([translationId],[surahNumber],[ayahNumber],[ordinal],[marker],[text]) VALUES
      (N'${ids.translation}', 2, 1, 1, N'*', ${n(NOTE.en21)}),
      (N'${ids.translation}', 2, 2, 1, N'*', ${n(`${NOTE.en22}\n\n${NOTE.en22second}`)}),
      (N'${ids.urdu}', 2, 1, 1, N'٭', ${n(NOTE.ur21)});
    UPDATE [dbo].[QuranTranslation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.urdu}';

    INSERT INTO [dbo].[QuranTransliteration] ([id],[slug],[languageCode],[name],[scheme],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.transliteration}', N'${slug.transliteration}', N'en', ${n(NAME.transliteration)}, N'NON_QURAN_FIXTURE scheme', N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranTransliterationText] ([transliterationId],[surahNumber],[ayahNumber],[text]) VALUES
      (N'${ids.transliteration}', 1, 1, N'NON_QURAN_FIXTURE_TRANSLITERATION_1_1'),
      (N'${ids.transliteration}', 1, 2, N'NON_QURAN_FIXTURE_TRANSLITERATION_1_2');
    UPDATE [dbo].[QuranTransliteration] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.transliteration}';

    INSERT INTO [dbo].[QuranWordByWord] ([id],[slug],[languageCode],[name],[description],[attribution],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.wordByWord}', N'${slug.wordByWord}', N'en', ${n(NAME.wordByWord)}, N'NON_QURAN_FIXTURE browser word-by-word work.', N'NON_QURAN_FIXTURE attribution', N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranWordByWordContributor] ([wordByWordId],[personId],[role],[position]) VALUES
      (N'${ids.wordByWord}', N'${ids.reciter}', N'translator', 0);
    INSERT INTO [dbo].[QuranWordByWordGloss] ([wordByWordId],[surahNumber],[ayahNumber],[position],[text]) VALUES
      ${GLOSSES.map(([surah, ayah, position, gloss]) => `(N'${ids.wordByWord}', ${String(surah)}, ${String(ayah)}, ${String(position)}, ${n(gloss)})`).join(', ')};
    UPDATE [dbo].[QuranWordByWord] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.wordByWord}';

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

    INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[style],[languageCode],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.recitation}', N'${slug.recitation}', N'${ids.reciter}', ${n(NAME.recitation)}, N'NON_QURAN_FIXTURE style', N'ar', N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah],[assetId],[createdAt]) VALUES
      (N'${ids.segment}', N'${ids.recitation}', 1, 1, 3, N'${ids.asset}', SYSUTCDATETIME());
    -- Quran Part 5: the segment is timed for every Ayah, in ONE statement.
    INSERT INTO [dbo].[QuranRecitationTiming] ([segmentId],[ayahNumber],[startMs],[endMs]) VALUES
      ${TIMING.map(([ayah, start, end]) => `(N'${ids.segment}', ${String(ayah)}, ${String(start)}, ${String(end)})`).join(', ')};
    UPDATE [dbo].[QuranRecitation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.recitation}';

    INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${ids.narrator}', N'${slug.narrator}', N'en', N'published');
    INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (N'${ids.narrator}', N'en', ${n(NAME.narrator)}, NULL);
    INSERT INTO [dbo].[QuranRecitation] ([id],[slug],[personId],[name],[style],[languageCode],[state],[version],[createdAt],[updatedAt]) VALUES
      (N'${ids.narration}', N'${slug.narration}', N'${ids.narrator}', ${n(NAME.narration)}, NULL, N'ur', N'draft', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah],[assetId],[createdAt]) VALUES
      (N'${ids.narrationSegment}', N'${ids.narration}', 2, 1, 4, N'${ids.narrationAsset}', SYSUTCDATETIME());
    UPDATE [dbo].[QuranRecitation] SET [state]=N'published', [sourceId]=N'${ids.source}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.narration}';

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

  test('Part 7: transliteration and word by word are hidden — no menu link, and both routes 404', async ({
    page,
    request,
  }) => {
    // Both fixture works are published, but no corpus is active, so neither
    // is public: the feature does not exist for a visitor.
    for (const missing of [
      '/quran/transliteration',
      '/quran/word-by-word',
      '/ur/quran/word-by-word',
    ]) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
    }
    await page.goto('/');
    for (const path of ['/quran/transliteration', '/quran/word-by-word']) {
      await expect(
        page.getByRole('banner').locator(`a[href="${path}"]`),
        path,
      ).toHaveCount(0);
      await expect(
        page.getByRole('contentinfo').locator(`a[href="${path}"]`),
      ).toHaveCount(0);
    }
    await page.goto('/sitemap');
    expect(
      (await hrefsIn(page)).filter((href) => /transliteration|word-by-word/.test(href)),
    ).toEqual([]);
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

    // Urdu and Arabic: right to left, the opening words marked Arabic — the
    // first Juz's from Al-Baqarah 2:1, its traditional name (`juzOpeningAyah`).
    for (const locale of ['ur', 'ar'] as const) {
      await visitFixture(page, localizedPath(locale, '/quran/juz'), locale);
      await expect(page.locator('html'), locale).toHaveAttribute('dir', 'rtl');
      await expect(
        page.getByRole('main').locator('ol span[lang="ar"]').first(),
        locale,
      ).toContainText(canonicalText(2, 1).split(' ').slice(0, 3).join(' '));
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

  test('Part 6: a translator’s note opens from its mark, shows under every Ayah on request, and needs no script', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    await visitFixture(page, '/quran/surah/2');
    await readerReady(page);
    const work = (ayah: number) =>
      page
        .locator(`#ayah-2-${String(ayah)}`)
        .locator(`[data-translation-work="${NAME.translation}"]`);

    // The translation is still exactly the stored text; its mark is the link.
    await expect(work(1).locator('[data-translation-text]')).toHaveText(
      translationText(2, 1),
    );
    const mark = work(1).getByRole('link', { name: '* Translator’s note 1' });
    await expect(mark).toHaveText('*');
    const notes = work(1).locator('details[data-translation-notes]');
    await expect(notes).not.toHaveAttribute('open', '');
    await expect(work(1).getByText(NOTE.en21)).toBeHidden();

    // The mark opens its note in a dialog, and closing it returns to the mark.
    await mark.click();
    const dialog = page.getByRole('dialog', { name: 'Translator’s note' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(NOTE.en21);
    await expect(dialog).toContainText('Surah 2, Ayah 1');
    await expect(dialog).toContainText(NAME.translation);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(mark).toBeFocused();

    // A note on the Ayah as a whole is listed, never placed in the text.
    await expect(work(2).locator('[data-translation-text] a')).toHaveCount(0);
    const whole = work(2).locator('details[data-translation-notes] summary');
    await expect(whole).toHaveText('Translator’s note');
    await whole.click();
    await expect(work(2).getByText(NOTE.en22second)).toBeVisible();

    // Notes under every Ayah, from the settings, kept across a reload.
    await page.getByRole('button', { name: 'Settings' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reading settings' });
    await sheet.getByRole('radio', { name: 'Show under every Ayah' }).check();
    await page.keyboard.press('Escape');
    await expect(notes).toHaveAttribute('open', '');
    await expect(work(1).getByText(NOTE.en21)).toBeVisible();
    await page.reload();
    await readerReady(page);
    await expect(page.locator('#quran-reader')).toHaveAttribute('data-notes', 'inline');
    await expect(notes).toHaveAttribute('open', '');
    await expect(work(1).getByText(NOTE.en21)).toBeVisible();

    // No sideways scroll at 320px and no serious finding, the notes open.
    for (const target of ['/quran/surah/2', '/ur/quran/surah/2']) {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(target);
      await readerReady(page);
      const { overflow, offenders } = await overflowOf(page);
      expect(overflow, `${target}: ${offenders.join(', ')}`).toBeLessThanOrEqual(0);
      await page.setViewportSize({ width: 1280, height: 800 });
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

    // Back to notes on request: the disclosures close again.
    await page.goto('/quran/surah/2');
    await readerReady(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await sheet.getByRole('radio', { name: 'Open from their marks' }).check();
    await page.keyboard.press('Escape');
    await expect(notes).not.toHaveAttribute('open', '');

    // In Urdu, the Urdu translation's note reads right to left, in its words.
    await visitFixture(page, '/ur/quran/surah/2', 'ur');
    await readerReady(page);
    const urdu = page
      .locator('#ayah-2-1')
      .locator(`[data-translation-work="${NAME.urdu}"]`);
    await expect(urdu.locator('[data-translation-text]')).toHaveText(urduText(2, 1));
    await expect(urdu.locator('a[data-note-ref]')).toHaveText('٭');
    await expect(urdu.locator('ol.quran-notes-list')).toHaveAttribute('dir', 'rtl');
    await expect(urdu.locator('ol.quran-notes-list')).toHaveAttribute('lang', 'ur');
    await urdu.locator('a[data-note-ref]').click();
    await expect(page.getByRole('dialog')).toContainText(NOTE.ur21);
    await page.keyboard.press('Escape');

    // Without script: the notes are in the page, and a mark jumps to its note.
    const noScript = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(noScript);
    const plain = await noScript.newPage();
    expect((await plain.goto('/quran/surah/2'))?.status()).toBe(200);
    const plainMark = plain
      .locator(`#ayah-2-1 [data-translation-work="${NAME.translation}"]`)
      .locator('a[data-note-ref]');
    const target = (await plainMark.getAttribute('href')) ?? '';
    expect(target).toMatch(/^#translation-2-1(-\d+)?-note-1$/);
    await expect(plain.locator(target)).toHaveCount(1);
    await expect(plain.locator(target)).toContainText(NOTE.en21);
    await plainMark.click();
    await expect(plain).toHaveURL(new RegExp(`${target}$`));
    await expect(plain.locator(target)).toBeVisible();
  });

  test('Part 6: the translations — counted coverage and notes, a work Surah by Surah, and one Ayah compared across every translation', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    await visitFixture(page, '/quran/translations');
    const card = page.getByRole('article', { name: NAME.translation });
    await expect(card).toContainText('3 of 3 Surahs');
    await expect(card).toContainText('2 notes');
    await expect(page.getByRole('article', { name: NAME.urdu })).toContainText('1 note');
    await expect(
      card.getByRole('link', { name: 'Read with this translation' }),
    ).toHaveAttribute('href', `/quran/surah/1?translation=${slug.translation}`);
    await expect(
      card.getByRole('link', { name: 'Compare translations' }),
    ).toHaveAttribute('href', '/quran/translations/compare?surah=1&ayah=1');

    // One work: what it covers, Surah by Surah, each read with the work.
    await visitFixture(page, `/quran/translations/${slug.translation}`);
    const coverage = page.locator('ol[aria-labelledby="work-coverage"]');
    await expect(coverage.getByRole('listitem')).toHaveCount(3);
    await expect(coverage.getByRole('listitem').nth(1)).toContainText(
      'Complete · 2 notes',
    );
    await expect(
      coverage.getByRole('link', { name: /NON_QURAN_FIXTURE Surah Two/ }),
    ).toHaveAttribute('href', `/quran/surah/2?translation=${slug.translation}`);

    // The compare view: the Arabic once, every translation beneath, notes open.
    await visitFixture(page, '/quran/translations/compare?surah=2&ayah=1');
    const compared = page.locator('article[data-ayah="2:1"]');
    await expect(compared.locator('p[data-ayah-arabic]')).toHaveCount(1);
    await expect(compared.locator('p[data-ayah-arabic]')).toHaveText(canonicalText(2, 1));
    await expect(compared.locator('[data-translation-work]')).toHaveCount(2);
    await expect(compared.getByText(NOTE.en21)).toBeVisible();
    await expect(compared.getByText(NOTE.ur21)).toBeVisible();
    await expect(
      compared.locator(`[data-translation-work="${NAME.urdu}"] ol`),
    ).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('link', { name: 'Next Ayah (2:2)' })).toHaveAttribute(
      'href',
      '/quran/translations/compare?surah=2&ayah=2',
    );
    await expect(page.getByRole('link', { name: 'Previous Ayah (1:3)' })).toHaveAttribute(
      'href',
      '/quran/translations/compare?surah=1&ayah=3',
    );
    // An Ayah the text does not hold is said to be missing, never replaced.
    await visitFixture(page, '/quran/translations/compare?surah=2&ayah=9');
    await expect(page.getByRole('main')).toContainText(
      'There is no Ayah 2:9 in the text.',
    );
    await expect(page.locator('p[data-ayah-arabic]')).toHaveCount(0);

    // Without script, the GET form chooses the Ayah.
    const noScript = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(noScript);
    const plain = await noScript.newPage();
    await plain.goto('/quran/translations/compare');
    await plain.locator('#compare-surah').selectOption('3');
    await plain.locator('#compare-ayah').fill('42');
    await plain.getByRole('button', { name: 'Show' }).click();
    await plain.waitForURL(/compare\?surah=3&ayah=42$/);
    await expect(plain.locator('article[data-ayah="3:42"]')).toContainText(
      translationText(3, 42),
    );

    // Right to left in Urdu and Arabic, no sideways scroll at 320px, and no
    // serious accessibility finding on the listing, a work or the compare view.
    for (const target of [
      '/ur/quran/translations',
      `/ar/quran/translations/${slug.urdu}`,
      '/ur/quran/translations/compare?surah=2&ayah=1',
      '/quran/translations/compare?surah=2&ayah=1',
    ]) {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(target);
      if (!target.startsWith('/quran'))
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const { overflow, offenders } = await overflowOf(page);
      expect(overflow, `${target}: ${offenders.join(', ')}`).toBeLessThanOrEqual(0);
      await page.setViewportSize({ width: 1280, height: 800 });
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

  /* ---- Quran Part 7: transliteration and word by word -------------------- */

  /** No serious or critical accessibility finding; lesser ones annotated. */
  async function axeClean(page: Page, target: string, testInfo: TestInfo): Promise<void> {
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

  /** The reader's settings sheet, opened. */
  async function openSettings(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'Settings' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reading settings' });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  /** How many header links lead to a path, after a fresh page load. */
  async function headerLinks(page: Page, path: string): Promise<number> {
    await page.goto('/quran');
    return page.getByRole('banner').locator(`a[href="${path}"]`).count();
  }

  test('Part 7: while no work of a layer is public, nothing offers it — menu, landing, settings, form — and its route is a 404', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // While both ARE public: the menu, the landing and the settings offer them.
    await expect
      .poll(() => headerLinks(page, '/quran/word-by-word'), {
        timeout: 90_000,
        intervals: [3_000],
      })
      .toBeGreaterThan(0);
    expect(await hrefsIn(page)).toContain('/quran/word-by-word');

    // The operator withdraws both works (draft): nothing of either is public.
    const withdraw = (state: 'draft' | 'published') =>
      sql.query(`
        UPDATE [dbo].[QuranTransliteration] SET [state]=N'${state}', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.transliteration}';
        UPDATE [dbo].[QuranWordByWord] SET [state]=N'${state}', [version]=[version]+1, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.wordByWord}';
      `);
    await withdraw('draft');
    try {
      for (const missing of ['/quran/transliteration', '/quran/word-by-word']) {
        const response = await request.get(missing, { maxRedirects: 0 });
        expect(response.status(), missing).toBe(404);
      }
      // The reader: no choice in its settings, none in its reading form, and
      // an address that names one says it is unavailable and shows nothing.
      await visitFixture(page, '/quran/surah/1');
      await readerReady(page);
      const sheet = await openSettings(page);
      await expect(sheet.getByRole('group', { name: 'Transliteration' })).toHaveCount(0);
      await expect(sheet.getByRole('group', { name: 'Word by word' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('#reading-transliteration')).toHaveCount(0);
      await expect(page.locator('#reading-words')).toHaveCount(0);
      await expect(
        page.locator('[data-transliteration-index], [data-words-index]'),
      ).toHaveCount(0);
      await visitFixture(page, `/quran/surah/1?words=${slug.wordByWord}`);
      await expect(page.getByRole('main')).toContainText(
        'The word-by-word work you asked for is not available',
      );
      await expect(page.locator('[data-words-index]')).toHaveCount(0);
      // The landing lists neither.
      await visitFixture(page, '/quran');
      const landing = await hrefsIn(page);
      expect(landing).not.toContain('/quran/transliteration');
      expect(landing).not.toContain('/quran/word-by-word');
      // The Quran menu drops both once the presence snapshot (cached for at
      // most 30 seconds) sees it.
      for (const path of ['/quran/transliteration', '/quran/word-by-word'])
        await expect
          .poll(() => headerLinks(page, path), { timeout: 90_000, intervals: [3_000] })
          .toBe(0);
      const quranMenu = page
        .getByRole('navigation', { name: 'Main navigation' })
        // On a Quran page the button also says it is the current section.
        .getByRole('button', { name: /^Quran\b/ });
      await quranMenu.click();
      await expect(
        page
          .getByRole('banner')
          .getByRole('link', { name: 'Quran translations' })
          .first(),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('part7-hidden-quran-menu-1440.png'),
      });
      await page.keyboard.press('Escape');
    } finally {
      await withdraw('published');
    }
    // Published again: everything appears again.
    for (const path of ['/quran/transliteration', '/quran/word-by-word'])
      await expect
        .poll(() => headerLinks(page, path), { timeout: 90_000, intervals: [3_000] })
        .toBeGreaterThan(0);
    expect((await request.get('/quran/word-by-word')).status()).toBe(200);
  });

  test('Part 7: a chosen transliteration sits under the Arabic and word by word replaces its line — kept, without script, RTL, 320px, axe', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    // An RTL translation on an English page aligns to its own start: its
    // block ends where the Arabic line ends, not at the column's left.
    await visitFixture(page, `/quran/surah/2?translation=${slug.urdu}`);
    const urduBlock = await page
      .locator(`#ayah-2-1 [data-translation-work="${NAME.urdu}"]`)
      .boundingBox();
    const arabicLine = await page.locator('#ayah-2-1 .quran-ayah-arabic').boundingBox();
    expect(urduBlock).not.toBeNull();
    expect(
      Math.abs(
        (urduBlock?.x ?? 0) +
          (urduBlock?.width ?? 0) -
          ((arabicLine?.x ?? 0) + (arabicLine?.width ?? 0)),
      ),
      'the Urdu block’s right edge is the Arabic line’s',
    ).toBeLessThanOrEqual(4);
    // And an English one on an Urdu page starts where the Arabic line starts.
    await visitFixture(page, `/ur/quran/surah/2?translation=${slug.translation}`, 'ur');
    const englishBlock = await page
      .locator(`#ayah-2-1 [data-translation-work="${NAME.translation}"]`)
      .boundingBox();
    const urduArabic = await page.locator('#ayah-2-1 .quran-ayah-arabic').boundingBox();
    expect(Math.abs((englishBlock?.x ?? 0) - (urduArabic?.x ?? 0))).toBeLessThanOrEqual(
      4,
    );
    // …and its words run from that start, not flush right.
    expect(
      await page
        .locator(
          `#ayah-2-1 [data-translation-work="${NAME.translation}"] [data-translation-text]`,
        )
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getBoundingClientRect().x - element.getBoundingClientRect().x;
        }),
    ).toBeLessThanOrEqual(2);

    // Nothing of either layer shows until it is chosen.
    await visitFixture(page, '/quran/surah/1');
    await readerReady(page);
    const row = page.locator('#ayah-1-1');
    const transliteration = row.locator('[data-transliteration-index="0"]');
    const words = row.locator('[data-words-index="0"]');
    const plain = row.locator('.quran-ayah-arabic');
    await expect(transliteration).toBeHidden();
    await expect(words).toBeHidden();
    await expect(plain).toBeVisible();

    // Chosen in the settings: the transliteration, between the Arabic and the
    // translation, in its own language; the words, each with its gloss.
    const sheet = await openSettings(page);
    await sheet
      .getByRole('group', { name: 'Transliteration' })
      .getByRole('radio', { name: NAME.transliteration })
      .check();
    await sheet
      .getByRole('group', { name: 'Word by word' })
      .getByRole('radio', { name: NAME.wordByWord })
      .check();
    await page.keyboard.press('Escape');
    await expect(transliteration).toBeVisible();
    await expect(transliteration.locator('p[lang="en"]')).toHaveText(
      'NON_QURAN_FIXTURE_TRANSLITERATION_1_1',
    );
    await expect(transliteration.locator('p[lang="en"]')).toHaveAttribute('dir', 'ltr');
    await expect(words).toBeVisible();
    await expect(plain).toBeHidden();
    const units = words.locator('li.quran-wbw-word:not(.quran-wbw-end)');
    const expected = ayahWords(canonicalText(1, 1));
    await expect(units).toHaveCount(expected.length);
    await expect(units.locator('[lang="ar"]')).toHaveText(
      expected.map((word) => word.text),
    );
    await expect(units.nth(0).locator('.quran-wbw-gloss')).toHaveText(
      'NON_QURAN_FIXTURE gloss one',
    );
    await expect(units.nth(2).locator('.quran-wbw-gloss')).toHaveCount(0);
    // The gloss is beneath its word, and the first word is on the right.
    const firstWord = await units.nth(0).locator('[lang="ar"]').boundingBox();
    const firstGloss = await units.nth(0).locator('.quran-wbw-gloss').boundingBox();
    const secondWord = await units.nth(1).locator('[lang="ar"]').boundingBox();
    expect((firstGloss?.y ?? 0) > (firstWord?.y ?? 0)).toBe(true);
    expect((firstWord?.x ?? 0) > (secondWord?.x ?? 0)).toBe(true);
    // The order: words (in the Arabic's place), transliteration, translation.
    const wordsBox = await words.boundingBox();
    const transliterationBox = await transliteration.boundingBox();
    const translationBox = await row
      .locator(`[data-translation-work="${NAME.translation}"]`)
      .boundingBox();
    expect((wordsBox?.y ?? 0) < (transliterationBox?.y ?? 0)).toBe(true);
    expect((transliterationBox?.y ?? 0) < (translationBox?.y ?? 0)).toBe(true);
    // An Ayah the work does not gloss keeps its plain line.
    await expect(page.locator('#ayah-1-3 [data-words-index]')).toHaveCount(0);
    await expect(page.locator('#ayah-1-3 .quran-ayah-arabic')).toBeVisible();
    // Copy still carries the stored Arabic, whatever is shown.
    await expect(plain.locator('[data-ayah-arabic]')).toHaveText(canonicalText(1, 1));

    // The recitation highlight still marks the whole Ayah, words included.
    await row.evaluate((element) => element.setAttribute('data-recited', ''));
    expect(
      await row
        .locator('.quran-ayah-body')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');
    await row.evaluate((element) => element.removeAttribute('data-recited'));

    // Kept in this browser, and in place before the first paint.
    await page.reload();
    await expect(page.locator('#quran-reader')).toHaveAttribute(
      'data-transliteration',
      '0',
    );
    await expect(page.locator('#quran-reader')).toHaveAttribute('data-words', '0');
    await expect(words).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('part7-reader-en-1440.png') });

    // The Reading and Page modes keep the flowing Arabic alone.
    await readerReady(page);
    const modes = page.getByRole('group', { name: 'Reading mode' }).first();
    await modes.getByText('Reading', { exact: true }).click();
    await expect(page.locator('#quran-reader')).toHaveAttribute('data-mode', 'reading');
    await expect(words).toBeHidden();
    await expect(transliteration).toBeHidden();
    await expect(plain).toBeVisible();
    await modes.getByText('Translation', { exact: true }).click();
    await expect(page.locator('#quran-reader')).toHaveAttribute(
      'data-mode',
      'translation',
    );
    await expect(words).toBeVisible();

    // Wherever translations show: an Ayah's own page, a Juz, a mushaf page.
    await visitFixture(page, `/quran/surah/1/1?words=${slug.wordByWord}`);
    await expect(page.locator('[aria-labelledby="ayah-words"]')).toContainText(
      'NON_QURAN_FIXTURE gloss two',
    );
    await expect(page.locator('[aria-labelledby="ayah-transliteration"]')).toBeVisible();
    for (const target of ['/quran/juz/1', '/quran/page/1']) {
      await visitFixture(page, target);
      await expect(
        page.locator('#ayah-1-1 [data-words-index="0"]'),
        target,
      ).toBeVisible();
    }

    // Urdu and Arabic: the page is right to left, the Latin transliteration
    // and the English glosses left to right inside it.
    for (const [locale, target] of [
      ['ur', '/ur/quran/surah/1'],
      ['ar', '/ar/quran/surah/1'],
    ] as const) {
      await visitFixture(page, target, locale);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(
        row.locator('[data-transliteration-index="0"] p[lang="en"]'),
      ).toHaveAttribute('dir', 'ltr');
      await expect(row.locator('.quran-wbw-gloss').first()).toHaveAttribute('dir', 'ltr');
      await expect(row.locator('.quran-wbw-words')).toHaveAttribute('dir', 'rtl');
      // The Latin line and its attribution begin at their own (left) start,
      // never set flush right by the page's direction.
      for (const part of ['p[lang="en"]', 'p[id]'])
        expect(
          await row
            .locator(`[data-transliteration-index="0"] ${part}`)
            .evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return range.getBoundingClientRect().x - element.getBoundingClientRect().x;
            }),
          `${locale} ${part}`,
        ).toBeLessThanOrEqual(2);
      if (locale === 'ur') {
        await row.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('part7-reader-ur-1440.png') });
      }
    }

    // 320px: nothing scrolls sideways; 390px screenshots; no serious finding.
    for (const target of ['/quran/surah/1', '/ur/quran/surah/1', '/ar/quran/surah/1/1']) {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(target);
      await readerReady(page);
      const { overflow, offenders } = await overflowOf(page);
      expect(overflow, `${target}: ${offenders.join(', ')}`).toBeLessThanOrEqual(0);
    }
    for (const [name, target] of [
      ['en', '/quran/surah/1'],
      ['ur', '/ur/quran/surah/1'],
    ] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(target);
      await readerReady(page);
      await page.locator('#ayah-1-1').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`part7-reader-${name}-390.png`),
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await axeClean(page, target, testInfo);
    }

    // Without script: the reading form chooses both, and the server draws them.
    const noScript = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(noScript);
    const bare = await noScript.newPage();
    await bare.goto('/quran/surah/1');
    await bare.locator('#reading-options summary').click();
    await bare.locator('#reading-transliteration').selectOption(slug.transliteration);
    await bare.locator('#reading-words').selectOption(slug.wordByWord);
    await bare.locator('#reading-options').getByRole('button', { name: 'Apply' }).click();
    await bare.waitForURL(/words=/);
    await expect(
      bare.locator('#ayah-1-1 [data-transliteration-index="0"]'),
    ).toBeVisible();
    await expect(bare.locator('#ayah-1-1 [data-words-index="0"]')).toBeVisible();
    await expect(bare.locator('#ayah-1-1 .quran-ayah-arabic')).toBeHidden();

    // Back to none, so the journey's later pages read as before.
    await page.goto('/quran/surah/1');
    await readerReady(page);
    const reset = await openSettings(page);
    await reset
      .getByRole('group', { name: 'Transliteration' })
      .getByRole('radio', { name: 'None' })
      .check();
    await reset
      .getByRole('group', { name: 'Word by word' })
      .getByRole('radio', { name: 'None' })
      .check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#quran-reader')).toHaveAttribute('data-words', '');
  });

  test('Part 7: the transliteration and word-by-word listings count, sample and lead to the reader', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await visitFixture(page, '/quran/transliteration');
    const card = page.getByRole('article', { name: NAME.transliteration });
    // Two of Surah 1's three ayat: none complete, one in part.
    await expect(card).toContainText('0 of 3 Surahs · 1 more in part');
    await expect(card).toContainText('NON_QURAN_FIXTURE scheme');
    await expect(card.locator('figure p[data-ayah-arabic]')).toHaveText(
      canonicalText(1, 1),
    );
    await expect(
      card.locator('figure [data-transliteration-index] p[lang="en"]'),
    ).toHaveText('NON_QURAN_FIXTURE_TRANSLITERATION_1_1');
    await expect(
      card.getByRole('link', { name: 'Read with this transliteration' }),
    ).toHaveAttribute('href', `/quran/surah/1?transliteration=${slug.transliteration}`);

    await visitFixture(page, '/quran/word-by-word');
    const words = page.getByRole('article', { name: NAME.wordByWord });
    await expect(words).toContainText('3 words');
    await expect(words).toContainText(NAME.reciter);
    await expect(words).toContainText('NON_QURAN_FIXTURE attribution');
    await expect(words.locator('figure .quran-wbw-gloss').first()).toHaveText(
      'NON_QURAN_FIXTURE gloss one',
    );
    await expect(words.getByRole('link', { name: 'Read word by word' })).toHaveAttribute(
      'href',
      `/quran/surah/1?words=${slug.wordByWord}`,
    );

    // The compare view shows the transliteration under the Arabic.
    await visitFixture(page, '/quran/translations/compare?surah=1&ayah=1');
    await expect(page.locator('article[data-ayah="1:1"]')).toContainText(
      'NON_QURAN_FIXTURE_TRANSLITERATION_1_1',
    );

    for (const target of [
      '/ur/quran/transliteration',
      '/ar/quran/word-by-word',
      '/quran/word-by-word',
    ]) {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(target);
      if (!target.startsWith('/quran'))
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const { overflow, offenders } = await overflowOf(page);
      expect(overflow, `${target}: ${offenders.join(', ')}`).toBeLessThanOrEqual(0);
      await page.setViewportSize({ width: 1280, height: 800 });
      await axeClean(page, target, testInfo);
    }
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
    // Quran Part 5 adds an untimed narration by a second fictional reciter.
    await expect(rows).toHaveCount(2);
    const row = rows.filter({
      has: page.getByRole('heading', { name: NAME.recitation }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link', { name: NAME.reciter })).toHaveAttribute(
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

  /* -------------------------------------------------------------------------
   * Quran Part 5 — the recitation player
   * ----------------------------------------------------------------------- */

  test('Part 5: nothing plays or loads until asked; Play on an Ayah starts there and the text follows it', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const audio: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/assets/quran/recitations/')) audio.push(request.url());
    });
    const response = await visitFixture(page, '/quran/surah/1');
    // The Quran routes alone admit the recitation stream allowlist as media,
    // and delegate autoplay to the page itself — nothing else.
    expect(response.headers()['content-security-policy']).toContain(
      "media-src 'self' https://cdn.mp3quran.net",
    );
    expect(response.headers()['permissions-policy']).toContain('autoplay=(self)');
    const elsewhere = await page.request.get('/listen');
    expect(elsewhere.headers()['content-security-policy']).not.toContain('media-src');
    expect(elsewhere.headers()['permissions-policy']).toContain('autoplay=()');

    await readerReady(page);
    // The player is ready and the chosen recitation is timed: each row offers Play.
    await expect(page.locator('html')).toHaveAttribute('data-quran-player', 'timed');
    const play = page
      .getByRole('article', { name: 'Surah 1, Ayah 2' })
      .getByRole('button', { name: 'Play from this Ayah' });
    await expect(play).toBeVisible();
    // Silent, and nothing fetched, until the press: no dock, no audio element.
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator('audio')).toHaveCount(0);
    expect(audio).toEqual([]);

    await play.click();
    await expect(dock(page)).toBeVisible();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
      timeout: 30_000,
    });
    await hearing(page, 2);
    await expect(page.locator('#ayah-1-2')).toHaveAttribute('data-recited', '');
    await expect(dock(page)).toContainText('Ayah 2');
    // The highlight moves on as the recitation does.
    await hearing(page, 3);
    await expect(page.locator('#ayah-1-3')).toHaveAttribute('data-recited', '');
    await expect(page.locator('#ayah-1-2')).not.toHaveAttribute('data-recited', '');
    // First-party bytes, of exactly this segment.
    expect(audio.length).toBeGreaterThan(0);
    for (const url of audio)
      expect(url).toContain(
        `/assets/quran/recitations/${ids.recitation}/${ids.segment}/${ids.asset}`,
      );
    // The lock screen names the Ayah and the reciter.
    expect(
      await page.evaluate(() => navigator.mediaSession.metadata?.title ?? ''),
    ).toContain('Ayah');
    expect(await page.evaluate(() => navigator.mediaSession.metadata?.artist ?? '')).toBe(
      NAME.reciter,
    );
  });

  test('Part 5: the recitation keeps playing while the reader moves between Quran pages, and stops when closed', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await visitFixture(page, '/quran/surah/1');
    await readerReady(page);
    await page
      .getByRole('article', { name: 'Surah 1, Ayah 1' })
      .getByRole('button', { name: 'Play from this Ayah' })
      .click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      (window as unknown as { quranSameDocument?: boolean }).quranSameDocument = true;
    });

    // A link to another Quran page is followed in place: the same document,
    // the same dock, still playing.
    await page.locator('main a[href="/quran/surah/2"]').first().click();
    await expect(page).toHaveURL(/\/quran\/surah\/2$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Surah Two');
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { quranSameDocument?: boolean }).quranSameDocument ===
          true,
      ),
    ).toBe(true);
    await expect(dock(page)).toBeVisible();
    const before = Number(await dock(page).getAttribute('data-position'));
    await expect
      .poll(async () => Number(await dock(page).getAttribute('data-position')), {
        timeout: 20_000,
      })
      .toBeGreaterThan(before);

    // Closing stops it and takes the dock away.
    await dock(page).getByRole('button', { name: 'Close the player' }).click();
    await expect(dock(page)).toHaveCount(0);
  });

  test('Part 5: repeat each Ayah, a repeated range, speed and the dock’s own keys — remembered in this browser', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await visitFixture(page, '/quran/surah/1');
    await readerReady(page);
    await page
      .getByRole('article', { name: 'Surah 1, Ayah 3' })
      .getByRole('button', { name: 'Play from this Ayah' })
      .click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
      timeout: 30_000,
    });
    await hearing(page, 3);

    // Speed and a repeat, from the dock's settings.
    await dock(page).getByRole('button', { name: 'Player settings' }).click();
    await dock(page).getByLabel('Speed').selectOption('1.5');
    await dock(page).getByLabel('Hear each Ayah').selectOption('2');
    // Heard to its end, Ayah 3 begins again — then the plan is complete.
    await expect
      .poll(async () => Number(await dock(page).getAttribute('data-position')), {
        timeout: 30_000,
        intervals: [100],
      })
      .toBeGreaterThanOrEqual(8000);
    await expect
      .poll(async () => Number(await dock(page).getAttribute('data-position')), {
        timeout: 30_000,
        intervals: [100],
      })
      .toBeLessThan(7500);
    await expect(dock(page)).toHaveAttribute('data-playing-ayah', '3');
    await expect(dock(page)).toHaveAttribute('data-status', /ended|paused/, {
      timeout: 30_000,
    });
    await dock(page).getByLabel('Hear each Ayah').selectOption('1');

    // A range: ayat 1–2, twice, then stop.
    await dock(page).getByLabel('From Ayah').fill('1');
    await dock(page).getByLabel('To Ayah').fill('2');
    await dock(page).getByLabel('Times').selectOption('2');
    await dock(page).getByRole('button', { name: 'Play the range' }).click();
    await expect(dock(page)).toContainText('Repeating ayat 1–2');
    await hearing(page, 2);
    await hearing(page, 1);
    await hearing(page, 2);
    await expect(dock(page)).toHaveAttribute('data-status', 'ended', { timeout: 30_000 });
    await expect(dock(page)).not.toHaveAttribute('data-playing-ayah', '3');

    // The dock's own keys, only while focus is inside it: K plays and pauses.
    const next = dock(page).getByRole('button', { name: 'Next Ayah' });
    await next.focus();
    await page.keyboard.press('k');
    await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
      timeout: 30_000,
    });
    await page.keyboard.press('k');
    await expect(dock(page)).toHaveAttribute('data-status', 'paused');
    // Outside the dock the same key is the page's, not the player's.
    await page.locator('#quran-text').focus();
    await page.keyboard.press('k');
    await expect(dock(page)).toHaveAttribute('data-status', 'paused');

    // Kept in this browser: the next visit has the same speed.
    await page.reload();
    await readerReady(page);
    await page
      .getByRole('article', { name: 'Surah 1, Ayah 1' })
      .getByRole('button', { name: 'Play from this Ayah' })
      .click();
    await dock(page).getByRole('button', { name: 'Player settings' }).click();
    await expect(dock(page).getByLabel('Speed')).toHaveValue('1.5');
  });

  test('Part 5: an untimed recitation plays whole Surahs and says that verse highlighting is unavailable', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await visitFixture(page, '/quran/surah/2');
    await readerReady(page);
    const listen = page.getByRole('region', { name: 'Listen' });
    await listen.getByLabel('Recitation').selectOption(slug.narration);
    await expect(page.locator('html')).toHaveAttribute('data-quran-player', 'untimed');
    // No Ayah can be started at: the per-Ayah buttons give way, and it is said.
    await expect(
      page
        .getByRole('article', { name: 'Surah 2, Ayah 2' })
        .getByRole('button', { name: 'Play from this Ayah' }),
    ).toBeHidden();
    await expect(listen).toContainText(
      'This recitation plays whole Surahs; verse highlighting is not available for it.',
    );
    await listen.getByRole('button', { name: 'Play the Surah' }).click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
      timeout: 30_000,
    });
    await expect(dock(page)).toContainText('verse highlighting is not available');
    await expect(page.locator('[data-recited]')).toHaveCount(0);
    await expect(dock(page).getByRole('button', { name: 'Next Ayah' })).toBeDisabled();
  });

  test('Part 5: the player reads right to left in Urdu and Arabic, fits 320px, and has no serious accessibility finding', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const PLAY = { ur: 'اس آیت سے چلائیں', ar: 'التشغيل من هذه الآية' } as const;
    const REGION = { ur: 'تلاوت پلیئر', ar: 'مشغّل التلاوة' } as const;
    const SETTINGS = { ur: 'پلیئر کی ترتیبات', ar: 'إعدادات المشغّل' } as const;
    for (const locale of ['ur', 'ar'] as const) {
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await visitFixture(page, `/${locale}/quran/surah/1`, locale);
        await readerReady(page);
        await page
          .locator('#ayah-1-1')
          .getByRole('button', { name: PLAY[locale] })
          .click();
        const region = page.getByRole('region', { name: REGION[locale] });
        await expect(region).toHaveAttribute('data-status', 'playing', {
          timeout: 30_000,
        });
        expect(
          await region.evaluate((element) => getComputedStyle(element).direction),
        ).toBe('rtl');
        await region.getByRole('button', { name: SETTINGS[locale] }).click();
        const { overflow, offenders } = await overflowOf(page);
        expect(
          overflow,
          `${locale} ${String(width)}px — beyond the viewport: ${offenders.join(', ')}`,
        ).toBeLessThanOrEqual(0);
      }
    }
    for (const target of ['/quran/surah/1', '/ur/quran/surah/1', '/quran/recitations']) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(target);
      const start = page
        .locator('main [data-quran-play], #ayah-1-1 .quran-ayah-play')
        .first();
      await expect(start).toBeVisible();
      await start.click();
      await expect(page.locator('[data-quran-dock]')).toHaveAttribute(
        'data-status',
        'playing',
        {
          timeout: 30_000,
        },
      );
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

  test('Part 5: the catalogue filters by language and says what each recitation offers; a reciter’s Surahs each play', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await visitFixture(page, '/quran/recitations');
    const cards = page.getByRole('list', { name: 'Recitations' }).getByRole('listitem');
    await expect(cards).toHaveCount(2);
    const timed = cards.filter({
      has: page.getByRole('heading', { name: NAME.recitation }),
    });
    await expect(timed).toContainText('Verse by verse');
    await expect(timed).toContainText('1 Surah');
    const narration = cards.filter({
      has: page.getByRole('heading', { name: NAME.narration }),
    });
    await expect(narration).toContainText('Whole Surah');

    // A GET filter by the language heard: an address, with or without script.
    const filter = page.getByRole('form', { name: 'Filter the recitations' });
    await filter.getByLabel('Language').selectOption('ur');
    await filter.getByRole('button', { name: 'Show' }).click();
    await expect(page).toHaveURL(/[?&]language=ur/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(NAME.narration);
    await expect(
      page.getByRole('status').filter({ hasText: '1 recitation' }),
    ).toBeVisible();

    // The reciter's page lists the Surahs it holds, each with Play.
    await visitFixture(page, `/quran/recitations/${slug.reciter}`);
    const surahs = page.getByRole('region', { name: 'Surahs' }).getByRole('listitem');
    await expect(surahs).toHaveCount(1);
    await surahs
      .first()
      .getByRole('button', { name: /^Play / })
      .click();
    await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
      timeout: 30_000,
    });
    await expect(dock(page)).toContainText(NAME.reciter);
  });

  test('Part 5: without JavaScript a Surah offers its recitations as plain links to the browser’s own player', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    contexts.push(context);
    const page = await context.newPage();
    await visitFixture(page, '/quran/surah/1');
    // No player is there to ask, so no control pretends there is one.
    const buttons = page.locator('.quran-ayah-play');
    await expect(buttons).toHaveCount(3);
    for (const button of await buttons.all()) await expect(button).toBeHidden();
    const listen = page.getByRole('region', { name: 'Listen' });
    const links = listen.getByRole('link');
    await expect(links).toHaveCount(2);
    await listen.getByRole('link', { name: NAME.reciter }).click();
    await expect(page).toHaveURL(new RegExp(`reciter=${slug.recitation}`));
    await expect(page.locator('audio[controls]')).toBeVisible();
    await expect(page.locator('audio[autoplay]')).toHaveCount(0);
  });

  /* -----------------------------------------------------------------------
   * Translation audio — a passage's Urdu translation between the qari's
   * ----------------------------------------------------------------------- */

  test('Translation audio: the qari, then each passage’s translation, then the qari — the passage marked, offered only where it exists, RTL, 320px, axe', async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    // SEEDED HERE AND REMOVED AFTER, so no earlier proof sees it: the
    // narration's Surah 1 in a second stored file of silence, its Arabic timed
    // and aligned against the fixture recitation, with two passages — ayat
    // 1–2, then 3 — each with its "translation" in that silence; and the
    // qari's own Surah 2, timed, where the narration has no passage.
    const narrationSegment = randomUUID();
    const narrationAudio = randomUUID();
    const qariSegment = randomUUID();
    const qariAudio = randomUUID();
    const alignmentSource = randomUUID();
    await seedAsset(narrationAudio);
    await seedAsset(qariAudio);
    await sql.query(`
      INSERT INTO [dbo].[QuranSource] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES
        (N'${alignmentSource}', N'NON_QURAN_FIXTURE_ALIGNMENT_${run}', N'reference', N'NON_QURAN_FIXTURE alignment', N'fixture-1', N'utf-8', N'NON_QURAN_FIXTURE alignment evidence');
      INSERT INTO [dbo].[QuranRecitationSegment] ([id],[recitationId],[surahNumber],[startAyah],[endAyah],[assetId],[createdAt]) VALUES
        (N'${narrationSegment}', N'${ids.narration}', 1, 1, 3, N'${narrationAudio}', SYSUTCDATETIME()),
        (N'${qariSegment}', N'${ids.recitation}', 2, 1, 4, N'${qariAudio}', SYSUTCDATETIME());
      INSERT INTO [dbo].[QuranRecitationTiming] ([segmentId],[ayahNumber],[startMs],[endMs]) VALUES
        (N'${narrationSegment}', 1, 500, 1500), (N'${narrationSegment}', 2, 1500, 2500), (N'${narrationSegment}', 3, 4500, 5500);
      INSERT INTO [dbo].[QuranRecitationTiming] ([segmentId],[ayahNumber],[startMs],[endMs]) VALUES
        (N'${qariSegment}', 1, 500, 2500), (N'${qariSegment}', 2, 2500, 4500), (N'${qariSegment}', 3, 4500, 6500), (N'${qariSegment}', 4, 6500, 8500);
      INSERT INTO [dbo].[QuranRecitationAlignment] ([segmentId],[sourceId],[referenceRecitationId]) VALUES
        (N'${narrationSegment}', N'${alignmentSource}', N'${ids.recitation}');
      INSERT INTO [dbo].[QuranRecitationTranslationSpan] ([segmentId],[startAyah],[endAyah],[startMs],[endMs]) VALUES
        (N'${narrationSegment}', 1, 2, 2500, 4500), (N'${narrationSegment}', 3, 3, 5500, 8000);
    `);
    const SWITCH = {
      en: 'Urdu translation after each passage',
      ur: 'ہر حصے کے بعد اردو ترجمہ',
      ar: 'الترجمة الأردية بعد كل مقطع',
    } as const;
    try {
      const narrationFile = `/assets/quran/recitations/${ids.narration}/${narrationSegment}/${narrationAudio}`;
      const fetched: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes(narrationFile)) fetched.push(request.url());
      });
      await visitFixture(page, '/quran/surah/1');
      await readerReady(page);
      const playAt = (ayah: number) =>
        page
          .getByRole('article', { name: `Surah 1, Ayah ${String(ayah)}` })
          .getByRole('button', { name: 'Play from this Ayah' });
      await playAt(3).click();
      await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
        timeout: 30_000,
      });
      // The setting, offered here: this Surah has passages and the qari is timed.
      await dock(page).getByRole('button', { name: 'Player settings' }).click();
      const toggle = dock(page).getByRole('switch', { name: SWITCH.en });
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeEnabled();
      await expect(dock(page)).toContainText('found by audio comparison');
      await toggle.check();
      // The settings closed again, so the dock no longer covers the page.
      await dock(page).getByRole('button', { name: 'Player settings' }).click();
      await playAt(1).click();
      await hearing(page, 1);

      // Ayah 2 ends the passage 1–2: its translation plays with both ayat marked.
      await expect(dock(page)).toHaveAttribute('data-translating', '1-2', {
        timeout: 30_000,
      });
      await expect(page.locator('#ayah-1-1')).toHaveAttribute('data-recited', '');
      await expect(page.locator('#ayah-1-2')).toHaveAttribute('data-recited', '');
      await expect(dock(page).getByRole('status')).toHaveText(
        'Urdu translation · ayat 1–2',
      );
      expect(
        await page.evaluate(() => navigator.mediaSession.metadata?.title ?? ''),
      ).toContain('Urdu translation');
      expect(fetched.length).toBeGreaterThan(0);

      // Then the qari carries on with Ayah 3, alone marked again.
      await hearing(page, 3);
      await expect(dock(page)).not.toHaveAttribute('data-translating', /.+/, {
        timeout: 30_000,
      });
      await expect(page.locator('#ayah-1-1')).not.toHaveAttribute('data-recited', '');
      // And Ayah 3, a passage of its own, is followed by its translation.
      await expect(dock(page)).toHaveAttribute('data-translating', '3-3', {
        timeout: 30_000,
      });
      await expect(dock(page)).toContainText('Urdu translation · Ayah 3');
      await expect(dock(page)).not.toHaveAttribute('data-translating', /.+/, {
        timeout: 30_000,
      });

      // Surah 2 has no passage: the qari plays alone, and the setting says why.
      await visitFixture(page, '/quran/surah/2');
      await readerReady(page);
      await page
        .getByRole('article', { name: 'Surah 2, Ayah 1' })
        .getByRole('button', { name: 'Play from this Ayah' })
        .click();
      await expect(dock(page)).toHaveAttribute('data-status', 'playing', {
        timeout: 30_000,
      });
      await dock(page).getByRole('button', { name: 'Player settings' }).click();
      await expect(dock(page).getByRole('switch', { name: SWITCH.en })).toBeChecked();
      await expect(dock(page)).toContainText(
        'Not available for this Surah. Surahs that have it: 1.',
      );
      await hearing(page, 3);
      await expect(dock(page)).not.toHaveAttribute('data-translating', /.+/);

      // The narration chosen already reads the translation: nothing to add.
      await dock(page)
        .getByRole('combobox', { name: /^Recitation/ })
        .selectOption(slug.narration);
      await expect(dock(page).getByRole('switch', { name: SWITCH.en })).toBeDisabled();
      await expect(dock(page)).toContainText(
        'The narration chosen already reads the Urdu translation.',
      );
      await dock(page)
        .getByRole('combobox', { name: /^Recitation/ })
        .selectOption(slug.recitation);

      // Right to left in Urdu and Arabic, at 320px, the setting in the language.
      for (const locale of ['ur', 'ar'] as const) {
        await page.setViewportSize({ width: 320, height: 800 });
        await visitFixture(page, `/${locale}/quran/surah/1`, locale);
        await readerReady(page);
        await page.locator('#ayah-1-1 .quran-ayah-play').click();
        const region = page.locator('[data-quran-dock]');
        await expect(region).toHaveAttribute('data-status', 'playing', {
          timeout: 30_000,
        });
        await region.locator('button[aria-controls]').click();
        const localToggle = region.getByRole('switch', { name: SWITCH[locale] });
        await expect(localToggle).toBeChecked();
        expect(
          await localToggle.evaluate((element) => getComputedStyle(element).direction),
        ).toBe('rtl');
        await expect(region).toHaveAttribute('data-translating', '1-2', {
          timeout: 30_000,
        });
        const { overflow, offenders } = await overflowOf(page);
        expect(
          overflow,
          `${locale} 320px — beyond the viewport: ${offenders.join(', ')}`,
        ).toBeLessThanOrEqual(0);
      }

      // No serious accessibility finding with the setting open, mid-translation.
      await page.setViewportSize({ width: 1280, height: 800 });
      await visitFixture(page, '/quran/surah/1');
      await readerReady(page);
      await playAt(1).click();
      await dock(page).getByRole('button', { name: 'Player settings' }).click();
      await expect(dock(page)).toHaveAttribute('data-translating', '1-2', {
        timeout: 30_000,
      });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      for (const finding of results.violations.filter((v) => !blocking.includes(v)))
        testInfo.annotations.push({
          type: 'axe',
          description: `translation audio: ${finding.id} (${String(finding.impact)})`,
        });
      expect(
        blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
      ).toEqual([]);
      await dock(page).getByRole('button', { name: 'Close the player' }).click();
    } finally {
      await sql.query(`
        DELETE FROM [dbo].[QuranRecitationTranslationSpan] WHERE [segmentId]=N'${narrationSegment}';
        DELETE FROM [dbo].[QuranRecitationAlignment] WHERE [segmentId]=N'${narrationSegment}';
        DELETE FROM [dbo].[QuranRecitationTiming] WHERE [segmentId] IN (N'${narrationSegment}', N'${qariSegment}');
        DELETE FROM [dbo].[QuranRecitationSegment] WHERE [id] IN (N'${narrationSegment}', N'${qariSegment}');
      `);
    }
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

  /* -------------------------------------------------------------------------
   * Quran Part 4 — search
   * ----------------------------------------------------------------------- */

  /** Opens a Quran search address, polling while the sweep may still be indexing. */
  async function searched(page: Page, target: string, expected: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const response = await page.goto(target);
          expect(response?.status(), target).toBe(200);
          await page.getByRole('heading', { level: 1 }).waitFor();
          return page.getByRole('main').innerText();
        },
        { timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toContain(expected);
  }

  test('Part 4: Arabic typed in ordinary spelling finds the Uthmani-shaped text, marked in place, and a citation or a name goes straight there', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await searched(
      page,
      `/quran/search?q=${encodeURIComponent(TYPED_WORD)}`,
      'Surah 3, Ayah 42',
    );
    const main = page.getByRole('main');
    await expect(main.getByRole('status')).toHaveText(`1 result for “${TYPED_WORD}”`);
    const results = main.getByRole('list', { name: 'Ayat that match' });
    await expect(results.getByRole('listitem')).toHaveCount(1);
    const hit = results.getByRole('article', { name: /Surah 3, Ayah 42/ });
    // The Surah's display name and the citation name the result.
    await expect(hit.getByRole('heading', { level: 3 })).toContainText(
      'NON_QURAN_FIXTURE Surah Three',
    );
    // The Arabic is the stored text, exactly, in the Quran face — and the word
    // typed in ordinary spelling is marked where the Uthmani text writes it.
    const arabic = hit.locator('p[lang="ar"]');
    await expect(arabic).toHaveAttribute('dir', 'rtl');
    await expect(arabic).toHaveAttribute('translate', 'no');
    await expect(arabic).toHaveClass(/quran-text/);
    await expect(arabic).toHaveText(canonicalText(3, 42));
    await expect(arabic.locator('mark')).toHaveText([UTHMANI_WORD]);
    // The ways on: the Ayah, and its place in its Surah's reading window.
    await expect(hit.getByRole('link', { name: 'Open the Ayah' })).toHaveAttribute(
      'href',
      '/quran/surah/3/42',
    );
    await expect(hit.getByRole('link', { name: 'Read in its Surah' })).toHaveAttribute(
      'href',
      '/quran/surah/3?from=41#ayah-3-42',
    );
    // The page names the English translation it shows, as its own language.
    await expect(
      hit.getByRole('group', { name: `Translation: ${NAME.translation}` }),
    ).toBeVisible();

    // The same Ayah, from the word pasted with its marks, and from two words.
    for (const typed of [UTHMANI_WORD, 'هذا مفتاح']) {
      await page.goto(`/quran/search?q=${encodeURIComponent(typed)}`);
      await expect(
        main.getByRole('link', { name: /Surah 3, Ayah 42/ }).first(),
      ).toHaveAttribute('href', '/quran/surah/3/42');
    }

    // A citation — in any digits — goes straight there, its Arabic shown as stored.
    for (const typed of ['2:3', '۲:۳']) {
      await page.goto(`/quran/search?q=${encodeURIComponent(typed)}`);
      const jump = main.getByRole('region', { name: 'Go straight there' });
      await expect(jump.getByRole('link', { name: /Surah 2, Ayah 3/ })).toHaveAttribute(
        'href',
        '/quran/surah/2/3',
      );
      await expect(jump.locator('p[lang="ar"]')).toHaveText(canonicalText(2, 3));
      await expect(
        jump.getByRole('link', { name: 'Read it in its Surah' }),
      ).toHaveAttribute('href', '/quran/surah/2#ayah-2-3');
    }

    // A recorded Surah name goes to the Surah; an Ayah past its count is no place.
    await page.goto(
      `/quran/search?q=${encodeURIComponent('NON_QURAN_FIXTURE Surah Three')}`,
    );
    await expect(
      main.getByRole('region', { name: 'Go straight there' }).getByRole('link'),
    ).toHaveAttribute('href', '/quran/surah/3');
    await page.goto('/quran/search?q=2%3A9');
    await expect(main.getByRole('region', { name: 'Go straight there' })).toHaveCount(0);
  });

  test('Part 4: filters by Surah, Juz and text work without script — chips, clear all, refusals and paging', async ({
    browser,
    clientAddress,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
      extraHTTPHeaders: { 'x-forwarded-for': clientAddress },
    });
    contexts.push(context);
    const page = await context.newPage();
    const main = page.getByRole('main');
    const all = STRUCTURE.length;

    // Every Ayah carries the neutral phrase.
    await searched(
      page,
      `/quran/search?q=${encodeURIComponent('اختبار')}`,
      `${String(all)} results`,
    );

    // The filters are a plain GET form: open them, choose, submit.
    await main.locator('summary', { hasText: 'Filters' }).click();
    await main.getByLabel('Surah', { exact: true }).selectOption('3');
    await main.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/[?&]surah=3(?:&|$)/);
    await expect(main.getByRole('status')).toHaveText(`45 results for “اختبار”`);
    const chip = main.getByRole('link', {
      name: 'Remove filter: Surah 3 · NON_QURAN_FIXTURE Surah Three',
    });
    await expect(chip).toBeVisible();
    // Paging keeps the filter.
    await expect(main.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/quran/search?q=${encodeURIComponent('اختبار')}&surah=3&page=2`,
    );
    const citations = await main
      .getByRole('list', { name: 'Ayat that match' })
      .getByRole('heading', { level: 3 })
      .allInnerTexts();
    expect(citations.every((text) => /Surah 3, Ayah \d+/.test(text))).toBe(true);
    // Removing the chip removes only its filter.
    await chip.click();
    await expect(page).toHaveURL(`/quran/search?q=${encodeURIComponent('اختبار')}`);

    // Surah and Juz together, and "clear all".
    await page.goto(`/quran/search?q=${encodeURIComponent('اختبار')}&surah=2&juz=2`);
    await expect(main.getByRole('status')).toHaveText(`2 results for “اختبار”`);
    await main.getByRole('link', { name: 'Clear all filters' }).click();
    await expect(page).toHaveURL(`/quran/search?q=${encodeURIComponent('اختبار')}`);

    // The text filter: a translation's words in its own language only.
    await page.goto(`/quran/search?q=${WORD}&language=en`);
    await expect(main.getByRole('status')).toHaveText(`1 result for “${WORD}”`);
    await page.goto(`/quran/search?q=${WORD}&language=ar`);
    await expect(main.getByRole('status')).toHaveText(`No Ayah matches “${WORD}”.`);
    await expect(
      main.getByRole('link', { name: 'Search without filters' }),
    ).toHaveAttribute('href', `/quran/search?q=${WORD}`);

    // Refused in words, never widened: a Surah or a language that does not exist,
    // and two filters that do not overlap.
    await page.goto('/quran/search?q=word&surah=9&language=fr');
    await expect(main.getByRole('alert')).toContainText(
      'There is no Surah 9 to search in.',
    );
    await expect(main.getByRole('alert')).toContainText(
      'No public text is written in “fr”.',
    );
    await expect(main.getByRole('list', { name: 'Ayat that match' })).toHaveCount(0);
    await page.goto(`/quran/search?q=${encodeURIComponent('اختبار')}&surah=1&juz=2`);
    await expect(
      main.getByRole('status').filter({ hasText: 'Surah 1 has no Ayah in Juz 2' }),
    ).toBeVisible();

    // An Arabic query that finds nothing is offered the spelling hint.
    await page.goto(`/quran/search?q=${encodeURIComponent('زخرفةمعدومة')}`);
    await expect(main).toContainText('Arabic is matched without diacritics');
  });

  test('Part 4: search reads right-to-left in Urdu and Arabic, never scrolls sideways at 320px, and has no serious accessibility finding', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await searched(
      page,
      `/ur/quran/search?q=${encodeURIComponent(TYPED_WORD)}`,
      'NON_QURAN_FIXTURE_CANONICAL_3_42',
    );
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const hit = page
      .getByRole('main')
      .getByRole('article')
      .filter({ hasText: 'NON_QURAN_FIXTURE_CANONICAL_3_42' });
    await expect(hit.locator('p[lang="ar"] mark')).toHaveText([UTHMANI_WORD]);
    // The Urdu interface shows the Urdu translation, in its own language.
    await expect(hit.locator('p[lang="ur"]')).toContainText(urduText(3, 42));

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of [
        `/quran/search?q=${encodeURIComponent('آزمائشی')}&surah=3&language=ur`,
        `/ur/quran/search?q=${encodeURIComponent(TYPED_WORD)}`,
        `/ar/quran/search?q=${encodeURIComponent('2:3')}`,
      ]) {
        await page.goto(target);
        await page.getByRole('heading', { level: 1 }).waitFor();
        const { overflow, offenders } = await overflowOf(page);
        expect(
          overflow,
          `${String(width)}px ${target} — beyond the viewport: ${offenders.join(', ')}`,
        ).toBeLessThanOrEqual(0);
      }
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    for (const target of [
      `/quran/search?q=${encodeURIComponent(TYPED_WORD)}&surah=3`,
      `/ar/quran/search?q=${encodeURIComponent('2:3')}`,
    ]) {
      await page.goto(target);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page
        .getByRole('main')
        .locator('details')
        .evaluate((element) => {
          (element as HTMLDetailsElement).open = true;
        });
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

    // Layered works are read, not edited — translator's notes too (Part 6).
    await reader.goto(`/admin/quran/translations/${ids.translation}?surah=2`);
    await expect(reader.getByRole('main')).toContainText(NOTE.en21);
    await expect(reader.locator('#note-1-1-text')).toHaveCount(0);
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

    // Quran Part 6: a translator's note beside its text — refused while it
    // answers no mark the text carries, saved once the text carries it.
    const slot = page.locator('fieldset', { has: page.locator('#note-1-1-text') });
    await slot.getByText('Add a translator’s note').click();
    await page.locator('#note-1-1-marker').fill('1:-');
    await page.locator('#note-1-1-text').fill('NON_QURAN_FIXTURE_ADMIN_NOTE_1_1');
    await page.getByRole('button', { name: 'Save changed texts' }).click();
    await expect(page.getByRole('main')).toContainText(
      'A translator’s note must answer a mark in its Ayah’s text',
    );
    await page.locator('#text-1').fill('NON_QURAN_FIXTURE_ADMIN_TRANSLATION_1_1 (1)');
    await page.getByRole('button', { name: 'Save changed texts' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved.' }).first(),
    ).toBeVisible();
    await expect
      .poll(async () =>
        sql.query<{ marker: string; text: string }>(
          `SELECT [marker],[text] FROM [dbo].[QuranTranslationNote] WHERE [translationId]=N'${id}';`,
        ),
      )
      .toEqual([{ marker: '1:-', text: 'NON_QURAN_FIXTURE_ADMIN_NOTE_1_1' }]);

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

  test('Part 7: quran.administer glosses each Arabic word, saves only what changed, and publishes a word-by-word work', async () => {
    test.setTimeout(180_000);
    const page = administrator;
    await page.goto('/admin/quran/word-by-word');
    await page.locator('#new-word-by-word-slug').fill(slug.adminWordByWord);
    await page.locator('#new-word-by-word-name').fill(NAME.adminWordByWord);
    await page.locator('#new-word-by-word-language').selectOption('en');
    await page.locator('#new-word-by-word-source').selectOption(ids.source);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/admin\/quran\/word-by-word\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop() ?? '';

    // Publishing with no gloss is refused, before and by the database.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('main')).toContainText(
      'cannot be published until it has text to show',
    );

    // Surah 1: each stored Arabic word, read-only, beside its gloss field.
    await page.locator('#surah-picker').selectOption('1');
    await page.getByRole('button', { name: 'Show' }).click();
    await page.waitForURL(/\?surah=1/);
    const words = ayahWords(canonicalText(1, 1));
    await expect(page.locator('input[name^="gloss-1-"]')).toHaveCount(words.length);
    // Each field is named by its word, as the stored text has it.
    await expect(page.locator('#gloss-1-2')).toHaveAccessibleName(
      `Gloss of word 2: ${words[1]?.text ?? ''}`,
    );
    await page.locator('#gloss-1-1').fill('NON_QURAN_FIXTURE_ADMIN_GLOSS_1_1');
    await page.locator('#gloss-2-1').fill('NON_QURAN_FIXTURE_ADMIN_GLOSS_2_1');
    await page.getByRole('button', { name: 'Save changed glosses' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved.' }).first(),
    ).toBeVisible();
    // Nothing changed is "unchanged", never a silent second save.
    await page.getByRole('button', { name: 'Save changed glosses' }).click();
    await expect(page.getByRole('main')).toContainText('Nothing changed');
    await expect
      .poll(async () =>
        sql.query<{ ayah: number; position: number; text: string }>(
          `SELECT [ayahNumber] AS [ayah],[position],[text] FROM [dbo].[QuranWordByWordGloss] WHERE [wordByWordId]=N'${id}' ORDER BY [ayahNumber],[position];`,
        ),
      )
      .toEqual([
        { ayah: 1, position: 1, text: 'NON_QURAN_FIXTURE_ADMIN_GLOSS_1_1' },
        { ayah: 2, position: 1, text: 'NON_QURAN_FIXTURE_ADMIN_GLOSS_2_1' },
      ]);

    // Published: read beside the canonical Arabic, which is untouched.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect
      .poll(async () => {
        const [row] = await sql.query<{ state: string }>(
          `SELECT [state] FROM [dbo].[QuranWordByWord] WHERE [id]=N'${id}';`,
        );
        return row?.state;
      })
      .toBe('published');
    await page.goto(`/quran/surah/1/1?words=${slug.adminWordByWord}`);
    await expect(page.locator('[aria-labelledby="ayah-words"]')).toContainText(
      'NON_QURAN_FIXTURE_ADMIN_GLOSS_1_1',
    );
    const [ayah] = await sql.query<{ version: number }>(
      'SELECT [version] FROM [dbo].[Ayah] WHERE [surahNumber]=1 AND [ayahNumber]=2;',
    );
    expect(ayah?.version).toBe(1);

    // quran.read alone sees the glosses and no field to change them.
    await reader.goto(`/admin/quran/word-by-word/${id}?surah=1`);
    await expect(reader.getByRole('main')).toContainText(
      'NON_QURAN_FIXTURE_ADMIN_GLOSS_1_1',
    );
    await expect(reader.locator('input[name^="gloss-"]')).toHaveCount(0);
    // Withdrawn again, so the reader's later pages see only the fixture work.
    await page.goto(`/admin/quran/word-by-word/${id}`);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect
      .poll(async () => {
        const [row] = await sql.query<{ state: string }>(
          `SELECT [state] FROM [dbo].[QuranWordByWord] WHERE [id]=N'${id}';`,
        );
        return row?.state;
      })
      .toBe('archived');
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

/* ===========================================================================
 * Quran Part 8 — the Tafsir hub
 * ========================================================================= */

/**
 * THE TAFSIR HUB, over the fixture corpus: the fixture Tafsir's one entry
 * (1:1–3, Urdu), two public Library Works and a published Media Video that
 * carry Quran passages, and a DRAFT Video that carries one too (and must
 * never appear). Each owner's passages are seeded as that owner's own rows —
 * citation values, no key into Quran.
 *
 *   - the hub: the texts, the Surah grid (linked where something explains a
 *     Surah, quiet where nothing does), the books and the lectures, the find
 *     form without script, Urdu and Arabic right to left, 320px, axe;
 *   - a Surah's tafsir: whole-Surah resources first, each group with its ayat
 *     and its resources, a lecture opened at its start, the jump to an Ayah
 *     (placed, or said to have nothing yet), 404 outside the Quran;
 *   - the reader: a Tafsir action ONLY on an Ayah something explains, its
 *     sheet with script and a link without, the Ayah page's open section;
 *   - the lecture opened at its start, the book's and lecture's "On the
 *     Quran" links, and the search card's way to an Ayah's tafsir;
 *   - each editor adds, moves and removes a passage under its version.
 */
test.describe('Quran Part 8: the Tafsir hub', () => {
  const part8 = {
    wholeBook: randomUUID(),
    wholeEdition: randomUUID(),
    rangeBook: randomUUID(),
    rangeEdition: randomUUID(),
    lecture: randomUUID(),
    draftLecture: randomUUID(),
  };
  const part8Slug = {
    wholeBook: `fixture-tafsir-book-${run}`,
    rangeBook: `fixture-range-book-${run}`,
    lecture: `fixture-tafsir-lecture-${run}`,
    draftLecture: `fixture-draft-lecture-${run}`,
  };
  const TITLE = {
    wholeBook: `NON_QURAN_FIXTURE tafsir book ${run}`,
    rangeBook: `NON_QURAN_FIXTURE range book ${run}`,
    lecture: `NON_QURAN_FIXTURE tafsir lecture ${run}`,
    draftLecture: `NON_QURAN_FIXTURE draft lecture ${run}`,
  };
  let editor: Page;

  async function axe(page: Page, target: string, testInfo: TestInfo): Promise<void> {
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

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const work = (id: string, slugValue: string, title: string, edition: string) => `
      INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state]) VALUES (N'${id}', N'${slugValue}', N'en', N'published');
      INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES (N'${id}', N'en', ${n(title)}, N'');
      INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${id}', N'${ids.reciter}', N'author', 0);
      INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[publicationYear],[reading],[download],[version],[updatedAt]) VALUES
        (N'${edition}', N'${id}', N'ur', N'NON_QURAN_FIXTURE edition', N'published', 2020, N'unavailable', N'denied', 1, SYSUTCDATETIME());`;
    const video = (
      id: string,
      slugValue: string,
      title: string,
      state: string,
      key: string,
    ) => `
      INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[provider],[providerVideoId],[availability],[languageCode],[durationSeconds]) VALUES
        (N'${id}', N'${slugValue}', N'en', N'${state}', N'youtube', '${key}', N'available', N'ur', 3600);
      INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES (N'${id}', N'en', ${n(title)}, N'');
      INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${id}', N'${ids.reciter}', 0);`;
    await sql.query(`
      ${work(part8.wholeBook, part8Slug.wholeBook, TITLE.wholeBook, part8.wholeEdition)}
      ${work(part8.rangeBook, part8Slug.rangeBook, TITLE.rangeBook, part8.rangeEdition)}
      ${video(part8.lecture, part8Slug.lecture, TITLE.lecture, 'published', `L${run}`)}
      ${video(part8.draftLecture, part8Slug.draftLecture, TITLE.draftLecture, 'draft', `D${run}`)}
      INSERT INTO [dbo].[WorkQuranPassage] ([workId],[position],[surahNumber],[ayahFrom],[ayahTo]) VALUES
        (N'${part8.wholeBook}', 0, 1, 1, 7),
        (N'${part8.rangeBook}', 0, 2, 2, 3);
      INSERT INTO [dbo].[VideoQuranPassage] ([videoId],[position],[surahNumber],[ayahFrom],[ayahTo],[startSeconds]) VALUES
        (N'${part8.lecture}', 0, 2, 2, 2, 754),
        (N'${part8.draftLecture}', 0, 2, 2, 2, NULL);
    `);

    const context = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.249.1' },
    });
    contexts.push(context);
    editor = await context.newPage();
    const { email } = await registerAndSignIn(editor, 'quran-tafsir-editor');
    await grantRole(
      sql,
      await accountIdFor(sql, email),
      ['library.read', 'library.administer', 'media.read', 'media.administer'],
      'Quran Part 8 browser proof',
    );
  });

  test('the hub: texts, the Surah grid, books and lectures — never a draft — and the find form without script', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visitFixture(page, '/quran/tafsir');
    const main = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tafsir');

    // The public Tafsir text work, with what it covers.
    const texts = page.locator('section[aria-labelledby="tafsir-texts"]');
    await expect(texts.getByRole('link', { name: NAME.tafsir })).toHaveAttribute(
      'href',
      `/quran/tafsir/${slug.tafsir}`,
    );
    await expect(texts).toContainText('1 Surah · 1 entry');

    // The grid: Surahs 1 and 2 lead to their tafsir; Surah 3 has nothing yet.
    const grid = page.locator('ol[aria-labelledby="tafsir-surahs"]');
    await expect(grid.locator('li')).toHaveCount(114);
    await expect(grid.locator('a[href="/quran/tafsir/surah/1"]')).toContainText('1 text');
    await expect(grid.locator('a[href="/quran/tafsir/surah/1"]')).toContainText('1 book');
    await expect(grid.locator('a[href="/quran/tafsir/surah/2"]')).toContainText(
      '1 lecture',
    );
    await expect(grid.locator('a[href="/quran/tafsir/surah/3"]')).toHaveCount(0);
    await expect(grid.locator('li').nth(2)).toContainText('Nothing linked yet');

    // Books and lectures, shelved by Surah; the draft lecture is nowhere.
    const books = page.locator('section[aria-labelledby="tafsir-books"]');
    await expect(books.getByRole('link', { name: TITLE.wholeBook })).toHaveAttribute(
      'href',
      `/library/books/${part8Slug.wholeBook}`,
    );
    await expect(books).toContainText('1:1–7');
    const lectures = page.locator('section[aria-labelledby="tafsir-lectures"]');
    await expect(lectures.getByRole('link', { name: TITLE.lecture })).toHaveAttribute(
      'href',
      `/watch/videos/${part8Slug.lecture}?start=754`,
    );
    await expect(lectures).toContainText('from 12:34');
    await expect(main).not.toContainText(TITLE.draftLecture);
    await axe(page, '/quran/tafsir', testInfo);

    // Without script, the find form lands on the Ayah's place in its Surah.
    const plain = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(plain);
    const noScript = await plain.newPage();
    await noScript.goto('/quran/tafsir');
    await noScript.locator('select[name="surah"]').selectOption('2');
    await noScript.locator('input[name="ayah"]').first().fill('3');
    await noScript.getByRole('button', { name: 'Show tafsir' }).click();
    await noScript.waitForURL('**/quran/tafsir/surah/2#tafsir-2-3');
  });

  test('the hub and a Surah’s tafsir read right to left in Urdu and Arabic and fit 320px', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    for (const locale of ['ur', 'ar'] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await visitFixture(page, localizedPath(locale, '/quran/tafsir'), locale);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await axe(page, `/${locale}/quran/tafsir`, testInfo);
      await visitFixture(page, localizedPath(locale, '/quran/tafsir/surah/1'), locale);
      // The Urdu tafsir entry keeps its own language and direction.
      await expect(page.locator('div.tafsir-text[lang="ur"]')).toHaveAttribute(
        'dir',
        'rtl',
      );
      await axe(page, `/${locale}/quran/tafsir/surah/1`, testInfo);
    }
    for (const target of [
      '/quran/tafsir',
      '/ur/quran/tafsir',
      '/quran/tafsir/surah/2',
      '/ur/quran/tafsir/surah/1',
    ]) {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(target);
      const { overflow, offenders } = await overflowOf(page);
      expect(overflow, `${target}: ${offenders.join(', ')}`).toBeLessThanOrEqual(0);
    }
  });

  test('a Surah’s tafsir: the whole Surah first, each group with its ayat and resources, jumps and refusals', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visitFixture(page, '/quran/tafsir/surah/1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Tafsir of NON_QURAN_FIXTURE Surah One',
    );
    // The whole-Surah book first; the entry over 1:1–3 is a group with its ayat.
    const whole = page.locator('#tafsir-whole');
    await expect(whole.getByRole('link', { name: TITLE.wholeBook })).toBeVisible();
    const group = page.locator('section[aria-labelledby="tafsir-group-1"]');
    await expect(group.getByRole('heading', { level: 2 })).toHaveText('Ayat 1–3');
    await expect(group.locator('#tafsir-1-2 p[lang="ar"]')).toHaveText(
      canonicalText(1, 2),
    );
    await expect(group.locator('div.tafsir-text[lang="ur"]')).toContainText(
      'NON_QURAN_FIXTURE_TAFSIR_1_1',
    );
    // The mini-navigation names the whole Surah and the group.
    const nav = page.getByRole('navigation', { name: 'In this Surah' });
    await expect(nav.getByRole('link', { name: 'Whole Surah' })).toHaveAttribute(
      'href',
      '#tafsir-whole',
    );
    await expect(nav.getByRole('link', { name: '1–3' })).toHaveAttribute(
      'href',
      '#tafsir-1-1',
    );
    await axe(page, '/quran/tafsir/surah/1', testInfo);

    // Surah 2: the range book and the lecture, opened at its start.
    await visitFixture(page, '/quran/tafsir/surah/2');
    const range = page.locator('section[aria-labelledby="tafsir-group-2"]');
    await expect(range.getByRole('heading', { level: 2 })).toHaveText('Ayat 2–3');
    await expect(range.getByRole('link', { name: TITLE.rangeBook })).toBeVisible();
    await expect(range.getByRole('link', { name: TITLE.lecture })).toHaveAttribute(
      'href',
      `/watch/videos/${part8Slug.lecture}?start=754`,
    );
    await expect(page.getByRole('main')).not.toContainText(TITLE.draftLecture);

    // A jump to an Ayah something explains lands on it; one nothing explains says so.
    await page.goto('/quran/tafsir/surah/2?ayah=3');
    await page.waitForURL('**/quran/tafsir/surah/2#tafsir-2-3');
    await page.goto('/quran/tafsir/surah/2?ayah=4');
    await expect(page.getByRole('main')).toContainText(
      'Nothing is linked to Ayah 4 yet.',
    );
    await expect(page.getByRole('link', { name: 'Read Ayah 4' })).toHaveAttribute(
      'href',
      '/quran/surah/2/4',
    );
    // A Surah with nothing linked says so; outside the Quran is a 404.
    await visitFixture(page, '/quran/tafsir/surah/3');
    await expect(page.getByRole('main')).toContainText(
      'No tafsir is linked to this Surah yet.',
    );
    expect((await page.goto('/quran/tafsir/surah/115'))?.status()).toBe(404);
    expect((await page.goto('/quran/tafsir/surah/0'))?.status()).toBe(404);
  });

  test('the reader offers Tafsir only where something explains an Ayah — a sheet with script, a link without', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await visitFixture(page, '/quran/surah/2');
    await readerReady(page);
    const action = (ayah: number) =>
      page.locator(`#ayah-2-${String(ayah)} [data-ayah-action="tafsir"]`);
    await expect(action(1)).toHaveCount(0);
    await expect(action(3)).toHaveAttribute('aria-label', 'Tafsir (1)');
    await expect(action(4)).toHaveCount(0);
    await expect(action(2)).toHaveAttribute('aria-label', 'Tafsir (2)');
    await action(2).click();
    const sheet = page.getByRole('dialog', { name: 'Tafsir of 2:2' });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole('link', { name: new RegExp(TITLE.rangeBook) }),
    ).toHaveAttribute('href', `/library/books/${part8Slug.rangeBook}`);
    await expect(
      sheet.getByRole('link', { name: new RegExp(TITLE.lecture) }),
    ).toHaveAttribute('href', `/watch/videos/${part8Slug.lecture}?start=754`);
    await expect(sheet).not.toContainText(TITLE.draftLecture);
    await axe(page, '/quran/surah/2 (Tafsir sheet)', testInfo);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Surah 1: the Tafsir entry and the whole-Surah book explain each of its ayat.
    await visitFixture(page, '/quran/surah/1');
    await expect(page.locator('#ayah-1-1 [data-ayah-action="tafsir"]')).toHaveAttribute(
      'aria-label',
      'Tafsir (2)',
    );

    // Without script the action is a link to the Ayah's place in the hub.
    const plain = await browser.newContext({
      baseURL: baseUrl(),
      javaScriptEnabled: false,
    });
    contexts.push(plain);
    const noScript = await plain.newPage();
    await noScript.goto('/quran/surah/2');
    await noScript.locator('#ayah-2-2 [data-ayah-action="tafsir"]').click();
    await noScript.waitForURL('**/quran/tafsir/surah/2#tafsir-2-2');

    // The Ayah's own page lists it in the open.
    await visitFixture(page, '/quran/surah/2/2');
    const open = page.locator('#ayah-explained');
    await expect(open.getByRole('heading', { name: 'Tafsir of 2:2' })).toBeVisible();
    await expect(
      open.getByRole('link', { name: new RegExp(TITLE.lecture) }),
    ).toBeVisible();

    // In Urdu the action and its sheet read right to left, and fit 320px.
    await page.setViewportSize({ width: 320, height: 800 });
    await visitFixture(page, '/ur/quran/surah/2', 'ur');
    await readerReady(page);
    await page.locator('#ayah-2-2 [data-ayah-action="tafsir"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const { overflow, offenders } = await overflowOf(page);
    expect(overflow, offenders.join(', ')).toBeLessThanOrEqual(0);
    await axe(page, '/ur/quran/surah/2 (Tafsir sheet)', testInfo);
  });

  test('a lecture opens at its passage, a book and a lecture name the Quran they explain, and search leads to an Ayah’s tafsir', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(`/watch/videos/${part8Slug.lecture}?start=754`);
    await expect(page.getByRole('main')).toContainText('Opens at 12:34');
    const onQuran = page.locator('section[aria-labelledby="quran-passages"]');
    await expect(onQuran.getByRole('link', { name: /2:2/ })).toHaveAttribute(
      'href',
      '/quran/tafsir/surah/2?ayah=2',
    );
    // A start beyond the video is ignored, never passed on.
    await page.goto(`/watch/videos/${part8Slug.lecture}?start=4000`);
    await expect(page.getByRole('main')).not.toContainText('Opens at');

    await page.goto(`/library/books/${part8Slug.wholeBook}`);
    await expect(
      page
        .locator('section[aria-labelledby="quran-passages"]')
        .getByRole('link', { name: /1:1–7/ }),
    ).toHaveAttribute('href', '/quran/tafsir/surah/1?ayah=1');

    await page.goto(`/quran/search?q=${encodeURIComponent('surah 2:2')}`);
    await expect(
      page.getByRole('link', { name: 'Tafsir and lectures on this Ayah (2)' }),
    ).toHaveAttribute('href', '/quran/tafsir/surah/2?ayah=2');
  });

  test('each editor adds, moves and removes a passage under its version, refusing what is not a passage', async () => {
    test.setTimeout(180_000);
    const page = editor;
    // Library: the range book gains 2:4 alone, then moves it first.
    await page.goto(`/admin/library/works/${part8.rangeBook}`);
    const section = page.locator(
      `section[aria-labelledby="quran-passages-${part8.rangeBook}"]`,
    );
    await expect(section.getByText('2:2–3')).toBeVisible();
    await section.locator('select[name="surah"]').selectOption('2');
    await section.locator('input[name="ayahFrom"]').fill('4');
    await section.getByRole('button', { name: 'Add passage' }).click();
    const passages = section.locator('ol > li');
    await expect(passages).toHaveCount(2);
    await expect(passages.nth(1)).toContainText('2:4');
    await passages.nth(1).getByRole('button', { name: 'Move earlier' }).click();
    await expect(passages.nth(0)).toContainText('2:4');
    // A range beyond its Surah is refused with words, and nothing is added.
    await section.locator('select[name="surah"]').selectOption('1');
    await section.locator('input[name="ayahFrom"]').fill('1');
    await section.locator('input[name="ayahTo"]').fill('8');
    await section.getByRole('button', { name: 'Add passage' }).click();
    await expect(section).toContainText('Check the fields and try again.');
    await expect(passages).toHaveCount(2);
    const [work] = await sql.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[AuditLog] WHERE [targetId]=N'${part8.rangeBook}' AND [action] LIKE N'library.work.passages-%';`,
    );
    expect(Number(work?.total)).toBe(2);

    // Media: the lecture gains the whole of Surah 1 starting at 1:00, then loses it.
    await page.goto(`/admin/media/videos/${part8.lecture}`);
    const lecture = page.locator(
      `section[aria-labelledby="quran-passages-${part8.lecture}"]`,
    );
    await expect(lecture).toContainText('starts at 12:34');
    await lecture.locator('select[name="surah"]').selectOption('1');
    await lecture.locator('input[name="start"]').fill('1:00');
    await lecture.getByRole('button', { name: 'Add passage' }).click();
    const items = lecture.locator('ol > li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText('1:1–7');
    await expect(items.nth(1)).toContainText('starts at 1:00');
    await items.nth(1).getByRole('button', { name: 'Remove' }).click();
    await expect(items).toHaveCount(1);
    const [video] = await sql.query<{ total: number }>(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[AuditLog] WHERE [targetId]=N'${part8.lecture}' AND [action]=N'media.video.passages.changed';`,
    );
    expect(Number(video?.total)).toBe(2);
  });

  // TEMPORARY-PART8-SCREENSHOTS (removed after the evidence run)
  test('part 8 evidence screenshots', async ({ page }) => {
    const dir = process.env['PART8_SHOTS'];
    test.skip(dir === undefined, 'evidence only');
    test.setTimeout(240_000);
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
    ] as const)
      for (const locale of ['en', 'ur'] as const) {
        await page.setViewportSize({ width, height });
        const tag = `${locale}-${String(width)}`;
        await page.goto(localizedPath(locale, '/quran/tafsir'));
        await page.screenshot({ path: `${String(dir)}/hub-${tag}.png`, fullPage: true });
        await page.goto(localizedPath(locale, '/quran/tafsir/surah/2'));
        await page.screenshot({
          path: `${String(dir)}/surah-2-${tag}.png`,
          fullPage: true,
        });
        await page.goto(localizedPath(locale, '/quran/tafsir/surah/1'));
        await page.screenshot({
          path: `${String(dir)}/surah-1-${tag}.png`,
          fullPage: true,
        });
        await page.goto(localizedPath(locale, '/quran/surah/2'));
        await readerReady(page);
        await page.locator('#ayah-2-2 [data-ayah-action="tafsir"]').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${String(dir)}/reader-panel-${tag}.png` });
      }
  });
});
