import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  FatwaOwnerPort,
  FatwaPublicationAuthority,
  FatwaWorkflowPort,
} from '../../packages/contracts/src/fatwa/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';
import {
  accountWithRole,
  activate,
  grantFor,
  intents,
  n,
  sessionFor,
} from '../fatwa/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 20 — the published ruling in the Search foundation, over REAL SQL
 * Server Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine:
 *
 *   - while the service is not activated, Fatwa projects nothing;
 *   - once activated, every PUBLIC RULING is ONE result at `/fatwa/{slug}`,
 *     whose one document holds ONLY the current published revision's title,
 *     its separately written public question and the ruling;
 *   - the private question, a return note, a draft that was returned and a
 *     revision still under review are never searchable — and only publication
 *     owes Search anything;
 *   - the kind filter and both halves of the topic rule (the category's topic
 *     and the revision's own) filter results;
 *   - a correction replaces the superseded revision's words once its owed
 *     intent is processed;
 *   - a withdrawn ruling, and every ruling of a service whose activation was
 *     removed, is WITHHELD at query time while its stale rows remain, and the
 *     owed intent, reconciliation or a rebuild then removes those rows;
 *   - query text is data;
 *   - the inventory rebuilds from the owner alone, and reconciliation repairs
 *     a lost projection and an unannounced change and then converges.
 *
 * NOTHING HERE IS A RULING OR A REAL QUESTION. Every text is a
 * `NON_FATWA_FIXTURE_…` sentinel followed by one invented Latin word, so a
 * query can name exactly one text.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

/** One invented word per searchable or deliberately unsearchable text. */
const WORD = {
  /** In every PUBLIC question, and in every private question and draft too. */
  shared: 'saltmeadowfixture',
  title1: 'thornquillfixture',
  public1: 'marshgablefixture',
  ruling1: 'emberwoldfixture',
  privateQuestion: 'cindermoorfixture',
  note: 'wraithmerefixture',
  returned: 'foxgrovefixture',
  pending: 'larchwyndfixture',
  original3: 'morrowfieldfixture',
  corrected3: 'corrimerefixture',
  ruling4: 'brackenholtfixture',
  ruling5: 'harrowdenfixture',
  ruling6: 'quillstonefixture',
} as const;

const SLUG = {
  one: 'fixture-search-ruling-one',
  pending: 'fixture-search-ruling-pending',
  three: 'fixture-search-ruling-three',
  four: 'fixture-search-ruling-four',
  five: 'fixture-search-ruling-five',
  six: 'fixture-search-ruling-six',
} as const;

/** The private question's sentinel prefix — never in any indexed text. */
const PRIVATE_SENTINEL = 'NON_FATWA_FIXTURE_PRIVATE_QUESTION';

const privateQuestion = (index: number) =>
  `${PRIVATE_SENTINEL}_${String(index)} ${WORD.privateQuestion} ${WORD.shared}`;

interface Texts {
  readonly title: string;
  readonly publicQuestion: string;
  readonly ruling: string;
}

/** A revision's public texts: each a sentinel with the given invented words. */
function texts(
  index: number,
  words: { title?: string; publicQuestion?: string; ruling: string },
): Texts {
  return {
    title: [`NON_FATWA_FIXTURE_TITLE_${String(index)}`, words.title].join(' ').trim(),
    publicQuestion: [
      `NON_FATWA_FIXTURE_PUBLIC_QUESTION_${String(index)}`,
      ...(words.publicQuestion === undefined ? [] : [words.publicQuestion]),
      WORD.shared,
    ].join(' '),
    ruling: `NON_FATWA_FIXTURE_RULING_${String(index)} ${words.ruling}`,
  };
}

live('Phase 20 Fatwa in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let owner: FatwaOwnerPort;
  let workflow: FatwaWorkflowPort;

  let receiver: string;
  let answerer: string;
  let publisher: FatwaPublicationAuthority;
  let asker: string;

  const topics = { education: '', ethics: '', peace: '' };
  const categories = { a: randomUUID(), b: randomUUID() };

  /** Ruling ids by name. */
  const f = {
    one: '',
    pending: '',
    three: '',
    four: '',
    five: '',
    six: '',
  };
  const T = {
    one: texts(1, {
      title: WORD.title1,
      publicQuestion: WORD.public1,
      ruling: WORD.ruling1,
    }),
    returned: texts(11, { title: WORD.returned, ruling: WORD.returned }),
    pending: texts(2, { title: WORD.pending, ruling: WORD.pending }),
    three: texts(3, { ruling: WORD.original3 }),
    corrected: texts(13, { ruling: WORD.corrected3 }),
    four: texts(4, { ruling: WORD.ruling4 }),
    five: texts(5, { ruling: WORD.ruling5 }),
    six: texts(6, { ruling: WORD.ruling6 }),
  };

  async function find(q: string, extra: Record<string, string> = {}) {
    const outcome = await h.search.search({ q, ...extra }, { locale: 'en' });
    if (outcome.state !== 'results') {
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    }
    return outcome.results;
  }

  async function found(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.resourceId).sort();
  }

  async function versionOf(fatwaId: string): Promise<number> {
    const [row] = await db.admin.query<{ version: number }>(
      `SELECT [version] FROM [dbo].[Fatwa] WHERE [id] = ${n(fatwaId)};`,
    );
    if (row === undefined) throw new Error('fixture ruling missing');
    return Number(row.version);
  }

  /** The indexed documents of one ruling: `textLanguage/contentLanguage`. */
  async function documentsOf(fatwaId: string): Promise<string[]> {
    const rows = await db.admin.query<{ textLanguage: string; contentLanguage: string }>(
      `SELECT [textLanguage],[contentLanguage] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(fatwaId)}
        ORDER BY [textLanguage];`,
    );
    return rows.map((row) => `${row.textLanguage}/${row.contentLanguage}`);
  }

  async function fatwaDocuments(): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [kind] = N'fatwa';`,
    );
    return Number(row?.total ?? -1);
  }

  /** How many indexed documents hold `text` anywhere in their stored or matching text. */
  async function indexedWith(text: string): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument]
        WHERE CHARINDEX(${n(text.toLowerCase())}, LOWER(CONCAT([title], [summary], [matchEnglish], [matchArabic], [matchUrdu], [matchOther]))) > 0;`,
    );
    return Number(row?.total ?? -1);
  }

  /** A question asked, triaged into `categoryId` and assigned to the answerer. */
  async function assignedQuestion(index: number, categoryId: string): Promise<string> {
    const questionId = randomUUID();
    await owner.submit({
      id: questionId,
      askerId: asker,
      value: { body: privateQuestion(index) },
    });
    await workflow.triage({
      actorId: receiver,
      value: { id: questionId, expectedVersion: 1, categoryId },
    });
    await workflow.assign({
      actorId: receiver,
      value: { id: questionId, expectedVersion: 2, assigneeId: answerer },
    });
    return questionId;
  }

  /** Saves a draft and submits it for review; answers the new revision's id. */
  async function draftAndSubmit(input: {
    readonly fatwaId: string;
    readonly questionId: string;
    readonly expectedVersion: number;
    readonly slug: string;
    readonly categoryId: string;
    readonly topicIds: readonly string[];
    readonly texts: Texts;
    readonly correctionReason?: string;
  }): Promise<string> {
    const revisionId = randomUUID();
    await workflow.saveDraft({
      actorId: answerer,
      fatwaId: input.fatwaId,
      revisionId,
      value: {
        questionId: input.questionId,
        expectedVersion: input.expectedVersion,
        slug: input.slug,
        ...input.texts,
        language: 'en',
        categoryId: input.categoryId,
        topicIds: [...input.topicIds],
        correctionReason: input.correctionReason ?? null,
      },
    });
    await workflow.submitForReview({
      actorId: answerer,
      value: {
        fatwaId: input.fatwaId,
        expectedVersion: input.expectedVersion === 0 ? 2 : input.expectedVersion + 1,
        revisionId,
      },
    });
    return revisionId;
  }

  async function publish(fatwaId: string, revisionId: string): Promise<void> {
    await workflow.publish({
      authority: publisher,
      publicationId: randomUUID(),
      value: { fatwaId, expectedVersion: await versionOf(fatwaId), revisionId },
    });
  }

  /** The whole path from a question to a public ruling, by the proper hands. */
  async function publishedRuling(input: {
    readonly index: number;
    readonly slug: string;
    readonly categoryId: string;
    readonly topicIds: readonly string[];
    readonly texts: Texts;
  }): Promise<string> {
    const questionId = await assignedQuestion(input.index, input.categoryId);
    const fatwaId = randomUUID();
    const revisionId = await draftAndSubmit({
      fatwaId,
      questionId,
      expectedVersion: 0,
      slug: input.slug,
      categoryId: input.categoryId,
      topicIds: input.topicIds,
      texts: input.texts,
    });
    await publish(fatwaId, revisionId);
    return fatwaId;
  }

  async function withdraw(fatwaId: string): Promise<void> {
    await workflow.withdraw({
      authority: publisher,
      value: {
        fatwaId,
        expectedVersion: await versionOf(fatwaId),
        reason: 'NON_FATWA_FIXTURE_REASON withdrawal proof',
      },
    });
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    const database = await import('../../packages/database/src/index.ts');
    owner = database.createFatwaOwner();
    workflow = database.createFatwaWorkflow();

    receiver = (await accountWithRole(db.admin, ['question.receive'])).accountId;
    answerer = (await accountWithRole(db.admin, ['fatwa.answer'])).accountId;
    const publisherId = (await accountWithRole(db.admin, ['fatwa.publish'])).accountId;
    const sessionId = await sessionFor(db.admin, publisherId);
    publisher = {
      actorId: publisherId,
      sessionId,
      stepUpGrantId: await grantFor(
        db.admin,
        publisherId,
        sessionId,
        'fatwa-publication',
        120,
      ),
    };
    asker = await createProofAccount(db.admin);

    for (const slug of ['education', 'ethics', 'peace'] as const) {
      const [row] = await db.admin.query<{ id: string }>(
        `SELECT [id] FROM [dbo].[Topic] WHERE [slug] = ${n(slug)};`,
      );
      if (row === undefined) throw new Error(`The canonical ${slug} topic is missing.`);
      topics[slug] = row.id;
    }
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  }, 120_000);

  describe('before activation', () => {
    it('accepts no question and projects nothing', async () => {
      const refused = await owner
        .submit({
          id: randomUUID(),
          askerId: asker,
          value: { body: privateQuestion(90) },
        })
        .then(
          () => 'accepted',
          (error: unknown) => (error as { reason?: string }).reason,
        );
      expect(refused).toBe('inactive');
      expect(await h.wiring.sources.fatwa.list({ after: null, limit: 100 })).toEqual([]);
      expect(await h.wiring.sources.fatwa.project(randomUUID())).toBeNull();
      expect(await h.wiring.targets.fatwa([randomUUID()])).toEqual(new Map());

      await h.search.rebuild();
      await h.indexNow();
      expect(await fatwaDocuments()).toBe(0);
      expect(await found(WORD.shared, { type: 'fatwa' })).toEqual([]);
    });
  });

  describe('once activated', () => {
    beforeAll(async () => {
      await activate(db.admin, 'fixture');
      await workflow.createCategory({
        actorId: publisher.actorId,
        id: categories.a,
        value: {
          slug: 'fixture-search-category-a',
          topicId: topics.education,
          position: 1,
          names: [{ locale: 'en', name: 'NON_FATWA_FIXTURE_CATEGORY_1' }],
        },
      });
      await workflow.createCategory({
        actorId: publisher.actorId,
        id: categories.b,
        value: {
          slug: 'fixture-search-category-b',
          topicId: topics.ethics,
          position: 2,
          names: [{ locale: 'en', name: 'NON_FATWA_FIXTURE_CATEGORY_2' }],
        },
      });

      // Ruling one: a first draft RETURNED with a private note, then a revised
      // draft — carrying its own topic — published.
      const questionOne = await assignedQuestion(1, categories.a);
      f.one = randomUUID();
      const returned = await draftAndSubmit({
        fatwaId: f.one,
        questionId: questionOne,
        expectedVersion: 0,
        slug: SLUG.one,
        categoryId: categories.a,
        topicIds: [],
        texts: T.returned,
      });
      await workflow.returnForRevision({
        actorId: publisher.actorId,
        value: {
          fatwaId: f.one,
          expectedVersion: 3,
          revisionId: returned,
          note: `NON_FATWA_FIXTURE_NOTE_1 ${WORD.note}`,
        },
      });
      const revised = await draftAndSubmit({
        fatwaId: f.one,
        questionId: questionOne,
        expectedVersion: 4,
        slug: SLUG.one,
        categoryId: categories.a,
        topicIds: [topics.peace],
        texts: T.one,
      });
      await publish(f.one, revised);

      // A ruling still UNDER REVIEW: never published.
      const questionPending = await assignedQuestion(2, categories.b);
      f.pending = randomUUID();
      await draftAndSubmit({
        fatwaId: f.pending,
        questionId: questionPending,
        expectedVersion: 0,
        slug: SLUG.pending,
        categoryId: categories.b,
        topicIds: [topics.peace],
        texts: T.pending,
      });

      f.three = await publishedRuling({
        index: 3,
        slug: SLUG.three,
        categoryId: categories.b,
        topicIds: [],
        texts: T.three,
      });
      f.four = await publishedRuling({
        index: 4,
        slug: SLUG.four,
        categoryId: categories.b,
        topicIds: [],
        texts: T.four,
      });
      f.five = await publishedRuling({
        index: 5,
        slug: SLUG.five,
        categoryId: categories.b,
        topicIds: [],
        texts: T.five,
      });
      f.six = await publishedRuling({
        index: 6,
        slug: SLUG.six,
        categoryId: categories.b,
        topicIds: [],
        texts: T.six,
      });
    }, 300_000);

    it('owes Search one pass per publication and nothing for a draft, a return or a review', async () => {
      for (const id of [f.one, f.three, f.four, f.five, f.six])
        expect(await intents(db.admin, id)).toBe(1);
      expect(await intents(db.admin, f.pending)).toBe(0);
      expect(await fatwaDocuments()).toBe(0);

      await h.indexNow();
      for (const id of [f.one, f.three, f.four, f.five, f.six])
        expect(await documentsOf(id)).toEqual(['en/en']);
      expect(await documentsOf(f.pending)).toEqual([]);
      expect(await fatwaDocuments()).toBe(5);
    });

    it('indexes ONLY the current revision’s title, public question and ruling', async () => {
      const [document] = await db.admin.query<{
        kind: string;
        resourceId: string;
        title: string;
        summary: string;
      }>(
        `SELECT [kind],[resourceId],[title],[summary] FROM [dbo].[SearchDocument]
          WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(f.one)};`,
      );
      expect(document).toEqual({
        kind: 'fatwa',
        resourceId: f.one,
        title: T.one.title,
        summary: T.one.publicQuestion,
      });

      // The public words are there, so the probe itself is proved able to see
      // a word...
      expect(await indexedWith(WORD.title1)).toBe(1);
      expect(await indexedWith(WORD.public1)).toBe(1);
      expect(await indexedWith(WORD.ruling1)).toBe(1);
      expect(await indexedWith(WORD.shared)).toBe(5);
      // ...and no private question, note, returned draft or pending revision is.
      for (const text of [
        PRIVATE_SENTINEL,
        WORD.privateQuestion,
        'NON_FATWA_FIXTURE_NOTE',
        WORD.note,
        WORD.returned,
        WORD.pending,
      ])
        expect(await indexedWith(text), text).toBe(0);
    });

    it('answers ONE result per ruling, at /fatwa/{slug}', async () => {
      for (const word of [WORD.title1, WORD.public1, WORD.ruling1]) {
        const results = await find(word);
        expect(results.hits, word).toHaveLength(1);
        expect(results.hits[0]).toMatchObject({
          kind: 'fatwa',
          resourceId: f.one,
          href: `/fatwa/${SLUG.one}`,
          title: T.one.title,
          summary: T.one.publicQuestion,
          textLanguage: 'en',
          contentLanguage: 'en',
          year: null,
        });
      }

      // The shared word is in every public question — and in every private
      // question and unpublished draft, which add nothing.
      const every = await find(WORD.shared, { type: 'fatwa' });
      expect(every.hits.map((hit) => hit.resourceId).sort()).toEqual(
        [f.one, f.three, f.four, f.five, f.six].sort(),
      );
      expect(new Set(every.hits.map((hit) => hit.href))).toEqual(
        new Set(
          [SLUG.one, SLUG.three, SLUG.four, SLUG.five, SLUG.six].map(
            (slug) => `/fatwa/${slug}`,
          ),
        ),
      );
      expect(every.withheld).toBe(0);
    });

    it('never makes a private question, a return note, a returned draft or a revision under review findable', async () => {
      for (const word of [WORD.privateQuestion, WORD.note, WORD.returned, WORD.pending]) {
        const results = await find(word);
        expect(results.hits, word).toEqual([]);
        expect(results.withheld, word).toBe(0);
        expect(await found(word, { type: 'fatwa' }), word).toEqual([]);
      }
      expect(await found(`${WORD.privateQuestion} ${WORD.shared}`)).toEqual([]);
    });

    it('filters by the fatwa kind and by either half of the topic rule', async () => {
      expect(await found(WORD.ruling1, { type: 'fatwa' })).toEqual([f.one]);
      expect(await found(WORD.ruling1, { type: 'hadith' })).toEqual([]);
      expect(await found(WORD.ruling1, { type: 'article' })).toEqual([]);

      // Category A maps onto education; ruling one's own revision lists peace.
      expect(await found(WORD.ruling1, { type: 'fatwa', topic: 'education' })).toEqual([
        f.one,
      ]);
      expect(await found(WORD.ruling1, { type: 'fatwa', topic: 'peace' })).toEqual([
        f.one,
      ]);
      expect(await found(WORD.ruling1, { type: 'fatwa', topic: 'ethics' })).toEqual([]);

      // Category B maps onto ethics, and its rulings list no topic of their own.
      expect(await found(WORD.shared, { type: 'fatwa', topic: 'ethics' })).toEqual(
        [f.three, f.four, f.five, f.six].sort(),
      );
      expect(await found(WORD.shared, { type: 'fatwa', topic: 'education' })).toEqual([
        f.one,
      ]);
      // The pending revision lists peace; it is not public, so it adds nothing.
      expect(await found(WORD.shared, { type: 'fatwa', topic: 'peace' })).toEqual([
        f.one,
      ]);
    });

    it('treats query text as data: quotes, operators, wildcards and SQL cannot escape', async () => {
      const hostile = [
        `"; DROP TABLE [SearchDocument]; --`,
        `${WORD.ruling1}" OR "*`,
        `NEAR((${WORD.ruling1}, ${WORD.public1}), 5)`,
        `FORMSOF(INFLECTIONAL, ${WORD.ruling1})`,
        `${WORD.ruling1}*`,
        `' OR 1=1 --`,
        `<script>alert(1)</script>`,
        `${WORD.privateQuestion} OR ${WORD.ruling1}`,
      ];
      for (const q of hostile) {
        const outcome = await h.search.search({ q, type: 'fatwa' }, { locale: 'en' });
        expect(['results', 'invalid'], q).toContain(outcome.state);
        if (outcome.state === 'results')
          expect(
            outcome.results.hits.every((hit) => hit.href.startsWith('/fatwa/')),
          ).toBe(true);
      }
      // Operator words are just words, all required: nothing holds "not", and
      // nothing public holds the private question's word.
      expect(await found(`${WORD.ruling1} AND NOT ${WORD.public1}`)).toEqual([]);
      expect(await found(`${WORD.privateQuestion} OR ${WORD.ruling1}`)).toEqual([]);
      for (const raw of [
        { q: 'a b c d e f g h i', type: 'fatwa' },
        { q: 'x'.repeat(201), type: 'fatwa' },
        { q: 'fixture', type: 'fatwa', page: '51' },
      ]) {
        expect((await h.search.search(raw, { locale: 'en' })).state).toBe('invalid');
      }
      expect(await fatwaDocuments()).toBe(5);
      expect(h.reported).toEqual([]);
    });

    describe('a correction replaces, a stale index never discloses', () => {
      it('replaces a corrected ruling’s superseded words once its owed pass runs', async () => {
        const questionThree = await db.admin.query<{ questionId: string }>(
          `SELECT [questionId] FROM [dbo].[Fatwa] WHERE [id] = ${n(f.three)};`,
        );
        const version = await versionOf(f.three);
        const revisionId = await draftAndSubmit({
          fatwaId: f.three,
          questionId: questionThree[0]!.questionId,
          expectedVersion: version,
          slug: SLUG.three,
          categoryId: categories.b,
          topicIds: [],
          texts: T.corrected,
          correctionReason: 'NON_FATWA_FIXTURE_REASON correction proof',
        });
        // Drafted and under review, the correction is nobody's result yet, and
        // owes Search nothing.
        expect(await found(WORD.corrected3)).toEqual([]);
        expect(await found(WORD.original3)).toEqual([f.three]);
        expect(await intents(db.admin, f.three)).toBe(0);

        await publish(f.three, revisionId);
        expect(await intents(db.admin, f.three)).toBe(1);
        // Until the owed pass runs the index still holds the superseded words.
        expect(await indexedWith(WORD.original3)).toBe(1);
        expect(await indexedWith('NON_FATWA_FIXTURE_RULING_3 ')).toBe(1);

        await h.indexNow();
        expect(await found(WORD.original3)).toEqual([]);
        expect(await indexedWith(WORD.original3)).toBe(0);
        expect(await indexedWith('NON_FATWA_FIXTURE_RULING_3 ')).toBe(0);
        const corrected = await find(WORD.corrected3);
        expect(corrected.hits).toHaveLength(1);
        expect(corrected.hits[0]).toMatchObject({
          resourceId: f.three,
          href: `/fatwa/${SLUG.three}`,
          title: T.corrected.title,
          summary: T.corrected.publicQuestion,
        });
        expect(await documentsOf(f.three)).toEqual(['en/en']);
      });

      it('withholds a withdrawn ruling while its stale row remains, then its owed pass drops it', async () => {
        await withdraw(f.four);
        expect(await intents(db.admin, f.four)).toBe(1);

        // Nothing re-indexed yet: the stale row is still there, and the ONLY
        // protection is the owner's query-time visibility recheck.
        expect(await documentsOf(f.four)).toEqual(['en/en']);
        const stale = await find(WORD.ruling4);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);
        expect(await h.wiring.targets.fatwa([f.four, f.five])).toEqual(
          new Map([[f.five, `/fatwa/${SLUG.five}`]]),
        );

        await h.indexNow();
        expect(await documentsOf(f.four)).toEqual([]);
        expect((await find(WORD.ruling4)).withheld).toBe(0);
      });

      it('drops a withdrawn ruling whose owed pass was lost, by reconciliation', async () => {
        await withdraw(f.six);
        // The intent is lost, as an interrupted relay or a manual repair might.
        await db.admin.query(
          `DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(f.six)};`,
        );
        await h.indexNow();
        expect(await documentsOf(f.six)).toEqual(['en/en']);
        const stale = await find(WORD.ruling6);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);

        const summary = await h.search.reconcile();
        expect(summary.orphaned).toBe(1);
        await h.indexNow();
        expect(await documentsOf(f.six)).toEqual([]);
        expect((await find(WORD.ruling6)).withheld).toBe(0);
      });

      it('withholds every ruling while the activation is removed, then reconciles both ways', async () => {
        const indexed = await fatwaDocuments();
        // Rulings one, three and five are public.
        expect(indexed).toBe(3);

        // The activation is immutable; the owner forces its removal on this
        // disposable database so the query-time rule is proved on its own.
        await db.admin.query(
          'ALTER TABLE [dbo].[FatwaActivation] DISABLE TRIGGER [FatwaActivationImmutable];',
        );
        try {
          await db.admin.query('DELETE FROM [dbo].[FatwaActivation];');
        } finally {
          await db.admin.query(
            'ALTER TABLE [dbo].[FatwaActivation] ENABLE TRIGGER [FatwaActivationImmutable];',
          );
        }
        const [trigger] = await db.admin.query<{ disabled: boolean | number }>(
          `SELECT [is_disabled] AS disabled FROM sys.triggers WHERE [name] = N'FatwaActivationImmutable';`,
        );
        expect(Number(trigger?.disabled)).toBe(0);

        expect(await fatwaDocuments()).toBe(indexed);
        const all = await find(WORD.shared, { type: 'fatwa' });
        expect(all.hits).toEqual([]);
        expect(all.withheld).toBe(3);

        const summary = await h.search.reconcile();
        expect(summary.orphaned).toBe(3);
        await h.indexNow();
        expect(await fatwaDocuments()).toBe(0);
        expect((await find(WORD.shared, { type: 'fatwa' })).withheld).toBe(0);

        await activate(db.admin, 'fixture');
        const restored = await h.search.reconcile();
        expect(restored.missing).toBe(3);
        await h.indexNow();
        expect(await fatwaDocuments()).toBe(indexed);
        expect(await found(WORD.shared, { type: 'fatwa' })).toEqual(
          [f.one, f.three, f.five].sort(),
        );
      });
    });

    describe('rebuild and reconciliation', () => {
      it('rebuilds the Fatwa inventory from the owner alone, starting from empty', async () => {
        const before = await fatwaDocuments();
        await db.admin.query(
          `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
           DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
        );
        await h.engineSettled();
        expect(await found(WORD.ruling1)).toEqual([]);

        await h.search.rebuild();
        await h.indexNow();

        expect(await fatwaDocuments()).toBe(before);
        const [inventory] = await db.admin.query<{ kinds: string }>(
          `SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind]) AS kinds
             FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k;`,
        );
        expect(inventory?.kinds).toBe('fatwa,topic');
        expect(await found(WORD.ruling1)).toEqual([f.one]);
        expect(await found(WORD.corrected3)).toEqual([f.three]);
        expect(await found(WORD.ruling5)).toEqual([f.five]);
        expect(await found(WORD.ruling1, { type: 'fatwa', topic: 'peace' })).toEqual([
          f.one,
        ]);
        for (const word of [
          WORD.original3,
          WORD.ruling4,
          WORD.ruling6,
          WORD.privateQuestion,
          WORD.note,
          WORD.returned,
          WORD.pending,
        ])
          expect(await found(word), word).toEqual([]);
        expect(await indexedWith(PRIVATE_SENTINEL)).toBe(0);
      });

      it('reconciles a projection the index lost and one its owner changed unannounced', async () => {
        await db.admin.query(
          `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'fatwa' AND [scopeId] = ${n(f.five)};`,
        );
        // Category B re-mapped onto another Topic with no request at all, as a
        // restore or a manual repair might: only the owner's stamp — which
        // covers the category's topic — can tell reconciliation.
        await db.admin.query(
          `UPDATE [dbo].[FatwaCategory] SET [topicId] = ${n(topics.peace)}, [version] = [version] + 1
            WHERE [id] = ${n(categories.b)};`,
        );
        await h.engineSettled();
        expect(await found(WORD.ruling5)).toEqual([]);
        expect(await found(WORD.corrected3, { type: 'fatwa', topic: 'peace' })).toEqual(
          [],
        );

        const summary = await h.search.reconcile();
        expect(summary.missing).toBe(1);
        expect(summary.stale).toBe(1);
        await h.indexNow();
        expect(await found(WORD.ruling5, { type: 'fatwa', topic: 'peace' })).toEqual([
          f.five,
        ]);
        expect(await found(WORD.corrected3, { type: 'fatwa', topic: 'peace' })).toEqual([
          f.three,
        ]);
        expect(await found(WORD.corrected3, { type: 'fatwa', topic: 'ethics' })).toEqual(
          [],
        );

        // Converged: nothing left to repair.
        expect(await h.search.reconcile()).toMatchObject({
          missing: 0,
          stale: 0,
          orphaned: 0,
        });
      });
    });
  });

  it('reports no swallowed failure', () => {
    expect(h.reported).toEqual([]);
  });
});
