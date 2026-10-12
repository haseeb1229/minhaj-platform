import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  HadithCanonicalPort,
  HadithPublicReaderPort,
  RecordCorrectionValue,
  RecordCreateValue,
} from '../../packages/contracts/src/hadith/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  activate,
  canonicalEditor,
  deactivateAll,
  intents,
  n,
  NEUTRAL,
  registerEdition,
  registerSourceSystem,
  sentinel,
  type FixtureAuthority,
} from '../hadith/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 19 — the Hadith citation in the Search foundation, over REAL SQL Server
 * Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine:
 *
 *   - while no collection is activated, Hadith projects nothing, however much is
 *     mapped, verified and published;
 *   - once activated, every PUBLIC CITATION is ONE result at its permanent
 *     address `/hadith/{collection}/{number}` — its original text and each
 *     public translation language are documents of that one result, so a query
 *     matching the original and a translation, or two translations, is never
 *     duplicated, and another edition's variant of the same number is never a
 *     result of its own;
 *   - chains, gradings, graders and commentary are never searchable;
 *   - a citation made conflicted, unverified (by a correction), withdrawn,
 *     inactive, or fixture-sourced under an approved section is WITHHELD at
 *     query time while its stale rows are still indexed — and the owed intent,
 *     a rebuild or reconciliation then removes those rows;
 *   - query text is data;
 *   - the inventory rebuilds from the owner alone and reconciliation repairs a
 *     lost or silently changed projection.
 *
 * NOTHING HERE IS A HADITH. Every original is a `NON_HADITH_FIXTURE_TEXT_n`
 * sentinel, the neutral Arabic phrase "test text" and one invented Latin word
 * so a query can name exactly one citation; translations, chains, gradings and
 * commentary are sentinels with invented words of their own.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

/** One invented word per searchable or deliberately unsearchable text. */
const WORD = {
  original1: 'quillmerefixture',
  original2: 'pendlewickfixture',
  original3: 'morrowdenfixture',
  corrected3: 'corriganmerefixture',
  original4: 'brackfoldfixture',
  original5: 'harrowgatefixture',
  translation: 'lanterncroftfixture',
  variant: 'varnhollowfixture',
  chain: 'chainmarrowfixture',
  grading: 'gradewhistlefixture',
  grader: 'graderfenfixture',
  commentary: 'glossbarrowfixture',
  reconciled: 'nettlecombefixture',
} as const;

/** Urdu interface-prose words, never scripture: "test", "text". */
const URDU_TEST = 'آزمائشی';
const URDU_TEXT = 'متن';

const COLLECTION = 'fixture-collection-a';

const original = (index: number, word: string) =>
  `${sentinel('TEXT', index)} ${NEUTRAL} ${word}`;

live('Phase 19 Hadith in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let canonical: HadithCanonicalPort;
  let reader: HadithPublicReaderPort;
  let hadith: Awaited<ReturnType<typeof buildHadithService>>;
  let editor: FixtureAuthority;
  let sourceOne: string;
  let administrator: { accountId: string };

  let collectionId: string;
  let editionOne: string;
  let editionTwo: string;
  let bookOne: string;
  let bookTwo: string;
  /** Record ids by citation number; `variant` is citation 1's other-edition twin. */
  const records: Record<number | 'variant', string> = {} as Record<
    number | 'variant',
    string
  >;
  /** Citation ids by number. */
  const citations: Record<number, string> = {};

  async function buildHadithService() {
    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createAuthorizationService } =
      await import('../../packages/server-core/src/authorization/index.ts');
    const { createHadithService } =
      await import('../../apps/web/src/contexts/hadith/index.ts');
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    return createHadithService({
      persistence: database.createHadithPersistence(),
      authority: {
        permits: (id, key) => authorization.hasPermission(id, key),
        // The administrative service never asks; canonical writes below go
        // through the database procedures with a real step-up grant.
        verifyCanonical: async () => false,
      },
    });
  }

  async function find(
    q: string,
    extra: Record<string, string> = {},
    locale: 'en' | 'ur' | 'ar' = 'en',
  ) {
    const outcome = await h.search.search({ q, ...extra }, { locale });
    if (outcome.state !== 'results') {
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    }
    return outcome.results;
  }

  async function found(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.resourceId).sort();
  }

  /** The indexed documents of one citation scope: `textLanguage/contentLanguage`. */
  async function documentsOf(citationId: string): Promise<string[]> {
    const rows = await db.admin.query<{ textLanguage: string; contentLanguage: string }>(
      `SELECT [textLanguage],[contentLanguage] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(citationId)}
        ORDER BY [textLanguage];`,
    );
    return rows.map((row) => `${row.textLanguage}/${row.contentLanguage}`);
  }

  async function count(table: string): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[${table}];`,
    );
    return Number(row?.total ?? 0);
  }

  async function hadithDocuments(): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [kind] = N'hadith';`,
    );
    return Number(row?.total ?? -1);
  }

  const record = (
    over: Pick<RecordCreateValue, 'sourceReference' | 'citationNumber' | 'text'> &
      Partial<RecordCreateValue>,
  ): RecordCreateValue => ({
    editionId: editionOne,
    bookId: bookOne,
    chapterId: null,
    textLanguage: 'ar',
    chain: null,
    chainLanguage: null,
    gradings: [],
    evidence: sentinel('EVIDENCE', 1),
    ...over,
  });

  async function verify(id: string, expectedVersion = 1) {
    await canonical.verifyRecord({
      authority: editor,
      value: { id, expectedVersion, evidence: sentinel('EVIDENCE', 2) },
    });
  }

  async function publishTranslation(
    hadithId: string,
    languageCode: string,
    text: string,
  ) {
    const created = await hadith.createTranslation(administrator, {
      hadithId,
      value: {
        languageCode,
        text,
        attribution: null,
        sourceSystemId: sourceOne,
        contributors: [],
      },
    });
    return hadith.setTranslationState(administrator, {
      id: created.id,
      expectedVersion: created.version,
      state: 'published',
    });
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    const database = await import('../../packages/database/src/index.ts');
    canonical = database.createHadithCanonical();
    reader = database.createHadithPublicReader();
    hadith = await buildHadithService();

    // What only the operator registers: the source systems and editions.
    sourceOne = await registerSourceSystem(db.admin, {
      code: 'NON_HADITH_FIXTURE_SEARCH_ONE',
      authority: 'fixture',
    });
    const sourceTwo = await registerSourceSystem(db.admin, {
      code: 'NON_HADITH_FIXTURE_SEARCH_TWO',
      authority: 'fixture',
    });
    editor = await canonicalEditor(db.admin);
    administrator = await h.account(['hadith.read', 'hadith.administer']);

    collectionId = (
      await canonical.createCollection({
        authority: editor,
        value: { slug: COLLECTION, position: 0 },
      })
    ).id;
    editionOne = await registerEdition(db.admin, {
      collectionId,
      sourceSystemId: sourceOne,
      code: 'NON_HADITH_FIXTURE_EDITION_ONE',
    });
    editionTwo = await registerEdition(db.admin, {
      collectionId,
      sourceSystemId: sourceTwo,
      code: 'NON_HADITH_FIXTURE_EDITION_TWO',
    });
    const book = async (editionId: string, slug: string) =>
      (
        await canonical.createBook({
          authority: editor,
          value: {
            editionId,
            slug,
            reference: sentinel('REFERENCE', 1),
            position: 1,
            title: null,
            titleLanguage: null,
          },
        })
      ).id;
    bookOne = await book(editionOne, 'fixture-book-a');
    bookTwo = await book(editionTwo, 'fixture-book-b');

    // Citation 1: an original whose chain, grading and grader carry words of
    // their own, and an IDENTICAL variant in the other edition.
    const facts = {
      text: original(1, WORD.original1),
      chain: `${sentinel('CHAIN', 1)} ${WORD.chain}`,
      chainLanguage: 'ar',
      gradings: [
        {
          grader: `${sentinel('GRADER', 1)} ${WORD.grader}`,
          label: `${sentinel('GRADING', 1)} ${WORD.grading}`,
          labelLanguage: 'ar',
          reference: sentinel('REFERENCE', 2),
        },
      ],
    };
    records[1] = (
      await canonical.createRecord({
        authority: editor,
        value: record({
          sourceReference: sentinel('REFERENCE', 7),
          citationNumber: 1,
          ...facts,
        }),
      })
    ).id;
    const variant = await canonical.createRecord({
      authority: editor,
      value: record({
        editionId: editionTwo,
        bookId: bookTwo,
        sourceReference: sentinel('REFERENCE', 7),
        citationNumber: 1,
        ...facts,
      }),
    });
    expect(variant.conflicts).toBe(0);
    records.variant = variant.id;

    for (const [number, word] of [
      [2, WORD.original2],
      [3, WORD.original3],
      [4, WORD.original4],
      [5, WORD.original5],
    ] as const)
      records[number] = (
        await canonical.createRecord({
          authority: editor,
          value: record({
            sourceReference: sentinel('REFERENCE', 10 + number),
            citationNumber: number,
            text: original(number, word),
          }),
        })
      ).id;

    for (const number of [1, 2, 3, 4, 5]) {
      await verify(records[number]!);
      citations[number] = (
        await canonical.setCitation({
          authority: editor,
          value: {
            collectionId,
            number,
            hadithId: records[number]!,
            state: 'mapped',
            expectedVersion: 0,
            evidence: sentinel('EVIDENCE', 3),
            reason: null,
          },
        })
      ).id;
    }
    await verify(records.variant);

    // Citation 1's PUBLISHED translations — two English, one Urdu — and the
    // variant's own English translation, which no citation names.
    await publishTranslation(
      records[1]!,
      'en',
      `${sentinel('TRANSLATION', 1)} ${WORD.original1}`,
    );
    await publishTranslation(
      records[1]!,
      'en',
      `${sentinel('TRANSLATION', 2)} ${WORD.translation}`,
    );
    await publishTranslation(
      records[1]!,
      'ur',
      `${sentinel('TRANSLATION', 3)} ${URDU_TEST} ${URDU_TEXT}`,
    );
    await publishTranslation(
      records.variant,
      'en',
      `${sentinel('TRANSLATION', 4)} ${WORD.variant}`,
    );

    // A published commentary entry on citation 1's record.
    const commentary = await hadith.createCommentary(administrator, {
      slug: 'fixture-commentary-a',
      name: 'NON_HADITH_FIXTURE commentary',
      description: null,
      attribution: null,
      languageCode: 'en',
      sourceSystemId: sourceOne,
      contributors: [],
    });
    const entry = await hadith.saveCommentaryEntry(administrator, {
      id: commentary.id,
      expectedVersion: commentary.version,
      value: {
        hadithId: records[1]!,
        text: `${sentinel('COMMENTARY', 1)} ${WORD.commentary}`,
      },
    });
    await hadith.setCommentaryState(administrator, {
      id: commentary.id,
      expectedVersion: entry.version,
      state: 'published',
    });

    const [education] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (education === undefined)
      throw new Error('The canonical education topic is missing.');
    await hadith.addRecordTopic(administrator, {
      hadithId: records[1]!,
      topicId: education.id,
    });
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('before activation', () => {
    it('projects nothing while no collection is activated, whatever is mapped and published', async () => {
      // Mapping, verification and the layered changes owed re-projections...
      expect(await intents(db.admin, citations[1]!)).toBeGreaterThan(1);
      // ...and processing them indexes nothing, because nothing is public.
      await h.indexNow();
      expect(await h.wiring.sources.hadith.project(citations[1]!)).toBeNull();
      expect(await h.wiring.targets.hadith([citations[1]!, citations[5]!])).toEqual(
        new Map(),
      );
      expect(await hadithDocuments()).toBe(0);

      await h.search.rebuild();
      await h.indexNow();
      expect(await hadithDocuments()).toBe(0);
      expect(await found(WORD.original1)).toEqual([]);
      expect(await found(WORD.translation)).toEqual([]);
    });
  });

  describe('once activated', () => {
    beforeAll(async () => {
      // Activation is the operator's act and owes no intent of its own: the
      // operator's rebuild projects the newly public citations.
      await activate(db.admin, collectionId, 'fixture');
      await h.search.rebuild();
      await h.indexNow();
    }, 300_000);

    it('indexes one document per text language of each citation, keyed by the citation', async () => {
      expect(await documentsOf(citations[1]!)).toEqual(['ar/ar', 'en/en', 'ur/ur']);
      for (const number of [2, 3, 4, 5])
        expect(await documentsOf(citations[number]!)).toEqual(['ar/ar']);

      const [shape] = await db.admin.query<{ resources: number; duplicated: number }>(
        `SELECT COUNT(DISTINCT [resourceId]) AS resources,
                (SELECT COUNT(*) FROM (SELECT [resourceId],[textLanguage] FROM [dbo].[SearchDocument]
                   WHERE [kind] = N'hadith' GROUP BY [resourceId],[textLanguage] HAVING COUNT(*) > 1) d) AS duplicated
           FROM [dbo].[SearchDocument] WHERE [kind] = N'hadith';`,
      );
      expect(Number(shape?.resources)).toBe(5);
      expect(Number(shape?.duplicated)).toBe(0);

      // The title is the neutral citation label; the original's summary is the
      // original text exactly as recorded.
      const [arabic] = await db.admin.query<{ title: string; summary: string }>(
        `SELECT [title],[summary] FROM [dbo].[SearchDocument]
          WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(citations[1]!)} AND [textLanguage] = N'ar';`,
      );
      expect(arabic).toEqual({
        title: `${COLLECTION} 1`,
        summary: original(1, WORD.original1),
      });

      // Neither the variant, nor a chain, grading, grader or commentary is in
      // any indexed text — while the original and translation words are, so
      // the probe itself is proved able to see a word.
      const indexedWith = async (word: string) => {
        const [row] = await db.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument]
            WHERE CHARINDEX(${n(word)}, CONCAT([title], [summary], [matchEnglish], [matchArabic], [matchUrdu], [matchOther])) > 0;`,
        );
        return Number(row?.total ?? -1);
      };
      expect(await indexedWith(WORD.original1)).toBe(2);
      expect(await indexedWith(WORD.translation)).toBe(1);
      for (const word of [
        WORD.variant,
        WORD.chain,
        WORD.grading,
        WORD.grader,
        WORD.commentary,
      ])
        expect(await indexedWith(word), word).toBe(0);
    });

    it('answers ONE result per citation, at its permanent address, however many documents match', async () => {
      // The original AND an English translation both carry this word.
      for (const locale of ['en', 'ar', 'ur'] as const) {
        const results = await find(WORD.original1, {}, locale);
        expect(results.hits, locale).toHaveLength(1);
        expect(results.hits[0]).toMatchObject({
          kind: 'hadith',
          resourceId: citations[1],
          href: `/hadith/${COLLECTION}/1`,
          title: `${COLLECTION} 1`,
        });
      }
      const arabic = await find(WORD.original1, {}, 'ar');
      expect(arabic.hits[0]).toMatchObject({
        textLanguage: 'ar',
        contentLanguage: 'ar',
        summary: original(1, WORD.original1),
      });

      // A translation-only word answers with the citation, in the layer's language.
      const translated = await find(WORD.translation);
      expect(translated.hits).toHaveLength(1);
      expect(translated.hits[0]).toMatchObject({
        kind: 'hadith',
        resourceId: citations[1],
        href: `/hadith/${COLLECTION}/1`,
        textLanguage: 'en',
        contentLanguage: 'en',
      });
      expect(await found(WORD.translation, { language: 'ar' })).toEqual([]);

      // The Arabic phrase is in every original: one result per citation.
      const every = await find('اختبار', { type: 'hadith' }, 'ar');
      expect(every.hits.map((hit) => hit.resourceId).sort()).toEqual(
        [1, 2, 3, 4, 5].map((number) => citations[number]!).sort(),
      );
      expect(new Set(every.hits.map((hit) => hit.href)).size).toBe(5);
      expect(await found(URDU_TEST, { type: 'hadith' })).toEqual([citations[1]]);
    });

    it('filters by the hadith kind and by a record topic', async () => {
      expect(await found(WORD.original2, { type: 'hadith' })).toEqual([citations[2]]);
      expect(await found(WORD.original2, { type: 'quran-ayah' })).toEqual([]);
      expect(await found(WORD.original2, { type: 'audio' })).toEqual([]);
      expect(await found(WORD.original1, { type: 'hadith', topic: 'education' })).toEqual(
        [citations[1]],
      );
      expect(await found(URDU_TEXT, { type: 'hadith', topic: 'education' })).toEqual([
        citations[1],
      ]);
      expect(await found(WORD.original2, { type: 'hadith', topic: 'education' })).toEqual(
        [],
      );
    });

    it('never makes a chain, a grading, a grader, commentary or an unmapped variant searchable', async () => {
      for (const word of [
        WORD.chain,
        WORD.grading,
        WORD.grader,
        WORD.commentary,
        WORD.variant,
      ]) {
        const results = await find(word);
        expect(results.hits, word).toEqual([]);
        expect(results.withheld, word).toBe(0);
        expect(await found(word, { type: 'hadith' }), word).toEqual([]);
      }
    });

    it('treats query text as data: quotes, operators, wildcards and SQL cannot escape', async () => {
      const hostile = [
        `"; DROP TABLE [SearchDocument]; --`,
        `${WORD.original1}" OR "*`,
        `NEAR((${WORD.original1}, ${WORD.translation}), 5)`,
        `FORMSOF(INFLECTIONAL, ${WORD.original1})`,
        `${WORD.original1}*`,
        `' OR 1=1 --`,
        `<script>alert(1)</script>`,
        `${WORD.chain} OR ${WORD.original1}`,
      ];
      for (const q of hostile) {
        const outcome = await h.search.search({ q, type: 'hadith' }, { locale: 'en' });
        expect(['results', 'invalid'], q).toContain(outcome.state);
        if (outcome.state === 'results')
          expect(
            outcome.results.hits.every((hit) =>
              hit.href.startsWith(`/hadith/${COLLECTION}/`),
            ),
          ).toBe(true);
      }
      // Operator words are just words, all required: nothing holds "not", and
      // nothing holds the chain's word.
      expect(await found(`${WORD.original1} AND NOT ${WORD.translation}`)).toEqual([]);
      expect(await found(`${WORD.chain} OR ${WORD.original1}`)).toEqual([]);
      for (const raw of [
        { q: 'a b c d e f g h i', type: 'hadith' },
        { q: 'x'.repeat(201), type: 'hadith' },
        { q: 'fixture', type: 'hadith', page: '51' },
      ]) {
        expect((await h.search.search(raw, { locale: 'en' })).state).toBe('invalid');
      }
      expect(await count('SearchDocument')).toBeGreaterThan(0);
      expect(h.reported).toEqual([]);
    });

    describe('a stale index never discloses', () => {
      it('withholds a citation conflict evidence now stands against, then drops its rows', async () => {
        const indexed = await documentsOf(citations[2]!);
        expect(indexed).toEqual(['ar/ar']);
        const disagreeing = await canonical.createRecord({
          authority: editor,
          value: record({
            editionId: editionTwo,
            bookId: bookTwo,
            sourceReference: sentinel('REFERENCE', 22),
            citationNumber: 2,
            text: original(22, WORD.original2),
          }),
        });
        expect(disagreeing.conflicts).toBe(1);

        // Nothing re-indexed yet: the stale row is still there, and the ONLY
        // protection is the owner's query-time visibility recheck.
        expect(await documentsOf(citations[2]!)).toEqual(indexed);
        const stale = await find(WORD.original2);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);

        await h.indexNow();
        expect(await documentsOf(citations[2]!)).toEqual([]);
        expect((await find(WORD.original2)).withheld).toBe(0);
      });

      it('withholds a corrected citation until its new version is verified, then carries the new text', async () => {
        const owed = await intents(db.admin, citations[3]!);
        const { editionId: _edition, ...facts } = record({
          sourceReference: sentinel('REFERENCE', 13),
          citationNumber: 3,
          text: original(3, WORD.corrected3),
        });
        const correction: RecordCorrectionValue = {
          ...facts,
          id: records[3]!,
          expectedVersion: 1,
          reason: 'NON_HADITH_FIXTURE search correction proof',
        };
        await canonical.correctRecord({ authority: editor, value: correction });
        expect(await intents(db.admin, citations[3]!)).toBe(owed + 1);

        const stale = await find(WORD.original3);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);
        expect(await found(WORD.corrected3)).toEqual([]);

        await h.indexNow();
        expect(await documentsOf(citations[3]!)).toEqual([]);

        await verify(records[3]!, 2);
        await h.indexNow();
        expect(await found(WORD.original3)).toEqual([]);
        const corrected = await find(WORD.corrected3, {}, 'ar');
        expect(corrected.hits).toHaveLength(1);
        expect(corrected.hits[0]).toMatchObject({
          resourceId: citations[3],
          href: `/hadith/${COLLECTION}/3`,
          summary: original(3, WORD.corrected3),
        });
      });

      it('withholds a withdrawn citation, then drops its rows', async () => {
        await canonical.setCitation({
          authority: editor,
          value: {
            collectionId,
            number: 4,
            hadithId: records[4]!,
            state: 'withdrawn',
            expectedVersion: 1,
            evidence: sentinel('EVIDENCE', 4),
            reason: 'NON_HADITH_FIXTURE withdrawal proof',
          },
        });
        expect(await documentsOf(citations[4]!)).toEqual(['ar/ar']);
        const stale = await find(WORD.original4);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);

        await h.indexNow();
        expect(await documentsOf(citations[4]!)).toEqual([]);
        expect((await find(WORD.original4)).withheld).toBe(0);
      });

      it('withholds every citation of a deactivated section while its rows remain, then reconciles', async () => {
        const indexed = await hadithDocuments();
        // Citations 1 (three languages), 3 and 5 are public.
        expect(indexed).toBe(5);

        await deactivateAll(db.admin);
        // Nothing asked to re-index: deactivation is an operator act.
        expect(await hadithDocuments()).toBe(indexed);
        const stale = await find(WORD.original5);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);
        const all = await find('اختبار', { type: 'hadith' }, 'ar');
        expect(all.hits).toEqual([]);
        expect(all.withheld).toBe(3);

        const summary = await h.search.reconcile();
        expect(summary.orphaned).toBeGreaterThanOrEqual(3);
        await h.indexNow();
        expect(await hadithDocuments()).toBe(0);
        expect((await find(WORD.original5)).withheld).toBe(0);

        await activate(db.admin, collectionId, 'fixture');
        const restored = await h.search.reconcile();
        expect(restored.missing).toBeGreaterThanOrEqual(3);
        await h.indexNow();
        expect(await hadithDocuments()).toBe(indexed);
        expect(await found(WORD.original5)).toEqual([citations[5]]);
      });

      it('withholds a fixture-sourced citation beside an APPROVED section, even where the triggers were bypassed', async () => {
        const indexed = await hadithDocuments();
        // A state the activation trigger forbids — fixture records mapped in an
        // approved collection — forced by the owner on this disposable
        // database, so the query-time rule is proved to hold ON ITS OWN.
        await db.admin.query(
          'ALTER TABLE [dbo].[HadithActivation] DISABLE TRIGGER [HadithActivationIntegrity];',
        );
        try {
          await deactivateAll(db.admin);
          await activate(db.admin, collectionId, 'approved');
        } finally {
          await db.admin.query(
            'ALTER TABLE [dbo].[HadithActivation] ENABLE TRIGGER [HadithActivationIntegrity];',
          );
        }
        const [trigger] = await db.admin.query<{ disabled: boolean | number }>(
          `SELECT [is_disabled] AS disabled FROM sys.triggers WHERE [name] = N'HadithActivationIntegrity';`,
        );
        expect(Number(trigger?.disabled)).toBe(0);
        expect(await reader.availability()).toEqual({ active: true, mode: 'approved' });

        const stale = await find(WORD.original5);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBe(1);
        expect(await h.wiring.targets.hadith([citations[1]!, citations[5]!])).toEqual(
          new Map(),
        );

        const summary = await h.search.reconcile();
        expect(summary.orphaned).toBeGreaterThanOrEqual(3);
        await h.indexNow();
        expect(await hadithDocuments()).toBe(0);

        // The operator restores the fixture section.
        await deactivateAll(db.admin);
        await activate(db.admin, collectionId, 'fixture');
        await h.search.reconcile();
        await h.indexNow();
        expect(await hadithDocuments()).toBe(indexed);
      });
    });

    describe('rebuild and reconciliation', () => {
      it('rebuilds the Hadith inventory from the owner alone, starting from empty', async () => {
        const before = await hadithDocuments();
        await db.admin.query(
          `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
           DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
        );
        await h.engineSettled();
        expect(await found(WORD.original1)).toEqual([]);

        await h.search.rebuild();
        await h.indexNow();

        expect(await hadithDocuments()).toBe(before);
        const [inventory] = await db.admin.query<{ kinds: string }>(
          `SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind]) AS kinds
             FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k;`,
        );
        expect(inventory?.kinds).toBe('hadith,topic');
        expect(await found(WORD.original1)).toEqual([citations[1]]);
        expect(await found(WORD.translation)).toEqual([citations[1]]);
        expect(await found(WORD.corrected3)).toEqual([citations[3]]);
        expect(await found(WORD.original5)).toEqual([citations[5]]);
        for (const word of [WORD.original2, WORD.original4, WORD.chain, WORD.variant])
          expect(await found(word), word).toEqual([]);
      });

      it('reconciles a projection the index lost and one its owner changed unannounced', async () => {
        await db.admin.query(
          `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'hadith' AND [scopeId] = ${n(citations[5]!)};`,
        );
        // A translation changed with no request at all, as a restore or a manual
        // repair might: only the owner's stamp — the work's version — can tell
        // reconciliation.
        await db.admin.query(
          `UPDATE [dbo].[HadithTranslation]
              SET [text] = ${n(`${sentinel('TRANSLATION', 5)} ${WORD.reconciled}`)}, [version] = [version] + 1
            WHERE [hadithId] = ${n(records[1]!)} AND CHARINDEX(${n(WORD.translation)}, [text]) > 0;`,
        );
        await h.engineSettled();
        expect(await found(WORD.original5)).toEqual([]);
        expect(await found(WORD.reconciled)).toEqual([]);

        const summary = await h.search.reconcile();
        expect(summary.missing).toBeGreaterThanOrEqual(1);
        expect(summary.stale).toBeGreaterThanOrEqual(1);
        await h.indexNow();
        expect(await found(WORD.original5)).toEqual([citations[5]]);
        expect(await found(WORD.reconciled)).toEqual([citations[1]]);
        expect(await found(WORD.translation)).toEqual([]);

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
