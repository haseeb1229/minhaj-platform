import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 17 — the Search foundation over REAL SQL Server Full-Text Search.
 *
 * WHAT ONLY A LIVE ENGINE CAN PROVE. Tokenisation, ranking, the full-text
 * grammar the adapter composes, the asynchronous population window, and the
 * interaction of owner transactions with indexing intent are properties of SQL
 * Server, not of this code's intentions. Every claim below is made against the
 * engine, through the real owners' own mutations.
 *
 * THE ARABIC AND URDU FIXTURES ARE ORDINARY PROSE about libraries and reading
 * rooms. They are not Quran, Hadith or any religious text, and none is
 * presented as authoritative content.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

const doc = (...paragraphs: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  });

function content(input: {
  readonly slug?: string;
  readonly language: 'en' | 'ur' | 'ar';
  readonly title: string;
  readonly excerpt: string;
  readonly body: readonly string[];
  readonly topicIds?: readonly string[];
}) {
  return {
    slug: input.slug ?? `search-proof-${randomUUID().slice(0, 8)}`,
    primaryLanguage: input.language,
    translations: [
      {
        languageCode: input.language,
        title: input.title,
        excerpt: input.excerpt,
        seoTitle: '',
        seoDescription: '',
        document: doc(...input.body),
      },
    ],
    topicIds: [...(input.topicIds ?? [])],
    contributors: [],
  };
}

live('Phase 17 Search foundation against real SQL Server FTS', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let author: { accountId: string };
  let reviewer: { accountId: string };
  let publisher: { accountId: string };
  let librarian: { accountId: string };
  let people: Phase5Fixture;
  let educationTopic: string;

  const personActor = {
    actorId: null,
    actorType: 'system' as const,
    authorisingSource: 'people.administer',
    auditAction: 'people.person.proof',
  };

  /** Create → submit → approve → publish, through the real workflow. */
  async function publish(
    kind: 'article' | 'page',
    value: ReturnType<typeof content>,
    binding: string | null = null,
  ) {
    let record = await h.editorial.create(author, kind, value, binding);
    for (const [actor, action] of [
      [author, 'submit'],
      [reviewer, 'approve'],
      [publisher, 'publish'],
    ] as const) {
      record = await h.editorial.transition(actor, kind, {
        id: record.id,
        expectedVersion: record.version,
        action,
        scheduledAt: null,
        timezone: null,
      });
    }
    return record;
  }

  async function archive(kind: 'article' | 'page', id: string, version: number) {
    return h.editorial.transition(publisher, kind, {
      id,
      expectedVersion: version,
      action: 'archive',
      scheduledAt: null,
      timezone: null,
    });
  }

  async function find(q: string, extra: Record<string, string> = {}) {
    const outcome = await h.search.search({ q, ...extra }, { locale: 'en' });
    if (outcome.state !== 'results') {
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    }
    return outcome.results;
  }

  async function titles(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.title);
  }

  /** Makes every pending or retrying scope due now — the test's clock. */
  async function timeTravel() {
    await db.admin.query(
      `UPDATE [dbo].[SearchIndexScope] SET [dueAt] = DATEADD(SECOND, -1, SYSUTCDATETIME()),
         [leaseUntil] = CASE WHEN [leaseUntil] IS NULL THEN NULL ELSE DATEADD(SECOND, -1, SYSUTCDATETIME()) END;`,
    );
  }

  let arabic: { id: string; version: number };
  let mixed: { id: string; version: number };
  let guide: { id: string; version: number };
  let personId: string;
  let workId: string;
  let englishEditionId: string;
  let urduEditionId: string;

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);

    author = await h.account(['content.author', 'content.read']);
    reviewer = await h.account(['content.review', 'content.read']);
    publisher = await h.account(['content.publish', 'content.read']);
    librarian = await h.account(['library.administer', 'library.read']);

    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);

    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    educationTopic = topic.id;

    arabic = await publish(
      'article',
      content({
        language: 'ar',
        title: 'دليل تجريبي: المكتبة العامة في المدينة',
        excerpt: 'نص تجريبي غير موثوق عن قاعة القراءة',
        body: ['تفتح المكتبة العامة أبوابها للقراء كل صباح.', 'نص تجريبي للاختبار فقط.'],
      }),
    );
    await publish(
      'article',
      content({
        language: 'ur',
        title: 'آزمائشی متن: شہر کا کتب خانہ',
        excerpt: 'کتب خانے میں نئی کتابیں آئی ہیں',
        body: [
          'طلبہ کے لیے تعلیمِ نسواں پر ایک حصہ ہے۔',
          'شہر کی لائبریری ہفتے کے دن بند رہتی ہے۔',
        ],
        topicIds: [educationTopic],
      }),
    );
    mixed = await publish(
      'article',
      content({
        language: 'en',
        title: 'Synthetic mixed-script catalogue note',
        excerpt: 'A non-authoritative fixture.',
        body: ['The catalogue lists a کتاب and a مكتبة entry for the proof.'],
      }),
    );
    guide = await publish(
      'page',
      content({
        slug: `search-proof-guide-${randomUUID().slice(0, 8)}`,
        language: 'en',
        title: 'Synthetic guide to reading rooms',
        excerpt: 'How the fixture reading rooms work.',
        body: ['Libraries open reading rooms for students and researchers.'],
      }),
      'help-article',
    );

    const person = await h.peopleStore.createPerson({
      ...personActor,
      slug: `search-proof-person-${randomUUID().slice(0, 8)}`,
      primaryLocale: 'en',
      name: 'Synthetic Contributor Qasimabadi',
      biography: 'A fixture contributor with no real-world counterpart.',
    });
    personId = person.id;
    await h.peopleStore.addNameVariant({
      ...personActor,
      personId,
      locale: 'en',
      value: 'Qasimabadi Fixturewala',
    });
    await h.peopleStore.setPersonStatus({
      ...personActor,
      personId,
      status: 'published',
    });

    const work = await h.library.saveWork(librarian, null, null, {
      slug: `search-proof-work-${randomUUID().slice(0, 8)}`,
      primaryLocale: 'en',
      state: 'published',
      isFeatured: false,
      labels: [
        {
          locale: 'en',
          title: 'Synthetic Reading Room Handbook',
          description: 'A non-authoritative handbook fixture.',
        },
        { locale: 'ar', title: 'دليل قاعة القراءة التجريبي', description: '' },
      ],
      contributors: [],
      topicIds: [educationTopic],
      salePointIds: [],
    });
    workId = work.id;
    const edition = {
      workId,
      state: 'published' as const,
      pageCount: null,
      reading: 'unavailable' as const,
      download: 'denied' as const,
      readableAssetId: null,
      downloadAssetId: null,
      document: null,
    };
    const english = await h.library.saveEdition(librarian, null, null, {
      ...edition,
      label: 'English fixture edition',
      languageCode: 'en',
      publisher: 'Synthetic Press',
      publicationYear: 2019,
      isbn: null,
    });
    englishEditionId = english.id;
    const translated = await h.library.saveEdition(librarian, null, null, {
      ...edition,
      label: 'Urdu fixture translation',
      languageCode: 'ur',
      publisher: null,
      publicationYear: 2021,
      isbn: null,
    });
    urduEditionId = translated.id;
    await h.library.saveTranslation(librarian, {
      editionId: urduEditionId,
      expectedVersion: translated.version,
      sourceEditionId: englishEditionId,
      translatorIds: [people.historicalPersonId],
    });

    // The canonical topics and the Phase-5 contributors were written by a
    // migration and a direct fixture, not by owner mutations, so nothing owes
    // them indexing yet. A rebuild is exactly how pre-existing authoritative
    // state enters a new index.
    await h.search.rebuild();
    await h.indexNow();
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  it('commits indexing intent inside the owners own transactions', async () => {
    // Every owner mutation above left its request, and the indexer consumed them.
    const [row] = await db.admin.query<{ requests: number; scopes: number }>(
      `SELECT (SELECT COUNT(*) FROM [dbo].[SearchIndexRequest]) AS requests,
              (SELECT COUNT(*) FROM [dbo].[SearchIndexScope] WHERE [status] = N'current') AS scopes;`,
    );
    expect(Number(row?.requests)).toBe(0);
    expect(Number(row?.scopes)).toBeGreaterThan(20);
    expect(h.reported).toEqual([]);
  });

  it('finds every kind in the initial inventory, each at its current canonical address', async () => {
    const byKind = async (q: string, type: string) =>
      (await find(q, { type })).hits.map((hit) => hit.href);

    expect(await byKind('education', 'topic')).toContain('/topics/education');
    expect((await byKind('Fixturewala', 'person'))[0]).toMatch(
      /^\/people\/search-proof-person-/,
    );
    expect((await byKind('مكتبة', 'article'))[0]).toMatch(/^\/library\/articles\//);
    expect((await byKind('reading rooms', 'page'))[0]).toMatch(
      /^\/help\/search-proof-guide-/,
    );
    expect((await byKind('handbook', 'work'))[0]).toMatch(
      /^\/library\/books\/search-proof-work-/,
    );
    expect(await byKind('handbook', 'edition')).toEqual([
      expect.stringContaining(`?edition=${englishEditionId}`),
    ]);
    expect(await byKind('handbook', 'book-translation')).toEqual([
      expect.stringContaining(`?edition=${urduEditionId}`),
    ]);
  });

  it('shows one result per resource, in the reader interface language when it matched', async () => {
    await h.peopleStore.setPersonTranslation({
      ...personActor,
      personId,
      locale: 'ur',
      name: 'آزمائشی Qasimabadi',
      biography: null,
    });
    await h.indexNow();

    const read = async (locale: 'en' | 'ur') => {
      const outcome = await h.search.search(
        { q: 'Qasimabadi', type: 'person' },
        { locale },
      );
      return outcome.state === 'results'
        ? outcome.results.hits.map((hit) => hit.title)
        : [];
    };

    // The shorter Urdu record ranks higher on its own; an English reader still
    // sees the English name, and each reader sees exactly one result.
    expect(await read('en')).toEqual(['Synthetic Contributor Qasimabadi']);
    expect(await read('ur')).toEqual(['آزمائشی Qasimabadi']);
  });

  describe('Arabic and Urdu tokenisation — measured, not assumed', () => {
    it('Arabic: definite article, attached prepositions, ة/ه and harakat', async () => {
      for (const q of ['مكتبة', 'المكتبة', 'مكتبه', 'قراء', 'الْمَكْتَبَةُ', 'مكت']) {
        expect(await titles(q, { type: 'article' }), q).toContain(
          'دليل تجريبي: المكتبة العامة في المدينة',
        );
      }
    });

    it('Urdu: whole words, prefixes, izafat and a common loanword', async () => {
      const title = 'آزمائشی متن: شہر کا کتب خانہ';
      for (const q of ['کتابیں', 'کتاب', 'تعلیم', 'تعلیمِ', 'لائبریری', 'کتابیں طلبہ']) {
        expect(await titles(q, { type: 'article' }), q).toContain(title);
      }
      // Every term must match: an unrelated second word narrows to nothing.
      expect(await titles('کتابیں zebrafixture')).toEqual([]);
    });

    it('English: inflection and prefixes', async () => {
      expect(await titles('library', { type: 'page' })).toEqual([
        'Synthetic guide to reading rooms',
      ]);
      expect(await titles('librar', { type: 'page' })).toEqual([
        'Synthetic guide to reading rooms',
      ]);
    });

    it('mixed script: Urdu and Arabic words inside an English document', async () => {
      expect(await titles('کتاب', { language: 'en' })).toContain(
        'Synthetic mixed-script catalogue note',
      );
      expect(await titles('مكتبة', { language: 'en' })).toContain(
        'Synthetic mixed-script catalogue note',
      );
    });

    it('records the known limitation: Arabic-letter yeh does not match Urdu yeh', async () => {
      // "نئی" is written with the Farsi/Urdu yeh (U+06CC). Typed with the Arabic
      // yeh (U+064A) it is a different word to every SQL Server breaker —
      // recorded in TECH_STACK.md §10 rather than papered over.
      expect(await titles('نئی', { type: 'article' })).toContain(
        'آزمائشی متن: شہر کا کتب خانہ',
      );
      expect(await titles('نئي', { type: 'article' })).toEqual([]);
    });
  });

  describe('filters', () => {
    it('combine: type, topic, content language and publication year', async () => {
      const topicAll = await find('handbook', { topic: 'education' });
      expect(topicAll.hits.map((hit) => hit.kind).sort()).toEqual([
        'book-translation',
        'edition',
        'work',
      ]);

      // Content language selects content in that language — never a Work,
      // which has none, and never a Topic label.
      expect(
        (await find('handbook', { language: 'ur' })).hits.map((hit) => hit.kind),
      ).toEqual(['book-translation']);

      // A genuine publication year; the undated Work is not in a year range.
      expect(
        (await find('handbook', { from: '2020' })).hits.map((hit) => hit.kind),
      ).toEqual(['book-translation']);
      expect(
        (await find('handbook', { from: '2018', to: '2019' })).hits.map(
          (hit) => hit.kind,
        ),
      ).toEqual(['edition']);

      expect(
        (await find('کتاب', { topic: 'education', type: 'article' })).hits.map(
          (h) => h.title,
        ),
      ).toEqual(['آزمائشی متن: شہر کا کتب خانہ']);
    });

    it('refuses an unknown topic rather than quietly ignoring it', async () => {
      const outcome = await h.search.search(
        { q: 'handbook', topic: 'no-such-topic-anywhere' },
        { locale: 'en' },
      );
      expect(outcome.state).toBe('invalid');
    });
  });

  it('treats query text as data: quotes, operators, wildcards and SQL cannot escape', async () => {
    const hostile = [
      `"; DROP TABLE [SearchDocument]; --`,
      `handbook" OR "*`,
      `NEAR((handbook, room), 5)`,
      `FORMSOF(INFLECTIONAL, handbook)`,
      `handbook*`,
      `ISABOUT(handbook WEIGHT(1.0))`,
      `' OR 1=1 --`,
      `<script>alert(1)</script>`,
      `handbook AND NOT room`,
    ];
    for (const q of hostile) {
      const outcome = await h.search.search({ q }, { locale: 'en' });
      expect(['results', 'invalid'], q).toContain(outcome.state);
    }
    expect(h.reported).toEqual([]);
    const [table] = await db.admin.query<{ id: number | null }>(
      "SELECT OBJECT_ID(N'[dbo].[SearchDocument]') AS id;",
    );
    expect(table?.id).not.toBeNull();
    // Operator words are just words: "handbook AND NOT room" is three terms, all
    // required, and no document holds "not" — the grammar did not negate.
    expect(await titles('handbook AND NOT room')).toEqual([]);
  });

  it('pages deterministically and within the ceiling', async () => {
    const first = await find('fixture');
    const again = await find('fixture');
    expect(again.hits.map((hit) => hit.resourceId)).toEqual(
      first.hits.map((hit) => hit.resourceId),
    );
    expect(first.hits.length).toBeLessThanOrEqual(20);
    const beyond = await h.search.search({ q: 'fixture', page: '51' }, { locale: 'en' });
    expect(beyond.state).toBe('invalid');
  });

  describe('a stale index never discloses', () => {
    it('Editorial: a withdrawn Article is withheld before its removal is processed', async () => {
      const sentinel = await publish(
        'article',
        content({
          language: 'en',
          title: 'Synthetic withdrawal sentinel zephyrinefixture',
          excerpt: 'Must never outlive its withdrawal.',
          body: ['zephyrinefixture withdrawn payload'],
        }),
      );
      await h.indexNow();
      expect(await titles('zephyrinefixture')).toEqual([
        'Synthetic withdrawal sentinel zephyrinefixture',
      ]);

      // The owner withdraws it. Its removal is OWED — the request committed with
      // the archive — but deliberately NOT processed yet: the index is stale.
      await archive('article', sentinel.id, sentinel.version);
      const [stale] = await db.admin.query<{ documents: number }>(
        `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [resourceId] = N'${sentinel.id}';`,
      );
      expect(Number(stale?.documents)).toBe(1);

      const results = await find('zephyrinefixture');
      expect(results.hits).toEqual([]);
      expect(results.withheld).toBe(1);

      await h.indexNow();
      const [gone] = await db.admin.query<{ documents: number }>(
        `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [resourceId] = N'${sentinel.id}';`,
      );
      expect(Number(gone?.documents)).toBe(0);
      expect((await find('zephyrinefixture')).withheld).toBe(0);
    });

    it('Editorial: revising a published Page takes it offline, and search follows', async () => {
      const page = await h.editorial.detail(publisher, 'page', guide.id);
      await h.editorial.revise(author, 'page', guide.id, page.version, {
        ...content({
          slug: page.slug,
          language: 'en',
          title: 'Synthetic guide to reading rooms (revised)',
          excerpt: 'Revised.',
          body: ['Revised text.'],
        }),
      });
      expect(await titles('library', { type: 'page' })).toEqual([]);
      await h.indexNow();
      expect(await titles('library', { type: 'page' })).toEqual([]);
    });

    it('Library: an archived Work withholds itself and every Edition', async () => {
      const work = await h.library.work(librarian, workId);
      if (work === null) throw new Error('fixture work missing');
      await h.library.saveWork(librarian, workId, work.version, {
        slug: work.slug,
        primaryLocale: work.primaryLocale,
        state: 'archived',
        isFeatured: false,
        labels: work.labels,
        contributors: work.contributors,
        topicIds: work.topicIds,
        salePointIds: work.salePointIds,
      });

      const stale = await find('handbook');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBe(3);

      await h.indexNow();
      const [left] = await db.admin.query<{ documents: number }>(
        `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'work' AND [scopeId] = N'${workId}';`,
      );
      expect(Number(left?.documents)).toBe(0);

      // Restored, it returns — restore is a transition search follows too.
      const archived = await h.library.work(librarian, workId);
      if (archived === null) throw new Error('fixture work missing');
      await h.library.saveWork(librarian, workId, archived.version, {
        slug: archived.slug,
        primaryLocale: archived.primaryLocale,
        state: 'published',
        isFeatured: false,
        labels: archived.labels,
        contributors: archived.contributors,
        topicIds: archived.topicIds,
        salePointIds: archived.salePointIds,
      });
      await h.indexNow();
      expect((await find('handbook')).hits).toHaveLength(3);
    });

    it('People: an archived Person is withheld before removal is processed', async () => {
      await h.peopleStore.setPersonStatus({
        ...personActor,
        personId,
        status: 'archived',
      });
      const stale = await find('Fixturewala');
      expect(stale.hits).toEqual([]);
      expect(stale.withheld).toBe(1);
      await h.peopleStore.setPersonStatus({
        ...personActor,
        personId,
        status: 'published',
      });
      await h.indexNow();
      expect((await find('Fixturewala')).hits).toHaveLength(1);
    });
  });

  it('indexes nothing private: no account, no email, no correspondence', async () => {
    const { createCorrespondencePersistence } =
      await import('../../packages/database/src/index.ts');
    await createCorrespondencePersistence().submitContact({
      name: 'Synthetic Sender',
      email: 'quillonsentinel@proof.invalid',
      subject: 'quillonsentinel subject',
      body: 'quillonsentinel private correspondence body',
      retainUntil: new Date(Date.now() + 86_400_000),
    });
    await h.search.rebuild();
    await h.indexNow();

    const [leak] = await db.admin.query<{ rows: number }>(
      `SELECT COUNT(*) AS rows FROM [dbo].[SearchDocument]
       WHERE CONCAT([title], N' ', [summary], N' ', [matchEnglish], [matchArabic], [matchUrdu], [matchOther])
             LIKE N'%quillonsentinel%'
          OR CONCAT([title], N' ', [summary], N' ', [matchEnglish], [matchArabic], [matchUrdu], [matchOther])
             LIKE N'%${people.accountEmail}%'
          OR CONCAT([title], N' ', [summary], N' ', [matchEnglish], [matchArabic], [matchUrdu], [matchOther])
             LIKE N'%${people.accountId}%';`,
    );
    expect(Number(leak?.rows)).toBe(0);
    expect((await find('quillonsentinel')).hits).toEqual([]);

    // The linked contributor IS public, and IS found — by name, not account.
    const [linked] = await db.admin.query<{ documents: number }>(
      `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [resourceId] = N'${people.linkedPersonId}';`,
    );
    expect(Number(linked?.documents)).toBeGreaterThan(0);
  });

  describe('reliability', () => {
    it('a failed write after publication is visible, retried, and never duplicates', async () => {
      h.failNextWrites(1);
      const record = await publish(
        'article',
        content({
          language: 'en',
          title: 'Synthetic retry proof lanternfixture',
          excerpt: 'Indexed only on the second attempt.',
          body: ['lanternfixture'],
        }),
      );
      await h.search.processDue({ budgetMs: 10_000 });

      // Publication was NOT rolled back: the owner still publishes it.
      expect(await h.readers.editorial.searchArticle(record.id)).not.toBeNull();
      const failing = await h.index.status({ failureLimit: 10 });
      expect(failing.retrying).toBeGreaterThanOrEqual(1);
      expect(
        failing.failures.some(
          (failure) =>
            failure.id === record.id &&
            failure.category === 'index-write-failed' &&
            !failure.exhausted,
        ),
      ).toBe(true);
      expect(h.reported).toContain('search.index.index-write-failed');
      await h.engineSettled();
      expect(await titles('lanternfixture')).toEqual([]);

      await timeTravel();
      await h.indexNow();
      expect(await titles('lanternfixture')).toEqual([
        'Synthetic retry proof lanternfixture',
      ]);

      // Processing the same scope again is idempotent: still exactly one document.
      await h.index.request([{ kind: 'article', id: record.id }]);
      await h.indexNow();
      const [count] = await db.admin.query<{ documents: number }>(
        `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [resourceId] = N'${record.id}';`,
      );
      expect(Number(count?.documents)).toBe(1);
    });

    it('exhausts bounded retry, waits for an operator, and recovers on retry', async () => {
      h.failNextWrites(100);
      const record = await publish(
        'article',
        content({
          language: 'en',
          title: 'Synthetic exhaustion proof emberfixture',
          excerpt: 'Fails until an operator acts.',
          body: ['emberfixture'],
        }),
      );
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await timeTravel();
        await h.search.processDue({ budgetMs: 10_000 });
      }
      const status = await h.index.status({ failureLimit: 10 });
      expect(status.failed).toBe(1);
      expect(status.failures.find((failure) => failure.id === record.id)?.exhausted).toBe(
        true,
      );

      h.failNextWrites(0);
      expect(await h.search.retryFailed()).toBe(1);
      await h.indexNow();
      expect(await titles('emberfixture')).toEqual([
        'Synthetic exhaustion proof emberfixture',
      ]);
      expect((await h.index.status({ failureLimit: 1 })).failed).toBe(0);
    });

    it('recovers a scope whose worker crashed holding its lease', async () => {
      const record = await publish(
        'article',
        content({
          language: 'en',
          title: 'Synthetic crash proof cinderfixture',
          excerpt: 'Its first worker never came back.',
          body: ['cinderfixture'],
        }),
      );
      await h.index.relay(500);
      const claims = await h.index.claim({ limit: 100, leaseSeconds: 600 });
      expect(claims.some((claim) => claim.id === record.id)).toBe(true);
      // The worker "crashes": nothing settles the claim. While the lease holds,
      // nobody else can take the scope.
      expect((await h.index.claim({ limit: 100, leaseSeconds: 60 })).length).toBe(0);

      await timeTravel(); // the lease expires
      await h.indexNow();
      expect(await titles('cinderfixture')).toEqual([
        'Synthetic crash proof cinderfixture',
      ]);
    });

    it('never marks a scope current when a newer change arrived mid-projection', async () => {
      await h.index.request([{ kind: 'article', id: mixed.id }]);
      await h.index.relay(500);
      const [claim] = await h.index.claim({ limit: 1, leaseSeconds: 60 });
      if (claim === undefined) throw new Error('nothing claimed');

      // A newer change is requested and relayed while the claim is in flight.
      await h.index.request([{ kind: claim.kind, id: claim.id }]);
      await h.index.relay(500);

      expect(await h.index.apply(claim, { stamp: null, documents: [] })).toBe(
        'superseded',
      );
      const [state] = await db.admin.query<{ status: string }>(
        `SELECT [status] FROM [dbo].[SearchIndexScope] WHERE [scopeKind] = N'${claim.kind}' AND [scopeId] = N'${claim.id}';`,
      );
      expect(state?.status).toBe('pending');
      await h.indexNow();
      expect(await titles('مكتبة', { language: 'en' })).toContain(
        'Synthetic mixed-script catalogue note',
      );
    });
  });

  describe('rebuild and reconciliation', () => {
    it('rebuilds the public inventory from authoritative owners, starting from empty', async () => {
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
         DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
      );
      await h.engineSettled();
      expect(await titles('handbook')).toEqual([]);

      await h.search.rebuild();
      await h.indexNow();

      const [inventory] = await db.admin.query<{ topics: number; kinds: string }>(
        `SELECT (SELECT COUNT(DISTINCT [resourceId]) FROM [dbo].[SearchDocument] WHERE [kind] = N'topic') AS topics,
                (SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind])
                   FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k) AS kinds;`,
      );
      expect(Number(inventory?.topics)).toBe(19);
      // EXACTLY the public inventory. The fixture's only Page was revised back
      // to draft above, so a correct rebuild restores no `page` at all.
      expect(inventory?.kinds).toBe('article,book-translation,edition,person,topic,work');
      expect((await find('handbook')).hits).toHaveLength(3);
      expect(await titles('lanternfixture')).toEqual([
        'Synthetic retry proof lanternfixture',
      ]);
      // Withdrawn and unpublished content stays absent after a rebuild.
      expect(await titles('zephyrinefixture')).toEqual([]);
      expect(await titles('library', { type: 'page' })).toEqual([]);
    });

    it('reconciles missing, stale and orphaned projections', async () => {
      // MISSING: the index lost an Article's documents without being told.
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'article' AND [scopeId] = N'${arabic.id}';`,
      );
      // STALE: a Topic translation changed with no request (as a restore might).
      await db.admin.query(
        `UPDATE [dbo].[TopicTranslation] SET [name] = N'Education quartzfixture', [updatedAt] = SYSUTCDATETIME()
         WHERE [topicId] = N'${educationTopic}' AND [locale] = N'en';`,
      );
      // ORPHAN: the owner withdrew a Work with no request.
      await db.admin.query(
        `UPDATE [dbo].[Work] SET [state] = N'archived' WHERE [id] = N'${workId}';`,
      );

      const summary = await h.search.reconcile();
      expect(summary.missing).toBeGreaterThanOrEqual(1);
      expect(summary.stale).toBeGreaterThanOrEqual(1);
      expect(summary.orphaned).toBeGreaterThanOrEqual(1);

      await h.indexNow();
      expect(await titles('مكتبة', { type: 'article', language: 'ar' })).toEqual([
        'دليل تجريبي: المكتبة العامة في المدينة',
      ]);
      expect(await titles('quartzfixture', { type: 'topic' })).toEqual([
        'Education quartzfixture',
      ]);
      const [orphans] = await db.admin.query<{ documents: number }>(
        `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'work' AND [scopeId] = N'${workId}';`,
      );
      expect(Number(orphans?.documents)).toBe(0);
    });

    it('reports honest operator status', async () => {
      const status = await h.index.status({ failureLimit: 5 });
      expect(status.pending).toBe(0);
      expect(status.failed).toBe(0);
      expect(status.enginePending).toBe(0);
      expect(status.documents).toBeGreaterThan(20);
      expect(status.lastIndexedAt).toBeInstanceOf(Date);
      expect(status.oldestPendingAt).toBeNull();
    });
  });
});
