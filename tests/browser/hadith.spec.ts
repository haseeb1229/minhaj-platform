import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import type { BrowserContext, Locator, Page, Response, TestInfo } from '@playwright/test';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  PASSWORD,
  accountIdFor,
  baseUrl,
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
  firstDifference,
} from './support';

/**
 * Phase 19 — Hadith in a real browser, against the production build.
 *
 * WHAT ONLY A BROWSER CAN PROVE: that while no collection is activated every
 * Hadith page says so honestly, or is absent, and nothing links a surface that
 * does not exist — save the four hubs on the `hadith` Topic (Hadith Part 1),
 * which are other owners' material and stand without a corpus; that a fixture activation puts the fixture banner, `noindex`
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

interface HadithCopy {
  readonly fixture: string;
  readonly unavailable: {
    readonly body: string;
    readonly home: string;
    readonly structureHeading: string;
    readonly awaiting: string;
  };
  readonly works: { readonly awaiting: string };
}

/** The shipped catalogue's Hadith copy in each interface locale. */
const COPY = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    (
      JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), 'utf8')) as {
        hadith: HadithCopy;
      }
    ).hadith,
  ]),
) as Record<UiLocale, HadithCopy>;

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
 * No Hadith page links an Articles or Scholars view — none exists
 * (ROUTE_MAP.md §5.2), so a link to one would be a link to a 404. Books,
 * Videos, Research and Courses are the Hadith hubs since Hadith Part 1.
 */
async function expectNoAbsentLinks(page: Page, where: string): Promise<void> {
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(
    hrefs.filter((href) => /\/hadith\/(articles|scholars)\b/.test(href)),
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
  test('the landing presents MQI’s hadith works and says, once, that the collections await a source', async ({
    page,
  }) => {
    for (const locale of LOCALES) {
      const response = await page.goto(localizedPath(locale, '/hadith'));
      expect(response?.status(), locale).toBe(200);
      expect(response?.headers()['set-cookie'], locale).toBeUndefined();
      // R2 owner decision: no external hadith corpus. The landing is the
      // Library's hadith works (none are published in this suite's database,
      // so no shelf) and ONE calm sentence about the collections reader.
      await expect(page.getByText(COPY[locale].works.awaiting)).toBeVisible();
      await expect(page.getByText(COPY[locale].works.awaiting)).toHaveCount(1);
      await expect(page.getByRole('note')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

      // How the section is organised, in words: the collections and their
      // study each await an activated collection (two parts, never a link).
      const main = page.getByRole('main');
      await expect(
        main.getByRole('heading', { name: COPY[locale].unavailable.structureHeading }),
      ).toBeVisible();
      await expect(main.getByText(COPY[locale].unavailable.awaiting)).toHaveCount(2);

      // Nothing to enter of the collections: no section card, no number, no
      // sample, no search — the way home, and (Hadith Part 1) the four hubs,
      // which stand without a corpus, with the topic hub, and nothing else.
      await expect(
        main.getByRole('link', { name: COPY[locale].unavailable.home }),
      ).toHaveAttribute('href', localizedPath(locale, ''));
      expect(
        [
          ...new Set((await hrefsIn(page)).filter((href) => href.includes('/hadith'))),
        ].sort(),
      ).toEqual(
        [
          '/hadith/books',
          '/hadith/courses',
          '/hadith/research',
          '/hadith/videos',
          '/topics/hadith',
        ]
          .map((path) => localizedPath(locale, path))
          .sort(),
      );
      await expect(main).not.toContainText('NON_HADITH_FIXTURE');
      await expect(main).not.toContainText(/\d/);
      await expect(main.getByRole('search')).toHaveCount(0);
      await expectNoAbsentLinks(page, localizedPath(locale, '/hadith'));
    }

    // Hadith search, too, is honestly unavailable rather than an empty search.
    const search = await page.goto(`/hadith/search?q=${WORD}`);
    expect(search?.status()).toBe(200);
    expect(search?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByText(COPY.en.unavailable.body)).toBeVisible();
    await expect(page.getByRole('main').getByRole('search')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.getByRole('main')).not.toContainText('NON_HADITH_FIXTURE');
  });

  test('every section page of the collections is unavailable, never an empty listing', async ({
    page,
  }) => {
    // The four hubs are not among them: they are other owners' material on
    // the `hadith` Topic and stand without a corpus (Hadith Part 1, below).
    for (const section of [
      'introduction',
      'collections',
      'browse',
      'sciences',
      'commentary',
    ]) {
      const response = await page.goto(`/hadith/${section}`);
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
      `${COLLECTION}/1`,
      `/ur${COLLECTION}/1`,
      `/ar${COLLECTION}/1`,
      `/hadith/collections/${slug.collection}`,
      `/hadith/collections/${slug.collection}/books`,
      BOOK,
      CHAPTER,
      `/hadith/sciences/${slug.science}`,
      `/hadith/topics/${slug.topic}`,
      '/hadith/articles',
      '/hadith/scholars',
    ]) {
      const response = await request.get(missing, { maxRedirects: 0 });
      expect(response.status(), missing).toBe(404);
      expect(response.headers()['set-cookie'], missing).toBeUndefined();
    }
  });
});

/* ===========================================================================
 * 1b. Hadith Part 1 — the Hadith hubs, while no collection is activated
 * ========================================================================= */

/**
 * THE FOUR HUBS STAND WITHOUT A CORPUS. Books, Videos, Research and Courses on
 * Hadith are Library's, Media's and Learning's own public material on the
 * `hadith` Topic, composed at Layer 4 — nothing of Hadith's is read — so while
 * no collection is activated each is a working hub: no fixture banner, no
 * unavailable state, `noindex` and no canonical claim (the section's rule
 * while no approved activation exists). No hub offers a shelf, a Surah or a
 * reference order: there is no hadith reference model, and none is invented.
 *
 * Every figure is counted ON TOP of what other specs may have published on
 * the Topic in this run (the baseline), and the Courses this file publishes
 * are withdrawn when it is done, so no later spec meets them in Learn.
 */
test.describe('Hadith Part 1: the Hadith hubs', () => {
  const hub = {
    author: randomUUID(),
    speaker: randomUUID(),
    teacherOne: randomUUID(),
    teacherTwo: randomUUID(),
    series: randomUUID(),
    bookFeatured: randomUUID(),
    bookTranslated: randomUUID(),
    bookReadable: randomUUID(),
    bookDraft: randomUUID(),
    videoFeatured: randomUUID(),
    videoLecture: randomUUID(),
    videoShort: randomUUID(),
    videoDraft: randomUUID(),
    paper: randomUUID(),
    study: randomUUID(),
    researchDraft: randomUUID(),
    courseLive: randomUUID(),
    coursePaced: randomUUID(),
    courseAdvanced: randomUUID(),
    courseUnstated: randomUUID(),
    courseDraft: randomUUID(),
    path: randomUUID(),
  };
  const hubSlug = (key: string) => `fixture-hadith-hub-${key}-${run}`;
  const TITLE = {
    author: `Fixture Hadith Hub Author ${run}`,
    speaker: `Fixture Hadith Hub Speaker ${run}`,
    teacherOne: `Fixture Hadith Hub Teacher One ${run}`,
    teacherTwo: `Fixture Hadith Hub Teacher Two ${run}`,
    series: `NON_HADITH_FIXTURE hub circle ${run}`,
    bookFeatured: `NON_HADITH_FIXTURE hub book featured ${run}`,
    bookTranslated: `NON_HADITH_FIXTURE hub book translated ${run}`,
    bookReadable: `NON_HADITH_FIXTURE hub book readable ${run}`,
    bookDraft: `NON_HADITH_FIXTURE hub book draft ${run}`,
    videoFeatured: `NON_HADITH_FIXTURE hub video featured ${run}`,
    videoLecture: `NON_HADITH_FIXTURE hub video lecture ${run}`,
    videoShort: `NON_HADITH_FIXTURE hub video short ${run}`,
    videoDraft: `NON_HADITH_FIXTURE hub video draft ${run}`,
    paper: `NON_HADITH_FIXTURE hub research paper ${run}`,
    study: `NON_HADITH_FIXTURE hub research study ${run}`,
    researchDraft: `NON_HADITH_FIXTURE hub research draft ${run}`,
    courseLive: `NON_HADITH_FIXTURE hub course live ${run}`,
    courseLiveUrdu: `حدیث کا آزمائشی کورس ${run}`,
    coursePaced: `NON_HADITH_FIXTURE hub course self-paced ${run}`,
    courseAdvanced: `NON_HADITH_FIXTURE hub course advanced ${run}`,
    courseUnstated: `NON_HADITH_FIXTURE hub course unstated ${run}`,
    courseDraft: `NON_HADITH_FIXTURE hub course draft ${run}`,
    path: `NON_HADITH_FIXTURE hub path ${run}`,
  } as const;
  /** A YouTube-shaped identifier, unique to this run. */
  const providerKey = (prefix: string) => `${prefix}${run}`.padEnd(11, '0').slice(0, 11);
  const ABSTRACT = 'حدیث کے تحقیقی خلاصے کی آزمائشی عبارت '.repeat(12).trim();

  /** What other specs had published on the `hadith` Topic before this describe. */
  const base = { works: 0, videos: 0, records: 0, courses: 0 };
  let hadithTopic = '';

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

  /** The document's sideways overflow and, when there is some, what causes it. */
  function overflowDetail(
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
        (element) =>
          !beyond.some((other) => other !== element && element.contains(other)),
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

  /**
   * Visits a hub while no collection is activated and asserts what each owes:
   * a 200 with no cookie, the hub itself — never the unavailable state — no
   * fixture banner, `noindex` and no canonical, alternate or structured-data
   * claim, and no link to a surface that does not exist.
   */
  async function visitHub(page: Page, target: string): Promise<Response> {
    const response = await page.goto(target);
    expect(response?.status(), target).toBe(200);
    expect(response?.headers()['set-cookie'], target).toBeUndefined();
    await expect(page.getByRole('note'), target).toHaveCount(0);
    await expect(page.getByText(COPY.en.unavailable.body), target).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]'), target).toHaveAttribute(
      'content',
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]'), target).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][hreflang]'), target).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]'), target).toHaveCount(
      0,
    );
    await expectNoAbsentLinks(page, target);
    return response as Response;
  }

  /** The path and query of the page's address. */
  const here = (page: Page) => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  };

  /** One item of a hub's listing, by its title link. */
  const item = (page: Page, list: string, title: string) =>
    page
      .getByRole('main')
      .getByRole('list', { name: list, exact: true })
      .locator('li', { has: page.getByRole('link', { name: title, exact: true }) });

  test.beforeAll(async () => {
    const [topic] = await sql.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = N'hadith' AND [status] = N'active';`,
    );
    if (topic === undefined) throw new Error('The seeded hadith Topic is missing.');
    hadithTopic = topic.id;
    const [row] = await sql.query<Record<string, number | null>>(`
      SELECT
        (SELECT COUNT(*) FROM [dbo].[Work] w WHERE w.[state] = N'published'
          AND EXISTS (SELECT 1 FROM [dbo].[WorkTopic] o WHERE o.[workId] = w.[id] AND o.[topicId] = N'${hadithTopic}')
          AND EXISTS (SELECT 1 FROM [dbo].[Edition] e WHERE e.[workId] = w.[id] AND e.[state] = N'published')) AS [works],
        (SELECT COUNT(*) FROM [dbo].[Video] v WHERE v.[state] = N'published'
          AND EXISTS (SELECT 1 FROM [dbo].[VideoTopic] o WHERE o.[videoId] = v.[id] AND o.[topicId] = N'${hadithTopic}')) AS [videos],
        (SELECT COUNT(*) FROM [dbo].[Research] r WHERE r.[state] = N'published'
          AND EXISTS (SELECT 1 FROM [dbo].[ResearchTopic] o WHERE o.[researchId] = r.[id] AND o.[topicId] = N'${hadithTopic}'))
        + (SELECT COUNT(*) FROM [dbo].[ResearchPaper] r WHERE r.[state] = N'published'
          AND EXISTS (SELECT 1 FROM [dbo].[ResearchPaperTopic] o WHERE o.[researchPaperId] = r.[id] AND o.[topicId] = N'${hadithTopic}')) AS [records],
        (SELECT COUNT(*) FROM [dbo].[Course] c WHERE c.[state] = N'published'
          AND EXISTS (SELECT 1 FROM [dbo].[CourseTopic] o WHERE o.[courseId] = c.[id] AND o.[topicId] = N'${hadithTopic}')) AS [courses];`);
    base.works = Number(row?.['works'] ?? 0);
    base.videos = Number(row?.['videos'] ?? 0);
    base.records = Number(row?.['records'] ?? 0);
    base.courses = Number(row?.['courses'] ?? 0);
  });

  test('the inactive landing links the four hubs, which stand without a corpus', async ({
    page,
  }) => {
    await page.goto('/hadith');
    const structure = page.locator('section[aria-labelledby="hadith-structure"]');
    for (const [name, href] of [
      ['Books on Hadith', '/hadith/books'],
      ['Videos on Hadith', '/hadith/videos'],
      ['Research on Hadith', '/hadith/research'],
      ['Courses on Hadith', '/hadith/courses'],
    ] as const)
      await expect(structure.getByRole('link', { name, exact: true })).toHaveAttribute(
        'href',
        href,
      );
    for (const target of [
      '/hadith/books',
      '/hadith/videos',
      '/hadith/research',
      '/hadith/courses',
    ])
      await visitHub(page, target);
  });

  test('before anything on Hadith is published: each hub’s honest empty state, with the way to its owner', async ({
    page,
  }) => {
    for (const [target, count, title, empty, owner, ownerHref, form] of [
      [
        '/hadith/books',
        base.works,
        'Books on Hadith',
        'No books on Hadith yet',
        'All books in the Library',
        '/library/books',
        'Filter the books',
      ],
      [
        '/hadith/videos',
        base.videos,
        'Videos on Hadith',
        'No videos on Hadith yet',
        'All videos in Watch',
        '/watch/videos',
        'Filter the videos',
      ],
      [
        '/hadith/research',
        base.records,
        'Research on Hadith',
        'No research on Hadith yet',
        'All research in the Library',
        '/library/research',
        'Filter the research',
      ],
      [
        '/hadith/courses',
        base.courses,
        'Courses on Hadith',
        'No courses on Hadith yet',
        'All courses in Learn',
        '/learn/courses',
        'Filter the courses',
      ],
    ] as const) {
      if (count > 0) {
        test.info().annotations.push({
          type: 'skip',
          description: `${target}: another spec published on the hadith Topic first, so its empty state cannot exist here.`,
        });
        continue;
      }
      await visitHub(page, target);
      const main = page.getByRole('main');
      await expect(page.getByRole('heading', { level: 1 }), target).toHaveText(title);
      await expect(main.getByText(empty), target).toBeVisible();
      await expect(
        main.getByRole('link', { name: owner }).first(),
        target,
      ).toHaveAttribute('href', ownerHref);
      await expect(main.getByRole('form', { name: form }), target).toHaveCount(0);
      // No figure is claimed of nothing: no count links into an empty list.
      await expect(main.locator('a[href^="#"]'), target).toHaveCount(0);
    }
  });

  /* ---- Books ---------------------------------------------------------- */

  test.describe('the Books hub', () => {
    const LIST = 'Books on Hadith';
    const FILLERS = 22;

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      const work = (
        id: string,
        key: string,
        title: string,
        state: string,
        featured: boolean,
      ) => `
        INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state],[isFeatured]) VALUES (N'${id}', N'${hubSlug(key)}', N'en', N'${state}', ${featured ? 1 : 0});
        INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES (N'${id}', N'en', ${n(title)}, N'NON_HADITH_FIXTURE description of a book on Hadith.');
        INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${id}', N'${hadithTopic}');`;
      const edition = (
        workId: string,
        language: string,
        year: number,
        readable: boolean,
      ) => `
        INSERT INTO [dbo].[Edition] ([id],[workId],[languageCode],[label],[state],[publicationYear],[reading],[download],[document],[contentVersion],[version],[updatedAt]) VALUES
          (N'${randomUUID()}', N'${workId}', N'${language}', N'NON_HADITH_FIXTURE edition', N'published', ${String(year)},
           N'${readable ? 'allowed' : 'unavailable'}', N'denied', ${readable ? `N'{}'` : 'NULL'}, ${readable ? `N'${'c'.repeat(64)}'` : 'NULL'}, 1, SYSUTCDATETIME());`;
      const fillers = Array.from({ length: FILLERS }, (_, index) => {
        const id = randomUUID();
        const number = String(index + 1).padStart(2, '0');
        return `
          INSERT INTO [dbo].[Work] ([id],[slug],[primaryLocale],[state]) VALUES (N'${id}', N'${hubSlug(`book-filler-${number}`)}', N'en', N'published');
          INSERT INTO [dbo].[WorkLabel] ([workId],[locale],[title],[description]) VALUES
            (N'${id}', N'en', N'Zz NON_HADITH_FIXTURE hub book filler ${run} ${number}', N''),
            (N'${id}', N'ur', N'ےے NON_HADITH_FIXTURE ${run} ${number}', N'');
          INSERT INTO [dbo].[WorkTopic] ([workId],[topicId]) VALUES (N'${id}', N'${hadithTopic}');
          ${edition(id, 'en', 2000, false)}`;
      }).join('\n');
      await sql.query(`
        INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${hub.author}', N'${hubSlug('author')}', N'en', N'published');
        INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (N'${hub.author}', N'en', ${n(TITLE.author)}, NULL);

        ${work(hub.bookFeatured, 'book-featured', TITLE.bookFeatured, 'published', true)}
        ${edition(hub.bookFeatured, 'en', 2018, false)}
        INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${hub.bookFeatured}', N'${hub.author}', N'author', 0);

        ${work(hub.bookTranslated, 'book-translated', TITLE.bookTranslated, 'published', false)}
        ${edition(hub.bookTranslated, 'ar', 2022, false)}
        INSERT INTO [dbo].[WorkContributor] ([workId],[personId],[role],[position]) VALUES (N'${hub.bookTranslated}', N'${hub.author}', N'translator', 0);

        ${work(hub.bookReadable, 'book-readable', TITLE.bookReadable, 'published', false)}
        ${edition(hub.bookReadable, 'ur', 2010, true)}

        ${work(hub.bookDraft, 'book-draft', TITLE.bookDraft, 'draft', true)}
        ${edition(hub.bookDraft, 'en', 2019, false)}

        ${fillers}
      `);
    });

    test('the hub: its figures, featured books, cards and pages — never a draft, never a passage part', async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await visitHub(page, '/hadith/books');
      const main = page.getByRole('main');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(LIST);
      await expect(
        main.getByRole('link', { name: `${String(base.works + 25)} books on Hadith` }),
      ).toHaveAttribute('href', '#hadith-books-list');
      // The ways onward: the other hubs.
      for (const [name, href] of [
        ['Videos on Hadith', '/hadith/videos'],
        ['Research on Hadith', '/hadith/research'],
        ['Courses on Hadith', '/hadith/courses'],
      ] as const)
        await expect(
          main.getByRole('link', { name, exact: true }).first(),
        ).toHaveAttribute('href', href);
      await expect(
        page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', {
          name: 'Hadith',
        }),
      ).toHaveAttribute('href', '/hadith');

      // The editor's featured book opens the hub; the featured DRAFT is nowhere.
      const featured = page.locator('section[aria-labelledby="hadith-books-featured"]');
      await expect(
        featured.getByRole('link', { name: TITLE.bookFeatured, exact: true }),
      ).toHaveAttribute('href', `/library/books/${hubSlug('book-featured')}`);
      await expect(featured).toContainText('NON_HADITH_FIXTURE description');
      await expect(main).not.toContainText(TITLE.bookDraft);

      // No shelf, no Surah, no Quran order: Hadith has no passage parts.
      await expect(page.getByRole('navigation', { name: 'Shelves' })).toHaveCount(0);
      await expect(page.getByLabel('Surah', { exact: true })).toHaveCount(0);
      await expect(
        page.getByLabel('Order', { exact: true }).locator('option'),
      ).toHaveText(['Title, A–Z', 'Newest first']);

      // A card: title, credit with its role, language and year — one link each.
      const translated = item(page, LIST, TITLE.bookTranslated);
      await expect(translated).toContainText(`${TITLE.author} (translator)`);
      await expect(translated).toContainText('Arabic · 2022');
      await expect(translated.getByRole('link')).toHaveCount(1);
      await expect(item(page, LIST, TITLE.bookReadable)).toContainText('Read online');

      // A page of 24, said in words, and a second page.
      const list = main.getByRole('list', { name: LIST, exact: true });
      await expect(list.locator(':scope > li')).toHaveCount(24);
      await expect(main.getByText(/^1–24 of \d+ books$/)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-books-en-1440.png'),
        fullPage: true,
      });
      await axe(page, '/hadith/books', testInfo);

      await page
        .getByRole('navigation', { name: 'Pages of books' })
        .getByRole('link', { name: 'Next page' })
        .click();
      await page.waitForURL('**/hadith/books?page=2');
      await expect(main.getByText(/^25–\d+ of \d+ books$/)).toBeVisible();
      await expect(
        page.locator('section[aria-labelledby="hadith-books-featured"]'),
      ).toHaveCount(0);

      // A book's page is reached by keyboard alone, with a visible focus.
      await page.goto('/hadith/books');
      const link = item(page, LIST, TITLE.bookTranslated).getByRole('link', {
        name: TITLE.bookTranslated,
      });
      await tabTo(page, link);
      await expectVisibleFocus(link);
      await page.keyboard.press('Enter');
      await page.waitForURL(`**/library/books/${hubSlug('book-translated')}`);
    });

    test('filters and orders are addresses that work without script — chips, reset and honest empty states', async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const plain = await browser.newContext({
        baseURL: baseUrl(),
        javaScriptEnabled: false,
      });
      contexts.push(plain);
      const page = await plain.newPage();
      await page.goto('/hadith/books');
      const form = page.getByRole('form', { name: 'Filter the books' });

      // By author: exactly this author's two books, as a removable chip.
      await form.getByLabel('Author', { exact: true }).selectOption(hub.author);
      await form.getByRole('button', { name: 'Show books' }).click();
      await page.waitForURL(`**/hadith/books?contributor=${hub.author}`);
      const list = page.getByRole('list', { name: LIST, exact: true });
      await expect(list.locator(':scope > li')).toHaveCount(2);
      await expect(
        page
          .getByRole('list', { name: 'Filters in use' })
          .getByRole('link', { name: `Remove filter: ${TITLE.author}` }),
      ).toHaveAttribute('href', '/hadith/books');

      // A published Edition's language; the newest first.
      await page.goto('/hadith/books?language=ur');
      await expect(item(page, LIST, TITLE.bookReadable)).toHaveCount(1);
      await expect(item(page, LIST, TITLE.bookTranslated)).toHaveCount(0);
      await page.goto(`/hadith/books?contributor=${hub.author}&sort=newest`);
      await expect(page.getByLabel('Order', { exact: true })).toHaveValue('newest');
      await expect(list.locator(':scope > li h3')).toHaveText([
        TITLE.bookTranslated,
        TITLE.bookFeatured,
      ]);

      // Nothing matches: said, with the way back, and no pager.
      await page.goto(`/hadith/books?contributor=${hub.speaker}`);
      await expect(page.getByText('No books match these filters')).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Clear filters' }).first(),
      ).toHaveAttribute('href', '/hadith/books');
      await expect(page.getByRole('navigation', { name: 'Pages of books' })).toHaveCount(
        0,
      );

      // Past the last page: said, with the first page offered.
      await page.goto('/hadith/books?page=900');
      await expect(page.getByText('This page is empty')).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Go to the first page' }),
      ).toHaveAttribute('href', '/hadith/books');

      // A passage part, anything malformed or another spelling is ONE redirect.
      for (const target of [
        '/hadith/books?shelf=explains',
        '/hadith/books?surah=2',
        '/hadith/books?sort=quran',
        '/hadith/books?contributor=nobody',
        "/hadith/books?language=x'y",
        '/hadith/books?page=-1',
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(here(page), target).toBe('/hadith/books');
        await expect(page.getByRole('heading', { level: 1 }), target).toHaveText(LIST);
      }
      await page.goto('/hadith/books?sort=newest&surah=&language=ur&contributor=');
      expect(here(page)).toBe('/hadith/books?language=ur&sort=newest');
    });

    test('Urdu and Arabic read right to left, fit 320 and 390 px, and have no serious accessibility finding', async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await visitHub(page, localizedPath('ur', '/hadith/books'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('حدیث پر کتابیں');
      await expect(
        page.getByRole('heading', { name: TITLE.bookTranslated, exact: true }),
      ).toHaveAttribute('lang', 'en');
      const { overflow, offenders } = await overflowDetail(page);
      expect(overflow, offenders.join(', ')).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-books-ur-390.png'),
        fullPage: true,
      });
      await axe(page, '/ur/hadith/books', testInfo);
      await visitHub(page, localizedPath('ar', '/hadith/books'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await axe(page, '/ar/hadith/books', testInfo);
      for (const width of [320, 390, 768, 1440])
        for (const target of [
          '/hadith/books',
          '/ur/hadith/books',
          '/ar/hadith/books',
          `/hadith/books?contributor=${hub.author}`,
          '/hadith/books?page=900',
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(target);
          const result = await overflowDetail(page);
          expect(
            result.overflow,
            `${target} @${String(width)}: ${result.offenders.join(', ')}`,
          ).toBeLessThanOrEqual(0);
        }
    });
  });

  /* ---- Videos --------------------------------------------------------- */

  test.describe('the Videos hub', () => {
    const LIST = 'Videos on Hadith';
    const FILLERS = 22;

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      const video = (
        id: string,
        key: string,
        title: string,
        fields: {
          readonly state?: string;
          readonly featured?: boolean;
          readonly language: string;
          readonly date: string;
          readonly seconds: number | null;
          readonly series?: string;
        },
      ) => `
        INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[languageCode],[durationSeconds],[publishedOn],[seriesId],[seriesPosition]) VALUES
          (N'${id}', N'${hubSlug(key)}', N'en', N'${fields.state ?? 'published'}', ${fields.featured === true ? 1 : 0}, N'youtube', '${providerKey(`H${key.slice(0, 3)}${key.slice(-2)}`)}',
           N'available', N'${fields.language}', ${fields.seconds === null ? 'NULL' : String(fields.seconds)}, '${fields.date}',
           ${fields.series === undefined ? 'NULL, NULL' : `N'${fields.series}', 1`});
        INSERT INTO [dbo].[VideoLabel] ([videoId],[locale],[title],[description]) VALUES (N'${id}', N'en', ${n(title)}, N'NON_HADITH_FIXTURE description of a video on Hadith.');
        INSERT INTO [dbo].[VideoTopic] ([videoId],[topicId]) VALUES (N'${id}', N'${hadithTopic}');`;
      const fillers = Array.from({ length: FILLERS }, (_, index) => {
        const number = String(index + 1).padStart(2, '0');
        return video(
          randomUUID(),
          `video-filler-${number}`,
          `Zz NON_HADITH_FIXTURE hub video filler ${run} ${number}`,
          {
            language: 'en',
            date: `2000-01-${number}`,
            seconds: null,
          },
        );
      }).join('\n');
      await sql.query(`
        INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES (N'${hub.speaker}', N'${hubSlug('speaker')}', N'en', N'published');
        INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES (N'${hub.speaker}', N'en', ${n(TITLE.speaker)}, NULL);
        INSERT INTO [dbo].[Series] ([id],[slug],[kind],[primaryLocale],[state]) VALUES (N'${hub.series}', N'${hubSlug('series')}', N'series', N'en', N'published');
        INSERT INTO [dbo].[SeriesLabel] ([seriesId],[locale],[title],[description]) VALUES (N'${hub.series}', N'en', ${n(TITLE.series)}, N'');

        ${video(hub.videoFeatured, 'video-featured', TITLE.videoFeatured, { featured: true, language: 'en', date: '2026-01-05', seconds: 1_500, series: hub.series })}
        INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${hub.videoFeatured}', N'${hub.speaker}', 0);
        ${video(hub.videoLecture, 'video-lecture', TITLE.videoLecture, { language: 'ar', date: '2025-06-01', seconds: 4_000 })}
        INSERT INTO [dbo].[VideoSpeaker] ([videoId],[personId],[position]) VALUES (N'${hub.videoLecture}', N'${hub.speaker}', 0);
        ${video(hub.videoShort, 'video-short', TITLE.videoShort, { language: 'ur', date: '2024-03-03', seconds: 600 })}
        ${video(hub.videoDraft, 'video-draft', TITLE.videoDraft, { state: 'draft', featured: true, language: 'en', date: '2026-02-02', seconds: 900 })}
        ${fillers}
      `);
    });

    test('the hub: its figures, featured videos, cards and pages — never a draft, never a passage part', async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await visitHub(page, '/hadith/videos');
      const main = page.getByRole('main');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(LIST);
      await expect(
        main.getByRole('link', { name: `${String(base.videos + 25)} videos on Hadith` }),
      ).toHaveAttribute('href', '#hadith-videos-list');
      await expect(main).toContainText(/hours? of lectures/);
      await expect(
        main.getByRole('link', { name: 'Books on Hadith', exact: true }).first(),
      ).toHaveAttribute('href', '/hadith/books');

      const featured = page.locator('section[aria-labelledby="hadith-videos-featured"]');
      await expect(
        featured.getByRole('link', { name: TITLE.videoFeatured, exact: true }),
      ).toHaveAttribute('href', `/watch/videos/${hubSlug('video-featured')}`);
      await expect(featured).toContainText(`Episode 1 · ${TITLE.series}`);
      await expect(main).not.toContainText(TITLE.videoDraft);

      // No shelf, no Surah index, no Surah filter, no Quran order.
      await expect(page.getByRole('navigation', { name: 'Shelves' })).toHaveCount(0);
      await expect(
        page.locator('section[aria-labelledby="hadith-videos-surahs"]'),
      ).toHaveCount(0);
      await expect(page.getByLabel('Surah', { exact: true })).toHaveCount(0);
      await expect(
        page.getByLabel('Order', { exact: true }).locator('option'),
      ).toHaveText(['Newest first', 'Title, A–Z']);

      // A card is one link: no passage start, no Surah chips.
      const lecture = item(page, LIST, TITLE.videoLecture);
      await expect(lecture).toContainText(TITLE.speaker);
      await expect(lecture.getByRole('link')).toHaveCount(1);

      const list = main.getByRole('list', { name: LIST, exact: true });
      await expect(list.locator(':scope > li')).toHaveCount(24);
      await expect(main.getByText(/^1–24 of \d+ videos$/)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-videos-en-1440.png'),
        fullPage: true,
      });
      await axe(page, '/hadith/videos', testInfo);
      await page
        .getByRole('navigation', { name: 'Pages of videos' })
        .getByRole('link', { name: 'Next page' })
        .click();
      await page.waitForURL('**/hadith/videos?page=2');
      await expect(main.getByText(/^25–\d+ of \d+ videos$/)).toBeVisible();
    });

    test('filters and orders are addresses that work without script — chips, reset and honest empty states', async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const plain = await browser.newContext({
        baseURL: baseUrl(),
        javaScriptEnabled: false,
      });
      contexts.push(plain);
      const page = await plain.newPage();
      await page.goto('/hadith/videos');
      const form = page.getByRole('form', { name: 'Filter the videos' });
      await form.getByLabel('Speaker', { exact: true }).selectOption(hub.speaker);
      await form.getByRole('button', { name: 'Show videos' }).click();
      await page.waitForURL(`**/hadith/videos?speaker=${hub.speaker}`);
      const list = page.getByRole('list', { name: LIST, exact: true });
      await expect(list.locator(':scope > li h3')).toHaveText([
        TITLE.videoFeatured,
        TITLE.videoLecture,
      ]);
      await expect(
        page
          .getByRole('list', { name: 'Filters in use' })
          .getByRole('link', { name: `Remove filter: ${TITLE.speaker}` }),
      ).toHaveAttribute('href', '/hadith/videos');

      await page.goto(`/hadith/videos?series=${hub.series}`);
      await expect(list.locator(':scope > li h3')).toHaveText([TITLE.videoFeatured]);
      await page.goto('/hadith/videos?length=short');
      await expect(item(page, LIST, TITLE.videoShort)).toHaveCount(1);
      await expect(item(page, LIST, TITLE.videoLecture)).toHaveCount(0);
      await page.goto('/hadith/videos?language=ar');
      await expect(item(page, LIST, TITLE.videoLecture)).toHaveCount(1);

      await page.goto(`/hadith/videos?speaker=${hub.speaker}&length=short`);
      await expect(page.getByText('No videos match these filters')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Pages of videos' })).toHaveCount(
        0,
      );
      await page.goto('/hadith/videos?page=900');
      await expect(page.getByText('This page is empty')).toBeVisible();

      for (const target of [
        '/hadith/videos?shelf=explains',
        '/hadith/videos?surah=18',
        '/hadith/videos?sort=quran',
        '/hadith/videos?length=endless',
        '/hadith/videos?series=one',
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(here(page), target).toBe('/hadith/videos');
      }
      await page.goto('/hadith/videos?sort=title&length=&language=ur');
      expect(here(page)).toBe('/hadith/videos?language=ur&sort=title');
    });

    test('Urdu and Arabic read right to left, fit 320 and 390 px, and have no serious accessibility finding', async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await visitHub(page, localizedPath('ur', '/hadith/videos'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('حدیث پر ویڈیوز');
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-videos-ur-390.png'),
        fullPage: true,
      });
      await axe(page, '/ur/hadith/videos', testInfo);
      await visitHub(page, localizedPath('ar', '/hadith/videos'));
      await axe(page, '/ar/hadith/videos', testInfo);
      for (const width of [320, 390, 1440])
        for (const target of [
          '/hadith/videos',
          '/ur/hadith/videos',
          '/ar/hadith/videos?length=long',
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(target);
          const result = await overflowDetail(page);
          expect(
            result.overflow,
            `${target} @${String(width)}: ${result.offenders.join(', ')}`,
          ).toBeLessThanOrEqual(0);
        }
    });
  });

  /* ---- Research ------------------------------------------------------- */

  test.describe('the Research hub', () => {
    const TITLE_RESEARCH = 'Research on Hadith';
    const FILLERS = 20;

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      const document = JSON.stringify({
        sections: [
          {
            key: 'one',
            title: 'NON_HADITH_FIXTURE section',
            paragraphs: ['NON_HADITH_FIXTURE text.'],
          },
        ],
      });
      const fillers = Array.from({ length: FILLERS }, (_, index) => {
        const id = randomUUID();
        const number = String(index + 1).padStart(2, '0');
        return `
          INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear]) VALUES
            (N'${id}', N'${hubSlug(`research-filler-${number}`)}', N'en', N'en', N'published', ${String(1900 + index + 1)});
          INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES
            (N'${id}', N'en', N'Zz NON_HADITH_FIXTURE hub research filler ${run} ${number}', N'');
          INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${id}', N'${hadithTopic}');`;
      }).join('\n');
      await sql.query(`
        INSERT INTO [dbo].[ResearchPaper] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[publishedOn],[venue],[doi]) VALUES
          (N'${hub.paper}', N'${hubSlug('paper')}', N'en', N'ar', N'published', 2024, '2024-05-06', N'NON_HADITH_FIXTURE journal', N'10.1234/hadith.${run}');
        INSERT INTO [dbo].[ResearchPaperLabel] ([researchPaperId],[locale],[title],[summary]) VALUES
          (N'${hub.paper}', N'en', ${n(TITLE.paper)}, N'NON_HADITH_FIXTURE summary of a paper.');
        INSERT INTO [dbo].[ResearchPaperTopic] ([researchPaperId],[topicId]) VALUES (N'${hub.paper}', N'${hadithTopic}');
        INSERT INTO [dbo].[ResearchPaperContributor] ([researchPaperId],[personId],[role],[position]) VALUES (N'${hub.paper}', N'${hub.author}', N'author', 0);
        INSERT INTO [dbo].[ResearchPaperCitation] ([researchPaperId],[position],[text],[url],[doi]) VALUES
          (N'${hub.paper}', 0, N'NON_HADITH_FIXTURE citation one', NULL, NULL),
          (N'${hub.paper}', 1, N'NON_HADITH_FIXTURE citation two', NULL, NULL);

        INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear],[institutionalContext],[abstract],[document]) VALUES
          (N'${hub.study}', N'${hubSlug('study')}', N'en', N'ur', N'published', 2019, N'NON_HADITH_FIXTURE institute', ${n(ABSTRACT)}, ${n(document)});
        INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES (N'${hub.study}', N'en', ${n(TITLE.study)}, N'');
        INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${hub.study}', N'${hadithTopic}');
        INSERT INTO [dbo].[ResearchContributor] ([researchId],[personId],[role],[position]) VALUES (N'${hub.study}', N'${hub.author}', N'editor', 0);

        INSERT INTO [dbo].[Research] ([id],[slug],[primaryLocale],[languageCode],[state],[publicationYear]) VALUES
          (N'${hub.researchDraft}', N'${hubSlug('research-draft')}', N'en', N'en', N'draft', 2025);
        INSERT INTO [dbo].[ResearchLabel] ([researchId],[locale],[title],[summary]) VALUES (N'${hub.researchDraft}', N'en', ${n(TITLE.researchDraft)}, N'');
        INSERT INTO [dbo].[ResearchTopic] ([researchId],[topicId]) VALUES (N'${hub.researchDraft}', N'${hadithTopic}');

        ${fillers}
      `);
    });

    /** An entry of the listing, whichever decade holds it. */
    const entry = (page: Page, title: string) =>
      page
        .getByRole('main')
        .locator('li', { has: page.getByRole('link', { name: title, exact: true }) });

    test('the hub: its figures, kinds, decade timeline and catalogue entries — never a draft', async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await visitHub(page, '/hadith/research');
      const main = page.getByRole('main');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE_RESEARCH);
      await expect(
        main.getByRole('link', {
          name: `${String(base.records + 22)} works of research on Hadith`,
        }),
      ).toHaveAttribute('href', '#hadith-research-list');
      await expect(main).not.toContainText(TITLE.researchDraft);

      // The kinds, as tabs with counts.
      const kinds = page.getByRole('navigation', { name: 'Kinds of research' });
      await expect(kinds.getByRole('link', { name: /^Research papers/ })).toHaveAttribute(
        'href',
        '/hadith/research?kind=paper',
      );

      // Newest first, as a timeline by decade.
      const decades = main.locator(
        'section[aria-labelledby^="hadith-research-decade-"] h3',
      );
      await expect(decades.first()).toHaveText('2020s');

      // A paper: kind, language, date, venue, DOI and citations.
      const paper = entry(page, TITLE.paper);
      await expect(paper).toContainText('Research paper');
      await expect(paper).toContainText('Appeared in NON_HADITH_FIXTURE journal');
      await expect(paper.getByRole('link', { name: /DOI/ })).toHaveAttribute(
        'href',
        `https://doi.org/10.1234/hadith.${run}`,
      );
      await expect(paper).toContainText('Cites 2 works');
      // A study with its text here, and its abstract in its own language.
      const study = entry(page, TITLE.study);
      await expect(
        study.getByRole('link', { name: `Read the full text: ${TITLE.study}` }),
      ).toHaveAttribute('href', `/library/research/${hubSlug('study')}`);
      await expect(study.locator('p[lang="ur"]')).toHaveAttribute('dir', 'rtl');

      await expect(main.getByText(/^1–20 of \d+ works of research$/)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-research-en-1440.png'),
        fullPage: true,
      });
      await axe(page, '/hadith/research', testInfo);
      await page
        .getByRole('navigation', { name: 'Pages of research' })
        .getByRole('link', { name: 'Next page' })
        .click();
      await page.waitForURL('**/hadith/research?page=2');
      await expect(main.getByText(/^21–\d+ of \d+ works of research$/)).toBeVisible();
    });

    test('kinds, filters and orders are addresses that work without script — chips, reset and honest empty states', async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const plain = await browser.newContext({
        baseURL: baseUrl(),
        javaScriptEnabled: false,
      });
      contexts.push(plain);
      const page = await plain.newPage();
      await page.goto('/hadith/research');
      const form = page.getByRole('form', { name: 'Filter the research' });
      await form.getByLabel('Author', { exact: true }).selectOption(hub.author);
      await form.getByRole('button', { name: 'Show research' }).click();
      await page.waitForURL(`**/hadith/research?contributor=${hub.author}`);
      await expect(entry(page, TITLE.paper)).toHaveCount(1);
      await expect(entry(page, TITLE.study)).toHaveCount(1);
      await expect(
        page
          .getByRole('list', { name: 'Filters in use' })
          .getByRole('link', { name: `Remove filter: ${TITLE.author}` }),
      ).toHaveAttribute('href', '/hadith/research');

      await page.goto('/hadith/research?kind=paper');
      await expect(entry(page, TITLE.paper)).toHaveCount(1);
      await expect(entry(page, TITLE.study)).toHaveCount(0);
      await page.goto('/hadith/research?fulltext=1');
      await expect(entry(page, TITLE.study)).toHaveCount(1);
      await expect(entry(page, TITLE.paper)).toHaveCount(0);
      await page.goto('/hadith/research?decade=1900');
      await expect(entry(page, TITLE.study)).toHaveCount(0);
      await page.goto('/hadith/research?sort=oldest');
      await expect(
        page
          .getByRole('main')
          .locator('section[aria-labelledby^="hadith-research-decade-"] h3')
          .first(),
      ).toHaveText('1900s');

      await page.goto('/hadith/research?kind=paper&decade=1900');
      await expect(page.getByText('No research matches these filters')).toBeVisible();
      await page.goto('/hadith/research?page=900');
      await expect(page.getByText('This page is empty')).toBeVisible();
      for (const target of [
        '/hadith/research?kind=drafts',
        '/hadith/research?decade=1995',
        '/hadith/research?fulltext=yes',
        '/hadith/research?sort=quran',
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(here(page), target).toBe('/hadith/research');
      }
      await page.goto('/hadith/research?sort=title&language=&kind=paper');
      expect(here(page)).toBe('/hadith/research?kind=paper&sort=title');
    });

    test('Urdu and Arabic read right to left, fit 320 and 390 px, and have no serious accessibility finding', async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await visitHub(page, localizedPath('ur', '/hadith/research'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('حدیث پر تحقیق');
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-research-ur-390.png'),
        fullPage: true,
      });
      await axe(page, '/ur/hadith/research', testInfo);
      await visitHub(page, localizedPath('ar', '/hadith/research'));
      await axe(page, '/ar/hadith/research', testInfo);
      for (const width of [320, 390, 1440])
        for (const target of [
          '/hadith/research',
          '/ur/hadith/research',
          '/ar/hadith/research?kind=paper',
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(target);
          const result = await overflowDetail(page);
          expect(
            result.overflow,
            `${target} @${String(width)}: ${result.offenders.join(', ')}`,
          ).toBeLessThanOrEqual(0);
        }
    });
  });

  /* ---- Courses -------------------------------------------------------- */

  test.describe('the Courses hub', () => {
    const TITLE_COURSES = 'Courses on Hadith';
    const FILLERS = 12;
    const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      const course = (
        id: string,
        key: string,
        fields: {
          readonly title: string;
          readonly urduTitle?: string;
          readonly level: string | null;
          readonly format: 'live' | 'self-paced';
          readonly language: string;
          readonly teachers: readonly string[];
          readonly lessons: readonly number[];
          readonly published: string;
          readonly draft?: boolean;
        },
      ) => {
        const modules = fields.lessons
          .map((count, position) => {
            const moduleId = randomUUID();
            const lessons = Array.from({ length: count }, (_, index) => {
              const lessonId = randomUUID();
              return `
                INSERT INTO [dbo].[Lesson] ([id],[courseId],[moduleId],[position]) VALUES (N'${lessonId}', N'${id}', N'${moduleId}', ${String(index)});
                INSERT INTO [dbo].[LessonLabel] ([lessonId],[locale],[title],[summary],[body]) VALUES (N'${lessonId}', N'en', N'NON_HADITH_FIXTURE lesson ${run}', N'', N'NON_HADITH_FIXTURE lesson body ${run}');`;
            }).join('');
            return `
              INSERT INTO [dbo].[CourseModule] ([id],[courseId],[position]) VALUES (N'${moduleId}', N'${id}', ${String(position)});
              INSERT INTO [dbo].[CourseModuleLabel] ([moduleId],[locale],[title],[summary]) VALUES (N'${moduleId}', N'en', N'NON_HADITH_FIXTURE module ${run}', N'');
              ${lessons}`;
          })
          .join('');
        return `
          INSERT INTO [dbo].[Course] ([id],[slug],[primaryLocale],[state],[level],[format],[languageCode],[publishedAt],[version],[updatedAt]) VALUES
            (N'${id}', N'${hubSlug(key)}', N'en', N'draft', ${fields.level === null ? 'NULL' : n(fields.level)}, N'${fields.format}', N'${fields.language}', NULL, 1, SYSUTCDATETIME());
          INSERT INTO [dbo].[CourseLabel] ([courseId],[locale],[title],[summary],[description]) VALUES
            (N'${id}', N'en', ${n(fields.title)}, N'NON_HADITH_FIXTURE summary of a course.', N'')
            ${fields.urduTitle === undefined ? '' : `, (N'${id}', N'ur', ${n(fields.urduTitle)}, N'', N'')`};
          INSERT INTO [dbo].[CourseTopic] ([courseId],[topicId]) VALUES (N'${id}', N'${hadithTopic}');
          ${fields.teachers.map((teacher, position) => `INSERT INTO [dbo].[CourseTeacher] ([courseId],[personId],[position]) VALUES (N'${id}', N'${teacher}', ${String(position)});`).join('\n')}
          ${modules}
          ${
            fields.draft === true
              ? ''
              : `UPDATE [dbo].[Course] SET [state] = N'published', [publishedAt] = '${fields.published}', [version] = 2, [updatedAt] = SYSUTCDATETIME() WHERE [id] = N'${id}';`
          }`;
      };
      const fillers = Array.from({ length: FILLERS }, (_, index) => {
        const number = String(index + 1).padStart(2, '0');
        return course(randomUUID(), `course-filler-${number}`, {
          title: `Zz NON_HADITH_FIXTURE hub course filler ${run} ${number}`,
          level: LEVELS[index % 3] ?? null,
          format: 'self-paced',
          language: 'en',
          teachers: [hub.teacherOne],
          lessons: [1],
          published: `2001-01-${number}T00:00:00`,
        });
      });
      await sql.query(`
        INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status]) VALUES
          (N'${hub.teacherOne}', N'${hubSlug('teacher-one')}', N'en', N'published'),
          (N'${hub.teacherTwo}', N'${hubSlug('teacher-two')}', N'en', N'published');
        INSERT INTO [dbo].[PersonTranslation] ([personId],[locale],[name],[biography]) VALUES
          (N'${hub.teacherOne}', N'en', ${n(TITLE.teacherOne)}, NULL),
          (N'${hub.teacherTwo}', N'en', ${n(TITLE.teacherTwo)}, NULL);
        ${course(hub.courseLive, 'course-live', { title: TITLE.courseLive, urduTitle: TITLE.courseLiveUrdu, level: 'beginner', format: 'live', language: 'ur', teachers: [hub.teacherOne, hub.teacherTwo], lessons: [1, 2], published: '2002-03-01T00:00:00' })}
        ${course(hub.coursePaced, 'course-paced', { title: TITLE.coursePaced, level: 'intermediate', format: 'self-paced', language: 'en', teachers: [hub.teacherOne], lessons: [2], published: '2002-06-01T00:00:00' })}
        ${course(hub.courseAdvanced, 'course-advanced', { title: TITLE.courseAdvanced, level: 'advanced', format: 'live', language: 'ar', teachers: [hub.teacherTwo], lessons: [3], published: '2002-01-01T00:00:00' })}
        ${course(hub.courseUnstated, 'course-unstated', { title: TITLE.courseUnstated, level: null, format: 'self-paced', language: 'en', teachers: [], lessons: [1], published: '2002-02-01T00:00:00' })}
        ${course(hub.courseDraft, 'course-draft', { title: TITLE.courseDraft, level: 'beginner', format: 'self-paced', language: 'en', teachers: [hub.teacherOne], lessons: [1], published: '2002-01-01T00:00:00', draft: true })}
        ${fillers.join('\n')}

        INSERT INTO [dbo].[LearningPath] ([id],[slug],[primaryLocale],[state],[publishedAt],[version],[updatedAt]) VALUES
          (N'${hub.path}', N'${hubSlug('path')}', N'en', N'draft', NULL, 1, SYSUTCDATETIME());
        INSERT INTO [dbo].[LearningPathLabel] ([pathId],[locale],[title],[summary],[description]) VALUES
          (N'${hub.path}', N'en', ${n(TITLE.path)}, N'NON_HADITH_FIXTURE path summary.', N'');
        INSERT INTO [dbo].[LearningPathCourse] ([pathId],[courseId],[position]) VALUES
          (N'${hub.path}', N'${hub.courseLive}', 0),
          (N'${hub.path}', N'${hub.coursePaced}', 1);
        UPDATE [dbo].[LearningPath] SET [state] = N'published', [publishedAt] = '2002-07-01T00:00:00', [version] = 2, [updatedAt] = SYSUTCDATETIME()
          WHERE [id] = N'${hub.path}';
      `);
    });

    // What this describe published is withdrawn when it is done, so no spec
    // after it meets these Courses in Learn's own catalogue.
    test.afterAll(async () => {
      await sql.query(`
        UPDATE [dbo].[LearningPath] SET [state] = N'draft', [version] = [version] + 1, [updatedAt] = SYSUTCDATETIME()
          WHERE [id] = N'${hub.path}';
        UPDATE [dbo].[Course] SET [state] = N'archived', [version] = [version] + 1, [updatedAt] = SYSUTCDATETIME()
          WHERE [state] = N'published' AND [slug] LIKE N'fixture-hadith-hub-course-%-${run}';
      `);
    });

    test('the hub: its figures, formats, level steps, cards, paths and the hubs alongside — never a draft', async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await visitHub(page, '/hadith/courses');
      const main = page.getByRole('main');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE_COURSES);
      await expect(
        main.getByRole('link', {
          name: `${String(base.courses + 16)} courses on Hadith`,
        }),
      ).toHaveAttribute('href', '#hadith-courses-list');
      await expect(main).not.toContainText(TITLE.courseDraft);
      await expect(
        page.getByRole('navigation', { name: 'Ways to study' }).getByRole('link', {
          name: /^Taught live/,
        }),
      ).toHaveAttribute('href', '/hadith/courses?format=live');

      // A card: format, level, teachers, syllabus counts and the way to its page.
      const live = main.locator('li', {
        has: page.getByRole('link', { name: TITLE.courseLive, exact: true }),
      });
      await expect(live).toContainText('Taught live');
      await expect(live).toContainText('Beginner');
      await expect(live).toContainText(`${TITLE.teacherOne} · ${TITLE.teacherTwo}`);
      await expect(live).toContainText('2 modules');
      await expect(
        live.getByRole('link', { name: `View course: ${TITLE.courseLive}` }),
      ).toHaveAttribute('href', `/learn/courses/${hubSlug('course-live')}`);

      // The path holding a course on Hadith, and the hubs read alongside.
      const paths = page.locator('section[aria-labelledby="hadith-courses-paths"]');
      await expect(paths.getByRole('link', { name: TITLE.path })).toHaveCount(1);
      const alongside = page.locator(
        'section[aria-labelledby="hadith-courses-alongside"]',
      );
      for (const [name, href] of [
        ['Books on Hadith', '/hadith/books'],
        ['Videos on Hadith', '/hadith/videos'],
        ['Research on Hadith', '/hadith/research'],
      ] as const)
        await expect(alongside.getByRole('link', { name })).toHaveAttribute('href', href);

      await expect(main.getByText(/^1–12 of \d+ courses$/)).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-courses-en-1440.png'),
        fullPage: true,
      });
      await axe(page, '/hadith/courses', testInfo);
      await page
        .getByRole('navigation', { name: 'Pages of courses' })
        .getByRole('link', { name: 'Next page' })
        .click();
      await page.waitForURL('**/hadith/courses?page=2');
      await expect(main.getByText(/^13–\d+ of \d+ courses$/)).toBeVisible();
      // The level order ends on the courses whose level is not stated.
      await expect(main.getByRole('heading', { name: 'Level not stated' })).toBeVisible();
    });

    test('formats, filters and orders are addresses that work without script — chips, reset and honest empty states', async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const plain = await browser.newContext({
        baseURL: baseUrl(),
        javaScriptEnabled: false,
      });
      contexts.push(plain);
      const page = await plain.newPage();
      await page.goto('/hadith/courses');
      const form = page.getByRole('form', { name: 'Filter the courses' });
      await form.getByLabel('Teacher', { exact: true }).selectOption(hub.teacherTwo);
      await form.getByRole('button', { name: 'Show courses' }).click();
      await page.waitForURL(`**/hadith/courses?teacher=${hub.teacherTwo}`);
      const course = (title: string) =>
        page
          .getByRole('main')
          .locator('li', { has: page.getByRole('link', { name: title, exact: true }) });
      await expect(course(TITLE.courseLive)).toHaveCount(1);
      await expect(course(TITLE.courseAdvanced)).toHaveCount(1);
      await expect(course(TITLE.coursePaced)).toHaveCount(0);
      await expect(
        page
          .getByRole('list', { name: 'Filters in use' })
          .getByRole('link', { name: `Remove filter: ${TITLE.teacherTwo}` }),
      ).toHaveAttribute('href', '/hadith/courses');

      await page.goto('/hadith/courses?format=live');
      await expect(course(TITLE.coursePaced)).toHaveCount(0);
      await expect(course(TITLE.courseLive)).toHaveCount(1);
      await page.goto('/hadith/courses?level=advanced&language=ar');
      await expect(course(TITLE.courseAdvanced)).toHaveCount(1);
      await page.goto('/hadith/courses?language=ur&sort=title');
      await expect(course(TITLE.courseLive)).toHaveCount(1);

      await page.goto(`/hadith/courses?teacher=${hub.teacherTwo}&format=self-paced`);
      await expect(page.getByText('No course matches these filters')).toBeVisible();
      await page.goto('/hadith/courses?page=900');
      await expect(page.getByText('This page is empty')).toBeVisible();
      for (const target of [
        '/hadith/courses?format=weekly',
        '/hadith/courses?level=expert',
        `/hadith/courses?teacher=${hubSlug('teacher-one')}`,
        '/hadith/courses?offset=12',
      ]) {
        const response = await page.goto(target);
        expect(response?.status(), target).toBe(200);
        expect(here(page), target).toBe(
          target.endsWith('offset=12') ? target : '/hadith/courses',
        );
      }
      await page.goto('/hadith/courses?sort=newest&level=&format=live');
      expect(here(page)).toBe('/hadith/courses?format=live&sort=newest');
    });

    test('Urdu and Arabic read right to left, fit 320 and 390 px, and have no serious accessibility finding', async ({
      page,
    }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await visitHub(page, localizedPath('ur', '/hadith/courses'));
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('حدیث پر کورسز');
      // The Urdu title is read where one is recorded, in its own language.
      await expect(
        page.getByRole('link', { name: TITLE.courseLiveUrdu, exact: true }),
      ).toHaveCount(1);
      await page.screenshot({
        path: testInfo.outputPath('hadith-part1-courses-ur-390.png'),
        fullPage: true,
      });
      await axe(page, '/ur/hadith/courses', testInfo);
      await visitHub(page, localizedPath('ar', '/hadith/courses'));
      await axe(page, '/ar/hadith/courses', testInfo);
      for (const width of [320, 390, 1440])
        for (const target of [
          '/hadith/courses',
          '/ur/hadith/courses',
          '/ar/hadith/courses?format=live',
        ]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(target);
          const result = await overflowDetail(page);
          expect(
            result.overflow,
            `${target} @${String(width)}: ${result.offenders.join(', ')}`,
          ).toBeLessThanOrEqual(0);
        }
    });
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
      '/hadith',
      '/hadith/introduction',
      '/hadith/collections',
      `/hadith/collections/${slug.collection}`,
      `/hadith/collections/${slug.collection}/books`,
      BOOK,
      CHAPTER,
      `${COLLECTION}/1`,
      '/hadith/browse',
      `/hadith/search?q=${encodeURIComponent(NAME.collection)}`,
      `/hadith/topics/${slug.topic}`,
      '/hadith/sciences',
      `/hadith/sciences/${slug.science}`,
      '/hadith/commentary',
      '/hadith/books',
      '/hadith/videos',
      '/hadith/research',
      '/hadith/courses',
    ])
      await visitFixture(page, target);

    for (const locale of ['ur', 'ar'] as const) {
      for (const target of ['/hadith', `${COLLECTION}/1`, '/hadith/browse'])
        await visitFixture(page, localizedPath(locale, target), locale);
    }
  });

  test('the landing offers only what exists', async ({ page }) => {
    await visitFixture(page, '/hadith');
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
      'courses',
    ])
      expect(hrefs, section).toContain(`/hadith/${section}`);
    expect(hrefs).toContain(`/hadith/collections/${slug.collection}`);
    expect(hrefs).toContain('/topics/hadith');
    // No featured narration, no statistics.
    await expect(page.getByRole('main')).not.toContainText('NON_HADITH_FIXTURE_TEXT');
    // Hadith's own search, beside the site-wide one in the header.
    await expect(page.getByRole('main').getByRole('search')).toHaveCount(1);

    // THE NAVIGATION IS UNCONDITIONAL (owner direction 2026-11-08): Hadith is
    // one of the nine domains whatever corpus is active, so the header's
    // Hadith menu leads here, and the footer's Knowledge column to its
    // collections, while the fixture reads at its address under its banner.
    await expect(
      page
        .getByRole('banner')
        .getByRole('navigation', { name: 'Main navigation' })
        .locator('a[href="/hadith"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole('contentinfo').locator('a[href="/hadith/collections"]'),
    ).toHaveCount(1);
  });

  test('a citation shows its original, chain and gradings exactly as sourced, in every locale', async ({
    page,
  }) => {
    for (const locale of LOCALES) {
      await visitFixture(page, localizedPath(locale, `${COLLECTION}/1`), locale);

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
    await visitFixture(page, `${COLLECTION}/1`);
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
      `/hadith/topics/${slug.topic}`,
    );
  });

  test('structure is read chapter → citation by keyboard alone, with a visible focus', async ({
    page,
  }) => {
    await visitFixture(page, CHAPTER);
    const list = page.getByRole('list', { name: 'Citations in this chapter' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    // The structural page links to the SHORT canonical citation, never a
    // deeper address of its own.
    const link = list.getByRole('link', { name: citationName(1) });
    await expect(link).toHaveAttribute('href', `${COLLECTION}/1`);
    // Number 3's record sits in this chapter too, but is not verified now.
    await expect(page.getByRole('main')).not.toContainText('NON_HADITH_FIXTURE_TEXT_4');

    await tabTo(page, link);
    await expectVisibleFocus(link);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`${COLLECTION}/1$`));
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);

    const book = page
      .locator('section[aria-labelledby="hadith-facts"]')
      .getByRole('link', { name: NAME.book });
    await expect(book).toHaveAttribute('href', BOOK);
    await tabTo(page, book);
    await expectVisibleFocus(book);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`${BOOK}$`));
    await expect(
      page
        .getByRole('list', { name: 'Chapters' })
        .getByRole('link', { name: NAME.chapter }),
    ).toHaveAttribute('href', CHAPTER);
  });

  test('a conflicted citation and an unverified correction are absent everywhere', async ({
    page,
    request,
  }) => {
    for (const number of [2, 3, 4]) {
      const response = await request.get(`${COLLECTION}/${String(number)}`, {
        maxRedirects: 0,
      });
      expect(response.status(), String(number)).toBe(404);
    }
    // The other edition's book holds only the conflicting candidate: absent.
    const otherBook = await request.get(
      `/hadith/collections/${slug.collection}/books/${slug.bookB}`,
      { maxRedirects: 0 },
    );
    expect(otherBook.status()).toBe(404);

    const notPublic = /NON_HADITH_FIXTURE_TEXT_[2345]/;
    for (const [target, label] of [
      ['/hadith/browse', 'Citations'],
      [`/hadith/topics/${slug.topic}`, NAME.topic],
    ] as const) {
      await visitFixture(page, target);
      const list = page.getByRole('list', { name: label, exact: true });
      await expect(list.getByRole('listitem'), target).toHaveCount(1);
      await expect(list.getByRole('link', { name: citationName(1) })).toHaveAttribute(
        'href',
        `${COLLECTION}/1`,
      );
      await expect(page.getByRole('main'), target).not.toContainText(notPublic);
      const hrefs = await hrefsIn(page);
      for (const number of [2, 3, 4])
        expect(hrefs, target).not.toContain(`${COLLECTION}/${String(number)}`);
    }

    // The book lists the citations placed in it and in NO chapter. Number 2's
    // record is the only chapterless one mapped, and it is conflicted: the
    // book offers its chapter and no citation list at all.
    await visitFixture(page, BOOK);
    await expect(page.getByRole('list', { name: 'Citations in this book' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('main')).not.toContainText(notPublic);
    const bookHrefs = await hrefsIn(page);
    expect(bookHrefs).toContain(CHAPTER);
    for (const number of [2, 3, 4])
      expect(bookHrefs).not.toContain(`${COLLECTION}/${String(number)}`);

    await visitFixture(page, `/hadith/collections/${slug.collection}/books`);
    const books = await hrefsIn(page);
    expect(books).toContain(BOOK);
    expect(books.some((href) => href.includes(slug.bookB))).toBe(false);

    // The topic hub composes the same single citation, under the banner.
    const hub = await page.goto(`/topics/${slug.topic}`);
    expect(hub?.status()).toBe(200);
    await expect(
      page.getByRole('note').filter({ hasText: COPY.en.fixture }),
    ).toBeVisible();
    const hubHrefs = await hrefsIn(page);
    expect(hubHrefs).toContain(`${COLLECTION}/1`);
    expect(hubHrefs).toContain(`/hadith/topics/${slug.topic}`);
    for (const number of [2, 3])
      expect(hubHrefs).not.toContain(`${COLLECTION}/${String(number)}`);
  });

  test('the study pages render the published fixture works', async ({ page }) => {
    await visitFixture(page, '/hadith/sciences');
    await page.getByRole('link', { name: NAME.science }).click();
    await page.waitForURL(`**/hadith/sciences/${slug.science}`);
    await expect(page.getByRole('note')).toHaveText(COPY.en.fixture);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME.science);
    await expect(page.getByRole('main')).toContainText(TEXT.science);

    await visitFixture(page, '/hadith/commentary');
    const work = page.getByRole('article', { name: NAME.commentary });
    await expect(work).toBeVisible();
    await expect(work).toContainText('1 entry');

    await visitFixture(page, '/hadith/collections');
    await expect(
      page.getByRole('list', { name: 'Collections' }).getByRole('listitem'),
    ).toHaveCount(1);
    await page.getByRole('link', { name: NAME.collection }).click();
    await page.waitForURL(`**/hadith/collections/${slug.collection}`);
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
            `/hadith/search?q=${encodeURIComponent(WORD)}`,
          );
          expect(response?.status()).toBe(200);
          await page.getByRole('heading', { level: 1 }).waitFor();
          return page.getByRole('main').innerText();
        },
        { timeout: 120_000, intervals: [2_000, 3_000, 5_000] },
      )
      .toContain(citationName(1));

    expect(new URL(page.url()).pathname).toBe('/hadith/search');
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
    await expect(hit).toHaveAttribute('href', `${COLLECTION}/1`);
    const hrefs = await hrefsIn(page);
    for (const number of [2, 3, 4])
      expect(hrefs).not.toContain(`${COLLECTION}/${String(number)}`);
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
        ...LOCALES.map((locale) => localizedPath(locale, `${COLLECTION}/1`)),
        CHAPTER,
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
      await page.goto(`${COLLECTION}/1`);
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
    const target = `${COLLECTION}/1`;
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
      `/signin?returnTo=${encodeURIComponent(target)}`,
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
    await page.goto(`/admin/hadith/records/${ids.publicRecord}`);
    await page.waitForURL(/\/signin\?returnTo=/);

    for (const surface of [
      'records',
      `records/${ids.publicRecord}`,
      'collections',
      `collections/${ids.collection}`,
      'books',
      'commentary',
      'sciences',
    ]) {
      const response = await nobody.goto(`/admin/hadith/${surface}`);
      expect(response?.status(), surface).toBe(404);
    }
  });

  test('hadith.read reads records and their evidence, and is offered nothing to change', async () => {
    const list = await reader.goto('/admin/hadith/records');
    expect(list?.status()).toBe(200);
    const main = reader.getByRole('main');
    await expect(main.getByRole('link', { name: LONG_REFERENCE })).toHaveAttribute(
      'href',
      `/admin/hadith/records/${ids.publicRecord}`,
    );
    await expect(main.getByRole('heading', { name: 'New record' })).toHaveCount(0);

    // THE ADMINISTRATION IS NEVER CACHED OR INDEXED.
    for (const target of [
      '/admin/hadith/records',
      `/admin/hadith/records/${ids.publicRecord}`,
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

    const detail = await reader.goto(`/admin/hadith/records/${ids.publicRecord}`);
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
      await reader.goto(`/admin/hadith/records/${ids.publicRecord}${query}`);
      await expect(main.getByRole('heading', { name: 'Canonical changes' })).toHaveCount(
        0,
      );
      await expect(main.getByRole('button')).toHaveCount(0);
      await expect(reader.locator('#verify-evidence')).toHaveCount(0);
      await expect(reader.locator('#new-translation-text')).toHaveCount(0);
    }

    // Conflict evidence is SHOWN to a reader, and nothing resolves it.
    await reader.goto(`/admin/hadith/records/${ids.conflictedRecord}`);
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
    await page.goto(`/admin/hadith/records/${ids.publicRecord}`);
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
    await visitor.goto(`${COLLECTION}/1`);
    await expect(visitor.getByRole('main')).toContainText(TEXT.translation);
    await expect(visitor.getByRole('main')).not.toContainText(TEXT.adminTranslation);

    // And the canonical record offers this account no control at all.
    for (const query of ['', '?canonical=1']) {
      await page.goto(`/admin/hadith/records/${ids.canonicalRecord}${query}`);
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
    const recordUrl = `/admin/hadith/records/${ids.canonicalRecord}?canonical=1`;
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
    await page.goto(`/admin/hadith/records/${ids.canonicalRecord}`);
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
    await visitFixture(page, `${COLLECTION}/4`);
    await expect(
      page.locator('[aria-labelledby="hadith-original-text"] p[lang]'),
    ).toHaveText(TEXT.canonical);
    // And its book — where it sits in no chapter — now lists it, by its short
    // canonical address.
    await visitFixture(page, BOOK);
    const listed = page.getByRole('list', { name: 'Citations in this book' });
    await expect(listed.getByRole('listitem')).toHaveCount(1);
    await expect(listed.getByRole('link', { name: citationName(4) })).toHaveAttribute(
      'href',
      `${COLLECTION}/4`,
    );
  });

  test('conflict evidence is shown to the canonical editor, and nothing resolves it', async () => {
    const page = canonical;
    for (const record of [ids.conflictingRecord, ids.conflictedRecord]) {
      await page.goto(`/admin/hadith/records/${record}?canonical=1`);
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
    const blocked = await page.goto(`${COLLECTION}/2`);
    expect(blocked?.status()).toBe(404);
  });
});
