import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext, Locator, Page, Response } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  PASSWORD,
  accountIdFor,
  baseUrl,
  enrolSecondFactorInBrowser,
  expect,
  grantRole,
  privilegedSession,
  registerAndSignIn,
  test,
  totpCodeFor,
  asTwoVisitors,
  knowledgeOf,
  firstDifference,
} from './support';

/**
 * Phase 19 — Hadith in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that while no collection is activated every
 * Hadith page says so honestly, or is absent, and nothing links a surface that
 * does not exist; that a fixture activation puts the fixture banner, `noindex`
 * and no canonical claim on every Hadith page; that a citation is read with its
 * original text marked `dir="rtl"` in every interface locale, its chain and
 * gradings exactly as sourced, and each translation and commentary entry in its
 * own labelled group; that a conflicted citation and a citation whose record
 * was corrected but not re-verified are absent everywhere, search included;
 * that a citation is reached by keyboard alone, reflows at 320 pixels and at
 * 200% zoom, and never moves; and that the administration separates reading,
 * layered work and the canonical changes — the last only behind its OWN
 * step-up purpose.
 *
 * ONE SERIAL FILE, BECAUSE ACTIVATION IS DATABASE-WIDE. The inactive proofs
 * must run before the activation, and the canonical proof maps a citation in
 * the collection this file activated — so they are one ordered journey.
 *
 * NOTHING HERE IS A HADITH. Every text, chain, grading, grader, reference and
 * evidence is a `NON_HADITH_FIXTURE_…` sentinel; the Arabic is the neutral
 * phrase "test text"; every source system is of `fixture` authority. The
 * owner-only rows — sources, editions, the canonical records, the activation —
 * are written on the MIGRATION connection, as the operator writes them, in an
 * order every trigger accepts.
 */

// NO RETRY. The journey activates the database's Hadith section, so a retry
// could only meet its own activation and refuse.
test.describe.configure({ mode: 'serial', retries: 0 });

let sql: SqlSession;
const contexts: BrowserContext[] = [];

const run = randomUUID().replaceAll('-', '').slice(0, 10);

/** Neutral Arabic: "test text". Never a narration. */
const ARABIC = 'نص اختبار';
/** Neutral Urdu: "test text". */
const URDU = 'آزمائشی متن';

/** A unique word the search proof looks for. */
const WORD = `hadfixture${run}`;

/** A reference with no break opportunity, as long as the column allows (64). */
const LONG_REFERENCE = `NON_HADITH_FIXTURE_REFERENCE_1_${'0'.repeat(33)}`;
/** A chain and a grading label with no break opportunity at all. */
const LONG_CHAIN = `NON_HADITH_FIXTURE_CHAIN_1_${'0'.repeat(300)}`;
const LONG_GRADING = `NON_HADITH_FIXTURE_GRADING_1_${'0'.repeat(200)}`;

const TEXT = {
  public: `NON_HADITH_FIXTURE_TEXT_1 ${WORD} ${ARABIC}`,
  conflictedMapped: `NON_HADITH_FIXTURE_TEXT_2 ${WORD} ${ARABIC}`,
  conflictedOther: `NON_HADITH_FIXTURE_TEXT_3 ${WORD} ${ARABIC}`,
  unverifiedBefore: `NON_HADITH_FIXTURE_TEXT_4 ${ARABIC}`,
  unverifiedAfter: `NON_HADITH_FIXTURE_TEXT_4 ${WORD} ${ARABIC}`,
  canonical: `NON_HADITH_FIXTURE_TEXT_5 ${ARABIC}`,
  translation: `NON_HADITH_FIXTURE_TRANSLATION_1 ${WORD}`,
  adminTranslation: `NON_HADITH_FIXTURE_TRANSLATION_2 ${run}`,
  commentary: `NON_HADITH_FIXTURE_COMMENTARY_1 ${URDU}`,
  science: `NON_HADITH_FIXTURE_SCIENCE_1 ${run}`,
} as const;

const GRADINGS = [
  {
    position: 0,
    grader: 'NON_HADITH_FIXTURE_GRADER_1',
    label: LONG_GRADING,
    labelLanguage: 'ar',
    reference: 'NON_HADITH_FIXTURE_REFERENCE_3',
  },
  {
    position: 1,
    grader: 'NON_HADITH_FIXTURE_GRADER_2',
    label: 'NON_HADITH_FIXTURE_GRADING_2',
    labelLanguage: 'en',
    reference: 'NON_HADITH_FIXTURE_REFERENCE_4',
  },
] as const;

const ids = {
  sourceA: randomUUID(),
  sourceB: randomUUID(),
  collection: randomUUID(),
  editionA: randomUUID(),
  editionB: randomUUID(),
  bookA: randomUUID(),
  bookB: randomUUID(),
  chapter: randomUUID(),
  /** Number 1 — public. */
  publicRecord: randomUUID(),
  /** Number 2 — mapped, then contradicted by another edition's candidate. */
  conflictedRecord: randomUUID(),
  conflictingRecord: randomUUID(),
  /** Number 3 — mapped at version 1, corrected to an unverified version 2. */
  unverifiedRecord: randomUUID(),
  /** Number 4 — unverified and unmapped, for the canonical proof. */
  canonicalRecord: randomUUID(),
  citation1: randomUUID(),
  citation2: randomUUID(),
  citation3: randomUUID(),
  translation: randomUUID(),
  commentary: randomUUID(),
  science: randomUUID(),
  topic: randomUUID(),
  /** HISTORICAL identifiers on the owner-written revisions; no foreign key. */
  operator: randomUUID(),
  grant: randomUUID(),
};

const slug = {
  collection: `fixture-collection-${run}`,
  bookA: `fixture-book-a-${run}`,
  bookB: `fixture-book-b-${run}`,
  chapter: `fixture-chapter-a-${run}`,
  commentary: `fixture-commentary-${run}`,
  science: `fixture-science-${run}`,
  topic: `fixture-topic-hadith-${run}`,
};

const NAME = {
  collection: `NON_HADITH_FIXTURE collection ${run}`,
  book: `NON_HADITH_FIXTURE book A ${run}`,
  chapter: `NON_HADITH_FIXTURE chapter A ${run}`,
  commentary: `NON_HADITH_FIXTURE commentary ${run}`,
  science: `NON_HADITH_FIXTURE science ${run}`,
  topic: `Non-scriptural fixture topic ${run}`,
  sourceA: `NON_HADITH_FIXTURE browser source A ${run}`,
  editionA: 'NON_HADITH_FIXTURE edition A',
};

const COLLECTION = `/hadith/${slug.collection}`;
const BOOK = `/hadith/collections/${slug.collection}/books/${slug.bookA}`;
const CHAPTER = `${BOOK}/chapters/${slug.chapter}`;
const citationName = (number: number) => `${NAME.collection} number ${String(number)}`;

const MESSAGES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'messages',
);

type UiLocale = 'en' | 'ur' | 'ar';
const LOCALES: readonly UiLocale[] = ['en', 'ur', 'ar'];

/** The shipped catalogue's Hadith copy in each interface locale. */
const COPY = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    (
      JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as {
        hadith: { fixture: string; unavailable: { body: string } };
      }
    ).hadith,
  ]),
) as Record<UiLocale, { fixture: string; unavailable: { body: string } }>;

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
 * No Hadith page links an Articles, Courses or Scholars view — none exists
 * (ROUTE_MAP.md §5.2), so a link to one would be a link to a 404.
 */
async function expectNoAbsentLinks(page: Page, where: string): Promise<void> {
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(
    hrefs.filter((href) => /\/hadith\/(articles|courses|scholars)\b/.test(href)),
    where,
  ).toEqual([]);
}

/**
 * Visits a public fixture-mode Hadith page and asserts what EVERY such page
 * owes: a 200 with no cookie, the fixture banner in the catalogue's own words,
 * `noindex`, no canonical or alternate claim, no structured data, and no link
 * to a surface that does not exist.
 */
async function visitFixture(
  page: Page,
  target: string,
  locale: UiLocale = 'en',
): Promise<Response> {
  const response = await page.goto(target);
  expect(response?.status(), target).toBe(200);
  expect(response?.headers()['set-cookie'], target).toBeUndefined();
  const banner = page.getByRole('note');
  await expect(banner, target).toHaveCount(1);
  await expect(banner, target).toHaveText(COPY[locale].fixture);
  await expect(page.locator('meta[name="robots"]'), target).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(page.locator('link[rel="canonical"]'), target).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][hreflang]'), target).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]'), target).toHaveCount(0);
  await expectNoAbsentLinks(page, target);
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

/** The focused element shows a visible focus indicator. */
async function expectVisibleFocus(target: Locator): Promise<void> {
  const focus = await target.evaluate((element) => {
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

const revisionColumns =
  '[hadithId],[version],[operation],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt]';

interface RecordRow {
  readonly id: string;
  readonly source: string;
  readonly edition: string;
  readonly reference: string;
  readonly number: number;
  readonly book: string;
  readonly chapter: string | null;
  readonly text: string;
  readonly chain: string | null;
}

const RECORDS: readonly RecordRow[] = [
  {
    id: ids.publicRecord,
    source: ids.sourceA,
    edition: ids.editionA,
    reference: LONG_REFERENCE,
    number: 1,
    book: ids.bookA,
    chapter: ids.chapter,
    text: TEXT.public,
    chain: LONG_CHAIN,
  },
  {
    id: ids.conflictedRecord,
    source: ids.sourceA,
    edition: ids.editionA,
    reference: 'NON_HADITH_FIXTURE_REFERENCE_5',
    number: 2,
    book: ids.bookA,
    chapter: null,
    text: TEXT.conflictedMapped,
    chain: null,
  },
  {
    id: ids.conflictingRecord,
    source: ids.sourceB,
    edition: ids.editionB,
    reference: 'NON_HADITH_FIXTURE_REFERENCE_5',
    number: 2,
    book: ids.bookB,
    chapter: null,
    text: TEXT.conflictedOther,
    chain: null,
  },
  {
    id: ids.unverifiedRecord,
    source: ids.sourceA,
    edition: ids.editionA,
    reference: 'NON_HADITH_FIXTURE_REFERENCE_6',
    number: 3,
    book: ids.bookA,
    chapter: ids.chapter,
    text: TEXT.unverifiedBefore,
    chain: null,
  },
  {
    id: ids.canonicalRecord,
    source: ids.sourceA,
    edition: ids.editionA,
    reference: 'NON_HADITH_FIXTURE_REFERENCE_8',
    number: 4,
    book: ids.bookA,
    chapter: null,
    text: TEXT.canonical,
    chain: null,
  },
];

const nullable = (value: string | null) => (value === null ? 'NULL' : n(value));

/**
 * The sources, the structure, five candidate records with their history, the
 * citations and the layered works — everything but the ACTIVATION. Until
 * `HadithActivation` has its row, the public Hadith section is inactive
 * whatever else exists, which is the first state this file proves.
 */
async function seedCorpus(): Promise<void> {
  await sql.query(`
    INSERT INTO [dbo].[HadithSourceSystem] ([id],[code],[authority],[title],[version],[encoding],[reference]) VALUES
      (N'${ids.sourceA}', N'NON_HADITH_FIXTURE_BROWSER_A_${run}', N'fixture', ${n(NAME.sourceA)}, N'fixture-1', N'utf-8', NULL),
      (N'${ids.sourceB}', N'NON_HADITH_FIXTURE_BROWSER_B_${run}', N'fixture', N'NON_HADITH_FIXTURE browser source B', N'fixture-2', N'utf-8', NULL);
    INSERT INTO [dbo].[HadithCollection] ([id],[slug],[position],[namesVersion]) VALUES
      (N'${ids.collection}', N'${slug.collection}', 0, 1);
    INSERT INTO [dbo].[HadithEdition] ([id],[collectionId],[sourceSystemId],[code],[title],[reference]) VALUES
      (N'${ids.editionA}', N'${ids.collection}', N'${ids.sourceA}', N'NON_HADITH_FIXTURE_EDITION_A', ${n(NAME.editionA)}, NULL),
      (N'${ids.editionB}', N'${ids.collection}', N'${ids.sourceB}', N'NON_HADITH_FIXTURE_EDITION_B', N'NON_HADITH_FIXTURE edition B', NULL);
    INSERT INTO [dbo].[HadithCollectionName] ([collectionId],[locale],[name],[description]) VALUES
      (N'${ids.collection}', N'en', ${n(NAME.collection)}, N'NON_HADITH_FIXTURE description');
    INSERT INTO [dbo].[HadithBook] ([id],[collectionId],[editionId],[slug],[reference],[position],[title],[titleLanguage]) VALUES
      (N'${ids.bookA}', N'${ids.collection}', N'${ids.editionA}', N'${slug.bookA}', N'NON_HADITH_FIXTURE_REFERENCE_9', 1, NULL, NULL),
      (N'${ids.bookB}', N'${ids.collection}', N'${ids.editionB}', N'${slug.bookB}', N'NON_HADITH_FIXTURE_REFERENCE_9', 1, NULL, NULL);
    INSERT INTO [dbo].[HadithChapter] ([id],[bookId],[slug],[reference],[position],[title],[titleLanguage]) VALUES
      (N'${ids.chapter}', N'${ids.bookA}', N'${slug.chapter}', N'NON_HADITH_FIXTURE_REFERENCE_10', 1, NULL, NULL);
    INSERT INTO [dbo].[HadithBookName] ([bookId],[locale],[name]) VALUES (N'${ids.bookA}', N'en', ${n(NAME.book)});
    INSERT INTO [dbo].[HadithChapterName] ([chapterId],[locale],[name]) VALUES (N'${ids.chapter}', N'en', ${n(NAME.chapter)});
  `);

  // ---- every candidate at version 1, its revision before its gradings -------
  const records = RECORDS.map(
    (r) =>
      `(N'${r.id}', N'${ids.collection}', N'${r.source}', N'${r.edition}', ${n(r.reference)}, ${String(r.number)}, N'${r.book}', ${nullable(r.chapter)}, ${n(r.text)}, N'ar', ${nullable(r.chain)}, ${r.chain === null ? 'NULL' : "N'ar'"}, 1)`,
  ).join(',\n');
  const revisions = RECORDS.map(
    (r) =>
      `(N'${r.id}', 1, N'created', ${n(r.reference)}, ${String(r.number)}, N'${r.book}', ${nullable(r.chapter)}, ${n(r.text)}, N'ar', ${nullable(r.chain)}, ${r.chain === null ? 'NULL' : "N'ar'"}, N'NON_HADITH_FIXTURE_EVIDENCE_1', NULL, N'${ids.operator}', N'${ids.grant}', SYSUTCDATETIME())`,
  ).join(',\n');
  const gradings = GRADINGS.map(
    (g) =>
      `(N'${ids.publicRecord}', 1, ${String(g.position)}, ${n(g.grader)}, ${n(g.label)}, N'${g.labelLanguage}', ${n(g.reference)})`,
  ).join(',\n');
  await sql.query(`
    INSERT INTO [dbo].[Hadith] ([id],[collectionId],[sourceSystemId],[editionId],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[version]) VALUES
      ${records};
    INSERT INTO [dbo].[HadithRevision] (${revisionColumns}) VALUES
      ${revisions};
    INSERT INTO [dbo].[HadithGrading] ([hadithId],[version],[position],[grader],[label],[labelLanguage],[reference]) VALUES
      ${gradings};
    INSERT INTO [dbo].[HadithVerification] ([id],[hadithId],[version],[evidence],[actorId],[stepUpGrantId]) VALUES
      (N'${randomUUID()}', N'${ids.publicRecord}', 1, N'NON_HADITH_FIXTURE_EVIDENCE_2', N'${ids.operator}', N'${ids.grant}'),
      (N'${randomUUID()}', N'${ids.conflictedRecord}', 1, N'NON_HADITH_FIXTURE_EVIDENCE_2', N'${ids.operator}', N'${ids.grant}'),
      (N'${randomUUID()}', N'${ids.unverifiedRecord}', 1, N'NON_HADITH_FIXTURE_EVIDENCE_2', N'${ids.operator}', N'${ids.grant}');
  `);

  // ---- three citations, each mapped while it is free of conflict evidence ---
  const citations = [
    [ids.citation1, 1, ids.publicRecord],
    [ids.citation2, 2, ids.conflictedRecord],
    [ids.citation3, 3, ids.unverifiedRecord],
  ] as const;
  await sql.query(`
    INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version]) VALUES
      ${citations.map(([id, number, record]) => `(N'${ids.collection}', ${String(number)}, N'${id}', N'${record}', N'mapped', 1)`).join(',')};
    INSERT INTO [dbo].[HadithCitationRevision] ([collectionId],[number],[version],[hadithId],[state],[evidence],[reason],[actorId],[stepUpGrantId]) VALUES
      ${citations.map(([, number, record]) => `(N'${ids.collection}', ${String(number)}, 1, N'${record}', N'mapped', N'NON_HADITH_FIXTURE_EVIDENCE_3', NULL, N'${ids.operator}', N'${ids.grant}')`).join(',')};
  `);

  // ---- number 2: the other edition's candidate disagrees in its text, and the
  // evidence is recorded exactly as the canonical write path records it -------
  await sql.query(`
    INSERT INTO [dbo].[HadithConflict] ([id],[collectionId],[citationNumber],[hadithId],[hadithVersion],[otherHadithId],[otherVersion],[facets]) VALUES
      (N'${randomUUID()}', N'${ids.collection}', 2, N'${ids.conflictingRecord}', 1, N'${ids.conflictedRecord}', 1, N'text');
  `);

  // ---- number 3: corrected to a version 2 nobody has verified — the revision
  // first, then the record moves to it, as the trigger requires --------------
  await sql.query(`
    INSERT INTO [dbo].[HadithRevision] (${revisionColumns}) VALUES
      (N'${ids.unverifiedRecord}', 2, N'corrected', N'NON_HADITH_FIXTURE_REFERENCE_6', 3, N'${ids.bookA}', N'${ids.chapter}', ${n(TEXT.unverifiedAfter)}, N'ar', NULL, NULL, N'NON_HADITH_FIXTURE_EVIDENCE_4', N'NON_HADITH_FIXTURE browser correction', N'${ids.operator}', N'${ids.grant}', SYSUTCDATETIME());
    UPDATE [dbo].[Hadith] SET [text]=${n(TEXT.unverifiedAfter)}, [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.unverifiedRecord}';
  `);
}

/**
 * The layered works — each PUBLISHED with a registered fixture source — and a
 * topic assigned to the public record AND to the two that are not public, so a
 * listing that showed either would show it here.
 */
async function seedWorks(): Promise<void> {
  await sql.query(`
    INSERT INTO [dbo].[HadithTranslation] ([id],[hadithId],[languageCode],[text],[attribution],[sourceSystemId],[state],[version],[updatedAt],[publishedAt]) VALUES
      (N'${ids.translation}', N'${ids.publicRecord}', N'en', ${n(TEXT.translation)}, N'NON_HADITH_FIXTURE attribution', N'${ids.sourceA}', N'published', 2, SYSUTCDATETIME(), SYSUTCDATETIME());

    INSERT INTO [dbo].[HadithCommentary] ([id],[slug],[languageCode],[name],[description],[attribution],[sourceSystemId],[state],[version],[updatedAt],[publishedAt]) VALUES
      (N'${ids.commentary}', N'${slug.commentary}', N'ur', ${n(NAME.commentary)}, NULL, NULL, NULL, N'draft', 1, SYSUTCDATETIME(), NULL);
    INSERT INTO [dbo].[HadithCommentaryEntry] ([commentaryId],[hadithId],[text]) VALUES
      (N'${ids.commentary}', N'${ids.publicRecord}', ${n(TEXT.commentary)});
    UPDATE [dbo].[HadithCommentary] SET [state]=N'published', [sourceSystemId]=N'${ids.sourceA}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.commentary}';

    INSERT INTO [dbo].[HadithScience] ([id],[slug],[position],[attribution],[sourceSystemId],[state],[version],[updatedAt],[publishedAt]) VALUES
      (N'${ids.science}', N'${slug.science}', 0, NULL, NULL, N'draft', 1, SYSUTCDATETIME(), NULL);
    INSERT INTO [dbo].[HadithScienceText] ([scienceId],[languageCode],[title],[body]) VALUES
      (N'${ids.science}', N'en', ${n(NAME.science)}, ${n(TEXT.science)});
    UPDATE [dbo].[HadithScience] SET [state]=N'published', [sourceSystemId]=N'${ids.sourceA}', [publishedAt]=SYSUTCDATETIME(), [version]=2, [updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${ids.science}';

    INSERT INTO [dbo].[Topic] ([id],[slug],[parentId],[position],[status],[system]) VALUES
      (N'${ids.topic}', N'${slug.topic}', NULL, 952, N'active', 0);
    INSERT INTO [dbo].[TopicTranslation] ([topicId],[locale],[name],[description]) VALUES
      (N'${ids.topic}', N'en', ${n(NAME.topic)}, NULL);
    INSERT INTO [dbo].[HadithTopic] ([hadithId],[topicId]) VALUES
      (N'${ids.publicRecord}', N'${ids.topic}'),
      (N'${ids.conflictedRecord}', N'${ids.topic}'),
      (N'${ids.unverifiedRecord}', N'${ids.topic}');
  `);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  sql = await privilegedSession();

  // ACTIVATION IS DATABASE-WIDE. A second attempt in the same run's database
  // finds the first attempt's rows and cannot re-prove the inactive state, so
  // it fails here, saying why, rather than later on a trigger refusal that
  // would look like a product defect.
  const existing = await scalar(
    'SELECT (SELECT COUNT_BIG(*) FROM [dbo].[Hadith]) + (SELECT COUNT_BIG(*) FROM [dbo].[HadithActivation]) + (SELECT COUNT_BIG(*) FROM [dbo].[HadithCollection]) AS [value];',
  );
  if (existing !== 0)
    throw new Error(
      'This run’s database already holds Hadith records or an activation; the Hadith journey can run once per database.',
    );

  await seedCorpus();
  await seedWorks();
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  await sql?.close();
});

/* ===========================================================================
 * 1. No collection is activated
 * ========================================================================= */

test.describe('while no collection is activated', () => {
  test('the landing says so honestly in every locale — no counts, no banner, no cookie', async ({
    page,
  }) => {
    for (const locale of LOCALES) {
      const response = await page.goto(`/${locale}/hadith`);
      expect(response?.status(), locale).toBe(200);
      expect(response?.headers()['set-cookie'], locale).toBeUndefined();
      await expect(page.getByText(COPY[locale].unavailable.body)).toBeVisible();
      await expect(page.getByRole('note')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

      // Nothing to enter: no section card, no number, no sample, no search —
      // only the way home.
      const main = page.getByRole('main');
      expect(await hrefsIn(page)).toContain(`/${locale}`);
      expect((await hrefsIn(page)).filter((href) => href.includes('/hadith'))).toEqual(
        [],
      );
      await expect(main).not.toContainText('NON_HADITH_FIXTURE');
      await expect(main).not.toContainText(/\d/);
      await expect(main.getByRole('search')).toHaveCount(0);
      await expectNoAbsentLinks(page, `/${locale}/hadith`);
    }

    // Hadith search, too, is honestly unavailable rather than an empty search.
    const search = await page.goto(`/en/hadith/search?q=${WORD}`);
    expect(search?.status()).toBe(200);
    expect(search?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByText(COPY.en.unavailable.body)).toBeVisible();
    await expect(page.getByRole('search')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.getByRole('main')).not.toContainText('NON_HADITH_FIXTURE');
  });

  test('every section page is unavailable, never an empty listing', async ({ page }) => {
    for (const section of [
      'introduction',
      'collections',
      'browse',
      'sciences',
      'commentary',
      'books',
      'videos',
      'research',
    ]) {
      const response = await page.goto(`/en/hadith/${section}`);
      expect(response?.status(), section).toBe(200);
      expect(response?.headers()['set-cookie'], section).toBeUndefined();
      await expect(page.getByText(COPY.en.unavailable.body), section).toBeVisible();
      await expect(page.getByRole('note'), section).toHaveCount(0);
      await expect(page.getByRole('main'), section).not.toContainText(
        'NON_HADITH_FIXTURE',
      );
      await expectNoAbsentLinks(page, section);
    }
  });

  test('a citation, a collection, its structure, a study page and a topic view are absent', async ({
    request,
  }) => {
    for (const missing of [
      `/en${COLLECTION}/1`,
      `/ur${COLLECTION}/1`,
      `/ar${COLLECTION}/1`,
      `/en/hadith/collections/${slug.collection}`,
      `/en/hadith/collections/${slug.collection}/books`,
      `/en${BOOK}`,
      `/en${CHAPTER}`,
      `/en/hadith/sciences/${slug.science}`,
      `/en/hadith/topics/${slug.topic}`,
      '/en/hadith/articles',
      '/en/hadith/courses',
      '/en/hadith/scholars',
    ]) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
      expect(response.headers()['set-cookie'], missing).toBeUndefined();
    }
  });
});

/* ===========================================================================
 * 2. A fixture collection is activated
 * ========================================================================= */

test.describe('a fixture activation', () => {
  test.beforeAll(async () => {
    // THE OPERATOR'S ACT, checked by the trigger against a mapped citation. The
    // search intents are owed from now on — written after the activation,
    // because the projection is empty while nothing is activated.
    await sql.query(`
      INSERT INTO [dbo].[HadithActivation] ([collectionId],[authority],[authorisedBy])
        VALUES (N'${ids.collection}', N'fixture', N'NON_HADITH_FIXTURE browser operator');
      INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES
        (N'hadith', N'${ids.citation1}'), (N'hadith', N'${ids.citation2}'), (N'hadith', N'${ids.citation3}');
    `);
  });

  test('every Hadith page carries the banner, noindex and no canonical claim', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const target of [
      '/en/hadith',
      '/en/hadith/introduction',
      '/en/hadith/collections',
      `/en/hadith/collections/${slug.collection}`,
      `/en/hadith/collections/${slug.collection}/books`,
      `/en${BOOK}`,
      `/en${CHAPTER}`,
      `/en${COLLECTION}/1`,
      '/en/hadith/browse',
      `/en/hadith/search?q=${encodeURIComponent(NAME.collection)}`,
      `/en/hadith/topics/${slug.topic}`,
      '/en/hadith/sciences',
      `/en/hadith/sciences/${slug.science}`,
      '/en/hadith/commentary',
      '/en/hadith/books',
      '/en/hadith/videos',
      '/en/hadith/research',
    ])
      await visitFixture(page, target);

    for (const locale of ['ur', 'ar'] as const) {
      for (const target of ['/hadith', `${COLLECTION}/1`, '/hadith/browse'])
        await visitFixture(page, `/${locale}${target}`, locale);
    }
  });

  test('the landing offers only what exists', async ({ page }) => {
    await visitFixture(page, '/en/hadith');
    await expect(page.getByText(COPY.en.unavailable.body)).toHaveCount(0);
    const hrefs = await hrefsIn(page);
    for (const section of [
      'collections',
      'browse',
      'introduction',
      'sciences',
      'commentary',
      'books',
      'videos',
      'research',
    ])
      expect(hrefs, section).toContain(`/en/hadith/${section}`);
    expect(hrefs).toContain(`/en/hadith/collections/${slug.collection}`);
    expect(hrefs).toContain('/en/topics/hadith');
    // No featured narration, no statistics.
    await expect(page.getByRole('main')).not.toContainText('NON_HADITH_FIXTURE_TEXT');
    await expect(page.getByRole('search')).toHaveCount(1);
  });

  test('a citation shows its original, chain and gradings exactly as sourced, in every locale', async ({
    page,
  }) => {
    for (const locale of LOCALES) {
      await visitFixture(page, `/${locale}${COLLECTION}/1`, locale);

      // The ORIGINAL, in its own labelled group, Arabic and right-to-left in
      // every interface locale.
      const original = page.locator('[aria-labelledby="hadith-original-text"] p[lang]');
      await expect(original).toHaveText(TEXT.public);
      await expect(original).toHaveAttribute('lang', 'ar');
      await expect(original).toHaveAttribute('dir', 'rtl');

      // The CHAIN, exactly as given, marked with its own language.
      const chain = page.locator('[aria-labelledby="hadith-chain-text"] p[lang]');
      await expect(chain).toHaveText(LONG_CHAIN);
      await expect(chain).toHaveAttribute('lang', 'ar');
      await expect(chain).toHaveAttribute('dir', 'rtl');

      // EACH GRADING exactly as given, with its grader and where it was
      // published — in source order, never ranked or coloured.
      const gradings = page.locator('ol[aria-labelledby="hadith-gradings"] > li');
      await expect(gradings).toHaveCount(GRADINGS.length);
      for (const [index, grading] of GRADINGS.entries()) {
        const row = gradings.nth(index);
        await expect(row).toContainText(grading.grader);
        await expect(row).toContainText(grading.reference);
        const label = row.locator(`span[lang="${grading.labelLanguage}"]`);
        await expect(label).toHaveText(grading.label);
        await expect(label).toHaveAttribute(
          'dir',
          grading.labelLanguage === 'ar' ? 'rtl' : 'ltr',
        );
      }

      // The source's own reference, beside the edition and source it came from.
      const facts = page.locator('section[aria-labelledby="hadith-facts"]');
      await expect(facts).toContainText(LONG_REFERENCE);
      await expect(facts).toContainText(NAME.editionA);
      await expect(facts).toContainText(NAME.sourceA);

      // THE TRANSLATION IS SEPARATE: its own section, its own language, and
      // never inside the original's.
      const translations = page.locator('section[aria-labelledby="hadith-translations"]');
      const translation = translations.locator('[role="group"] p[lang]');
      await expect(translation).toHaveText(TEXT.translation);
      await expect(translation).toHaveAttribute('lang', 'en');
      await expect(translation).toHaveAttribute('dir', 'ltr');
      const originalSection = page.locator('section[aria-labelledby="hadith-original"]');
      await expect(originalSection).not.toContainText('NON_HADITH_FIXTURE_TRANSLATION');
      await expect(translations).not.toContainText('NON_HADITH_FIXTURE_TEXT_1');

      // The commentary entry, a separate work in its own language.
      const commentary = page.locator(
        'section[aria-labelledby="hadith-commentary"] [role="group"] p[lang]',
      );
      await expect(commentary).toHaveText(TEXT.commentary);
      await expect(commentary).toHaveAttribute('lang', 'ur');
      await expect(commentary).toHaveAttribute('dir', 'rtl');
      await expect(
        page.locator('section[aria-labelledby="hadith-commentary"]'),
      ).toContainText(NAME.commentary);

      // No narrator link and no People link: the chain is text, nothing more.
      expect(
        (await hrefsIn(page)).filter((href) => /\/people\/|narrator/.test(href)),
      ).toEqual([]);
    }
  });

  test('the citation page is a heading outline a screen reader can walk', async ({
    page,
  }) => {
    await visitFixture(page, `/en${COLLECTION}/1`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(citationName(1));
    const outline = await page
      .locator('main article[aria-labelledby="hadith-heading"] :is(h2, h3)')
      .evaluateAll((headings) =>
        headings.map((heading) => `${heading.tagName}:${heading.textContent ?? ''}`),
      );
    expect(outline).toEqual([
      'H2:Original text',
      'H2:Citation details',
      'H2:Chain as given in the source',
      'H2:Gradings as given in the source',
      'H2:Translations',
      'H3:Translation · English',
      'H2:Commentary',
      `H3:${NAME.commentary}`,
      'H2:Topics',
    ]);
    // Each grading is a named article a screen reader can tell apart.
    await expect(
      page.getByRole('article', {
        name: 'Grading recorded by NON_HADITH_FIXTURE_GRADER_1',
      }),
    ).toBeVisible();
    // The topic links to the Hadith topic view.
    await expect(page.getByRole('link', { name: NAME.topic })).toHaveAttribute(
      'href',
      `/en/hadith/topics/${slug.topic}`,
    );
  });

  test('structure is read chapter → citation by keyboard alone, with a visible focus', async ({
    page,
  }) => {
    await visitFixture(page, `/en${CHAPTER}`);
    const list = page.getByRole('list', { name: 'Citations in this chapter' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    // The structural page links to the SHORT canonical citation, never a
    // deeper address of its own.
    const link = list.getByRole('link', { name: citationName(1) });
    await expect(link).toHaveAttribute('href', `/en${COLLECTION}/1`);
    // Number 3's record sits in this chapter too, but is not verified now.
    await expect(page.getByRole('main')).not.toContainText('NON_HADITH_FIXTURE_TEXT_4');

    await tabTo(page, link);
    await expectVisibleFocus(link);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/en${COLLECTION}/1$`));
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);

    const book = page
      .locator('section[aria-labelledby="hadith-facts"]')
      .getByRole('link', { name: NAME.book });
    await expect(book).toHaveAttribute('href', `/en${BOOK}`);
    await tabTo(page, book);
    await expectVisibleFocus(book);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/en${BOOK}$`));
    await expect(
      page
        .getByRole('list', { name: 'Chapters' })
        .getByRole('link', { name: NAME.chapter }),
    ).toHaveAttribute('href', `/en${CHAPTER}`);
  });

  test('a conflicted citation and an unverified correction are absent everywhere', async ({
    page,
    request,
  }) => {
    for (const number of [2, 3, 4]) {
      const response = await request.get(`/en${COLLECTION}/${String(number)}`, {
        maxRedirects: 0,
      });
      expect(response.status(), String(number)).toBe(404);
    }
    // The other edition's book holds only the conflicting candidate: absent.
    const otherBook = await request.get(
      `/en/hadith/collections/${slug.collection}/books/${slug.bookB}`,
      { maxRedirects: 0 },
    );
    expect(otherBook.status()).toBe(404);

    const notPublic = /NON_HADITH_FIXTURE_TEXT_[2345]/;
    for (const [target, label] of [
      ['/en/hadith/browse', 'Citations'],
      [`/en/hadith/topics/${slug.topic}`, NAME.topic],
    ] as const) {
      await visitFixture(page, target);
      const list = page.getByRole('list', { name: label, exact: true });
      await expect(list.getByRole('listitem'), target).toHaveCount(1);
      await expect(list.getByRole('link', { name: citationName(1) })).toHaveAttribute(
        'href',
        `/en${COLLECTION}/1`,
      );
      await expect(page.getByRole('main'), target).not.toContainText(notPublic);
      const hrefs = await hrefsIn(page);
      for (const number of [2, 3, 4])
        expect(hrefs, target).not.toContain(`/en${COLLECTION}/${String(number)}`);
    }

    // The book lists the citations placed in it and in NO chapter. Number 2's
    // record is the only chapterless one mapped, and it is conflicted: the
    // book offers its chapter and no citation list at all.
    await visitFixture(page, `/en${BOOK}`);
    await expect(page.getByRole('list', { name: 'Citations in this book' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('main')).not.toContainText(notPublic);
    const bookHrefs = await hrefsIn(page);
    expect(bookHrefs).toContain(`/en${CHAPTER}`);
    for (const number of [2, 3, 4])
      expect(bookHrefs).not.toContain(`/en${COLLECTION}/${String(number)}`);

    await visitFixture(page, `/en/hadith/collections/${slug.collection}/books`);
    const books = await hrefsIn(page);
    expect(books).toContain(`/en${BOOK}`);
    expect(books.some((href) => href.includes(slug.bookB))).toBe(false);

    // The topic hub composes the same single citation, under the banner.
    const hub = await page.goto(`/en/topics/${slug.topic}`);
    expect(hub?.status()).toBe(200);
    await expect(
      page.getByRole('note').filter({ hasText: COPY.en.fixture }),
    ).toBeVisible();
    const hubHrefs = await hrefsIn(page);
    expect(hubHrefs).toContain(`/en${COLLECTION}/1`);
    expect(hubHrefs).toContain(`/en/hadith/topics/${slug.topic}`);
    for (const number of [2, 3])
      expect(hubHrefs).not.toContain(`/en${COLLECTION}/${String(number)}`);
  });

  test('the study pages render the published fixture works', async ({ page }) => {
    await visitFixture(page, '/en/hadith/sciences');
    await page.getByRole('link', { name: NAME.science }).click();
    await page.waitForURL(`**/en/hadith/sciences/${slug.science}`);
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.science);
    await expect(page.getByRole('main')).toContainText(TEXT.science);

    await visitFixture(page, '/en/hadith/commentary');
    const work = page.getByRole('article', { name: NAME.commentary });
    await expect(work).toBeVisible();
    await expect(work).toContainText('1 entry');

    await visitFixture(page, '/en/hadith/collections');
    await expect(
      page.getByRole('list', { name: 'Collections' }).getByRole('listitem'),
    ).toHaveCount(1);
    await page.getByRole('link', { name: NAME.collection }).click();
    await page.waitForURL(`**/en/hadith/collections/${slug.collection}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.collection);
    await expect(
      page.locator('section[aria-labelledby="collection-sources"]'),
    ).toContainText(NAME.sourceA);
  });

  test('search finds the citation exactly once — on a page that is never indexed', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // DERIVED WORK: the running sweep indexes asynchronously, so the page is
    // polled — never slept on — until the citation appears. The polls are
    // spaced so they stay inside the search admission budget.
    await expect
      .poll(
        async () => {
          const response = await page.goto(
            `/en/hadith/search?q=${encodeURIComponent(WORD)}`,
          );
          expect(response?.status()).toBe(200);
          await page.getByRole('heading', { level: 1 }).waitFor();
          return page.getByRole('main').innerText();
        },
        { timeout: 120_000, intervals: [2_000, 3_000, 5_000] },
      )
      .toContain(citationName(1));

    expect(new URL(page.url()).pathname).toBe('/en/hadith/search');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

    // The original AND its English translation both carry the word, and the
    // conflicted and unverified citations carry it too: ONE result.
    const results = page.locator('ol[aria-labelledby="hadith-results"] > li');
    await expect(results).toHaveCount(1);
    await expect(
      page.locator('section[aria-labelledby="hadith-results"] p[role="status"]'),
    ).toContainText(`1 result for “${WORD}”`);
    const hit = page.getByRole('link', { name: citationName(1) });
    await expect(hit).toHaveCount(1);
    await expect(hit).toHaveAttribute('href', `/en${COLLECTION}/1`);
    const hrefs = await hrefsIn(page);
    for (const number of [2, 3, 4])
      expect(hrefs).not.toContain(`/en${COLLECTION}/${String(number)}`);
    await expect(page.getByRole('main')).not.toContainText(
      /NON_HADITH_FIXTURE_TEXT_[234]/,
    );

    // The matching text is labelled for what it is, in its own language — a
    // translation is never presented as the original.
    const group = results.first().getByRole('group');
    const text = group.locator('p[lang]');
    const language = await text.getAttribute('lang');
    if (language === 'en') {
      await expect(group).toContainText('Translation');
      await expect(text).toContainText(TEXT.translation);
      await expect(text).toHaveAttribute('dir', 'ltr');
    } else {
      expect(language).toBe('ar');
      await expect(group).toContainText('Original text');
      await expect(text).toContainText('NON_HADITH_FIXTURE_TEXT_1');
      await expect(text).toHaveAttribute('dir', 'rtl');
    }
  });

  test('a citation reflows at 320px and at 200% zoom in every locale, and nothing moves', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // 640 CSS pixels is a 1280-pixel window at 200% zoom.
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const target of [
        ...LOCALES.map((locale) => `/${locale}${COLLECTION}/1`),
        `/en${CHAPTER}`,
        '/ar/hadith/browse',
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(
          await overflowOf(page),
          `${String(width)}px ${target}`,
        ).toBeLessThanOrEqual(0);
      }
    }

    // NO MOTION ON SOURCED TEXT — first with no reduced-motion preference, so
    // a real animation or transition would show, then with one. Under
    // `reduce` the platform's global rule forces every duration to 0.01ms
    // (`globals.css`), which is no motion a person can perceive; nothing on
    // sourced text may exceed it.
    const ceiling = { 'no-preference': 0, reduce: 0.000_01 } as const;
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion });
      await page.goto(`/en${COLLECTION}/1`);
      const motion = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            'main [role="group"], main [role="group"] [lang], main ol[aria-labelledby="hadith-gradings"] *',
          ),
        ].map((element) => {
          const style = globalThis.getComputedStyle(element);
          return {
            animation: style.animationName,
            transition: style.transitionDuration,
          };
        }),
      );
      expect(motion.length, reducedMotion).toBeGreaterThan(6);
      for (const style of motion) {
        expect(style.animation, reducedMotion).toBe('none');
        for (const part of style.transition.split(', '))
          expect(
            Number.parseFloat(part),
            `${reducedMotion} ${style.transition}`,
          ).toBeLessThanOrEqual(ceiling[reducedMotion]);
      }
    }
  });
  test('a citation is one shared document signed in and out, its private island empty until hydrated', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    // Phase 21: the citation carries the personal island, and must still be
    // ONE shared document — a fresh reader and a fresh anonymous visitor, each
    // on a client address of their own.
    const target = `/en${COLLECTION}/1`;
    const anonymous = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.240.1' },
    });
    const signedIn = await browser.newContext({
      baseURL: baseUrl(),
      extraHTTPHeaders: { 'x-forwarded-for': '100.64.240.2' },
    });
    contexts.push(anonymous, signedIn);
    await registerAndSignIn(await signedIn.newPage(), 'hadith-island');

    const { anonymous: shared, signedIn: personal } = await asTwoVisitors(
      anonymous.request,
      signedIn.request,
      target,
    );
    expect(shared.status()).toBe(200);
    expect(personal.status()).toBe(200);
    expect(shared.headers()['set-cookie']).toBeUndefined();
    expect(personal.headers()['set-cookie']).toBeUndefined();
    const html = await shared.text();
    expect(html).toContain(TEXT.public);
    expect(
      firstDifference(knowledgeOf(html), knowledgeOf(await personal.text())),
      'the citation differs signed in',
    ).toBe('identical');
    expect(html).not.toContain('aria-pressed');

    // Signed out, once hydrated, the island offers sign-in back to this citation.
    const page = await anonymous.newPage();
    const state = page.waitForResponse((response) =>
      response.url().includes('/api/my/target-state'),
    );
    await page.goto(target);
    expect((await state).status()).toBe(200);
    const island = page.getByRole('region', { name: 'Save and notes' });
    await expect(island).toContainText(
      'Sign in to save this, keep a private note or add it to a collection.',
    );
    await expect(island.getByRole('link', { name: 'Sign in to save' })).toHaveAttribute(
      'href',
      `/en/signin?returnTo=${encodeURIComponent(target)}`,
    );
  });
});

/* ===========================================================================
 * 3. Administration
 * ========================================================================= */

test.describe('Hadith administration', () => {
  let nobody: Page;
  let reader: Page;
  let administrator: Page;
  let canonical: Page;
  let canonicalAccount: string;
  let canonicalTotp: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const accounts: [string, readonly string[]][] = [
      ['hadith-nobody', []],
      ['hadith-reader', ['hadith.read']],
      ['hadith-administer', ['hadith.read', 'hadith.administer']],
      ['hadith-canonical', ['hadith.read', 'hadith.editCanonical']],
    ];
    const pages: Page[] = [];
    for (const [index, [prefix, keys]] of accounts.entries()) {
      const context = await browser.newContext({
        baseURL: baseUrl(),
        extraHTTPHeaders: { 'x-forwarded-for': `100.64.249.${String(index + 1)}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      const { email } = await registerAndSignIn(page, prefix);
      const accountId = await accountIdFor(sql, email);
      if (keys.length > 0) await grantRole(sql, accountId, keys, 'Hadith browser proof');
      if (prefix === 'hadith-canonical') canonicalAccount = accountId;
      pages.push(page);
    }
    [nobody, reader, administrator, canonical] = pages as [Page, Page, Page, Page];

    // The canonical authority needs a COMPLETE privileged posture: a second
    // factor enrolled and its recovery codes confirmed, through the UI.
    canonicalTotp = (await enrolSecondFactorInBrowser(canonical)).totpUri;
  });

  test('an anonymous visitor is sent to sign in; an account without hadith.read is refused', async ({
    page,
  }) => {
    await page.goto(`/en/admin/hadith/records/${ids.publicRecord}`);
    await page.waitForURL(/\/en\/signin\?returnTo=/);

    for (const surface of [
      'records',
      `records/${ids.publicRecord}`,
      'collections',
      `collections/${ids.collection}`,
      'books',
      'commentary',
      'sciences',
    ]) {
      const response = await nobody.goto(`/en/admin/hadith/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('hadith.read reads records and their evidence, and is offered nothing to change', async () => {
    const list = await reader.goto('/en/admin/hadith/records');
    expect(list?.status()).toBe(200);
    const main = reader.getByRole('main');
    await expect(main.getByRole('link', { name: LONG_REFERENCE })).toHaveAttribute(
      'href',
      `/en/admin/hadith/records/${ids.publicRecord}`,
    );
    await expect(main.getByRole('heading', { name: 'New record' })).toHaveCount(0);

    // THE ADMINISTRATION IS NEVER CACHED OR INDEXED.
    for (const target of [
      '/en/admin/hadith/records',
      `/en/admin/hadith/records/${ids.publicRecord}`,
    ]) {
      const response = await reader.context().request.get(target);
      expect(response.status(), target).toBe(200);
      const cache = response.headers()['cache-control'] ?? '';
      expect(cache, target).toContain('private');
      expect(cache, target).toContain('no-store');
    }
    await expect(reader.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );

    const detail = await reader.goto(`/en/admin/hadith/records/${ids.publicRecord}`);
    expect(detail?.status()).toBe(200);
    await expect(reader.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(main).toContainText(TEXT.public);
    await expect(main).toContainText(LONG_CHAIN);
    await expect(main).toContainText('Read-only.');
    await expect(
      main.locator('section[aria-labelledby="record-gradings"]'),
    ).toContainText(LONG_GRADING);
    await expect(main.getByRole('heading', { name: 'Canonical changes' })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Add a translation' })).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(main.locator('textarea, input[type="checkbox"]')).toHaveCount(0);

    // Asking by address shows nothing either.
    for (const query of ['?canonical=1', '?translation=new']) {
      await reader.goto(`/en/admin/hadith/records/${ids.publicRecord}${query}`);
      await expect(main.getByRole('heading', { name: 'Canonical changes' })).toHaveCount(
        0,
      );
      await expect(main.getByRole('button')).toHaveCount(0);
      await expect(reader.locator('#verify-evidence')).toHaveCount(0);
      await expect(reader.locator('#new-translation-text')).toHaveCount(0);
    }

    // Conflict evidence is SHOWN to a reader, and nothing resolves it.
    await reader.goto(`/en/admin/hadith/records/${ids.conflictedRecord}`);
    const conflicts = main.locator('section[aria-labelledby="record-conflicts"]');
    await expect(conflicts).toContainText(
      'Records declaring the same citation number disagree.',
    );
    await expect(
      conflicts.getByRole('table', { name: 'Conflict evidence' }),
    ).toContainText('Text');
    await expect(main.getByRole('button')).toHaveCount(0);
  });

  test('hadith.administer adds a draft translation, and is offered no canonical change', async () => {
    const page = administrator;
    await page.goto(`/en/admin/hadith/records/${ids.publicRecord}`);
    await page.getByRole('link', { name: 'Add a translation' }).click();
    await page.waitForURL(/translation=new/);
    await page.locator('#new-translation-language').selectOption('en');
    await page.locator('#new-translation-text').fill(TEXT.adminTranslation);
    await page.locator('#new-translation-source').selectOption(ids.sourceA);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/translation=[0-9a-f-]{36}/);

    const [row] = await sql.query<{ state: string; languageCode: string }>(
      `SELECT [state],[languageCode] FROM [dbo].[HadithTranslation] WHERE [hadithId]=N'${ids.publicRecord}' AND [text]=${n(TEXT.adminTranslation)};`,
    );
    expect(row).toEqual({ state: 'draft', languageCode: 'en' });

    // A draft is not public: the citation still shows only the published one.
    const anonymous = await page.context().browser()?.newContext({ baseURL: baseUrl() });
    if (anonymous === undefined) throw new Error('No browser for the public check.');
    contexts.push(anonymous);
    const visitor = await anonymous.newPage();
    await visitor.goto(`/en${COLLECTION}/1`);
    await expect(visitor.getByRole('main')).toContainText(TEXT.translation);
    await expect(visitor.getByRole('main')).not.toContainText(TEXT.adminTranslation);

    // And the canonical record offers this account no control at all.
    for (const query of ['', '?canonical=1']) {
      await page.goto(`/en/admin/hadith/records/${ids.canonicalRecord}${query}`);
      await expect(
        page.getByRole('main').getByRole('heading', { name: 'Canonical changes' }),
      ).toHaveCount(0);
      await expect(page.locator('#verify-evidence')).toHaveCount(0);
      await expect(page.locator('#correct-record-evidence')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Verify this version' })).toHaveCount(
        0,
      );
    }
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[HadithVerification] WHERE [hadithId]=N'${ids.canonicalRecord}';`,
      ),
    ).toBe(0);
  });

  test('hadith.editCanonical verifies and maps only behind its own step-up', async () => {
    test.setTimeout(240_000);
    const page = canonical;
    const recordUrl = `/en/admin/hadith/records/${ids.canonicalRecord}?canonical=1`;
    const verifications = () =>
      sql.query<{ version: number; actorId: string; stepUpGrantId: string }>(
        `SELECT [version],[actorId],[stepUpGrantId] FROM [dbo].[HadithVerification] WHERE [hadithId]=N'${ids.canonicalRecord}';`,
      );
    const verify = async () => {
      await page.locator('#verify-evidence').fill('NON_HADITH_FIXTURE_EVIDENCE_5');
      await page.locator('#verify-confirm').check();
      await page.getByRole('button', { name: 'Verify this version' }).click();
    };
    const stepUp = async (purpose?: string) => {
      await page.locator('#step-up-password-hadith-canonical-edit').fill(PASSWORD);
      await page
        .locator('#step-up-code-hadith-canonical-edit')
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
    const refusal = 'Confirm it is you with the form above, then submit again.';

    // Entered on purpose, behind a warning, with the purpose's own prompt.
    await page.goto(`/en/admin/hadith/records/${ids.canonicalRecord}`);
    await page
      .locator('section[aria-labelledby="canonical"]')
      .getByRole('link', { name: 'Begin' })
      .click();
    await page.waitForURL(/canonical=1/);
    await expect(
      page.getByText('You are about to change sourced Hadith data.'),
    ).toBeVisible();
    await expect(
      page.getByText(
        'A confirmation earned for any other administrative change does not count here.',
      ),
    ).toBeVisible();
    // Unverified: nothing to map yet.
    await expect(
      page.getByText('Verify the current version first: only a verified record'),
    ).toBeVisible();

    // 1. WITHOUT ANY STEP-UP: refused, and nothing is recorded.
    await verify();
    await expect(page.getByText(refusal)).toBeVisible();
    expect(await verifications()).toEqual([]);

    // 2. A `quran-canonical-edit` grant — earned through the real step-up
    // action with only the purpose changed — does NOT unlock Hadith.
    await page.goto(recordUrl);
    await stepUp('quran-canonical-edit');
    const purposes = await sql.query<{ purpose: string }>(
      `SELECT [purpose] FROM [dbo].[StepUpGrant] WHERE [userId]=N'${canonicalAccount}';`,
    );
    expect(purposes.map((row) => row.purpose)).toEqual(['quran-canonical-edit']);
    await page.goto(recordUrl);
    await verify();
    await expect(page.getByText(refusal)).toBeVisible();
    expect(await verifications()).toEqual([]);

    // 3. With the `hadith-canonical-edit` step-up: the current version is
    // verified, by this account, under that grant.
    await page.goto(recordUrl);
    await stepUp();
    await page.goto(recordUrl);
    await verify();
    await expect(
      page.getByText('Version 1 has been verified by a person against its source.'),
    ).toBeVisible();
    const [verification] = await verifications();
    expect(verification?.version).toBe(1);
    expect(verification?.actorId).toBe(canonicalAccount);
    const [grant] = await sql.query<{ id: string; purpose: string }>(
      `SELECT [id],[purpose] FROM [dbo].[StepUpGrant] WHERE [id]=N'${verification?.stepUpGrantId ?? ''}';`,
    );
    expect(grant?.purpose).toBe('hadith-canonical-edit');

    // 4. Now verified, the citation can be mapped to it.
    await page.goto(recordUrl);
    await page.locator('#map-evidence').fill('NON_HADITH_FIXTURE_EVIDENCE_6');
    await page.locator('#map-confirm').check();
    await page.getByRole('button', { name: 'Map the citation to this record' }).click();
    await expect(page.getByText('The citation already names this record.')).toBeVisible();
    const [citation] = await sql.query<{
      hadithId: string;
      state: string;
      version: number;
    }>(
      `SELECT [hadithId],[state],[version] FROM [dbo].[HadithCitation] WHERE [collectionId]=N'${ids.collection}' AND [number]=4;`,
    );
    expect(citation).toEqual({
      hadithId: ids.canonicalRecord,
      state: 'mapped',
      version: 1,
    });
    const [revision] = await sql.query<{ actorId: string; evidence: string }>(
      `SELECT [actorId],[evidence] FROM [dbo].[HadithCitationRevision] WHERE [collectionId]=N'${ids.collection}' AND [number]=4 AND [version]=1;`,
    );
    expect(revision).toEqual({
      actorId: canonicalAccount,
      evidence: 'NON_HADITH_FIXTURE_EVIDENCE_6',
    });

    // The citation is public now, under the banner.
    await visitFixture(page, `/en${COLLECTION}/4`);
    await expect(
      page.locator('[aria-labelledby="hadith-original-text"] p[lang]'),
    ).toHaveText(TEXT.canonical);
    // And its book — where it sits in no chapter — now lists it, by its short
    // canonical address.
    await visitFixture(page, `/en${BOOK}`);
    const listed = page.getByRole('list', { name: 'Citations in this book' });
    await expect(listed.getByRole('listitem')).toHaveCount(1);
    await expect(listed.getByRole('link', { name: citationName(4) })).toHaveAttribute(
      'href',
      `/en${COLLECTION}/4`,
    );
  });

  test('conflict evidence is shown to the canonical editor, and nothing resolves it', async () => {
    const page = canonical;
    for (const record of [ids.conflictingRecord, ids.conflictedRecord]) {
      await page.goto(`/en/admin/hadith/records/${record}?canonical=1`);
      const main = page.getByRole('main');
      await expect(main.getByText('Citation blocked by conflict evidence')).toBeVisible();
      const conflicts = main.locator('section[aria-labelledby="record-conflicts"]');
      await expect(conflicts).toContainText(
        'Nothing on these screens resolves it or chooses a record.',
      );
      await expect(
        conflicts.getByRole('table', { name: 'Conflict evidence' }),
      ).toContainText('Text');
      await expect(main.locator('section[aria-labelledby="mapping"]')).toContainText(
        'Conflict evidence stands against this citation number',
      );
      await expect(
        main.getByRole('button', { name: 'Map the citation to this record' }),
      ).toHaveCount(0);
      await expect(main.getByRole('button', { name: /resolve|choose/i })).toHaveCount(0);
      await expect(main.getByRole('link', { name: /resolve/i })).toHaveCount(0);
    }
    // The evidence is unchanged and the citation still blocked.
    expect(
      await scalar(
        `SELECT COUNT_BIG(*) AS [value] FROM [dbo].[HadithConflict] WHERE [collectionId]=N'${ids.collection}' AND [citationNumber]=2;`,
      ),
    ).toBe(1);
    const blocked = await page.goto(`/en${COLLECTION}/2`);
    expect(blocked?.status()).toBe(404);
  });
});
