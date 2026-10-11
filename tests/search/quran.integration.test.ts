import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  CanonicalAuthority,
  QuranCanonicalPort,
  QuranPublicReaderPort,
  TranslationRecord,
} from '../../packages/contracts/src/quran/index.ts';
import type { SearchHit } from '../../packages/contracts/src/search/index.ts';
import {
  quranHitDisplays,
  quranHitKey,
  quranHitRefs,
} from '../../apps/web/src/components/search/quran-hit.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  accountWith,
  grantFor,
  intents,
  NEUTRAL,
  person,
  registerSource,
  sessionFor,
  STRUCTURE,
  type FixtureAyah,
  type RegisteredSource,
} from '../quran/fixture-sql.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 18 — the Quran Ayah in the Search foundation, over REAL SQL Server
 * Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine:
 *
 *   - with the corpus accepted but NOT activated, Quran projects nothing: the
 *     owner's projection is null and a rebuild indexes no `quran-ayah`
 *     document, even beside a published translation;
 *   - once activated, every Ayah is ONE result at its permanent citation
 *     address — its canonical Arabic and each public layer language are
 *     documents of that one result, so a query matching both is never
 *     duplicated, and a query matching only a translation still answers with
 *     the canonical citation;
 *   - a translation's document carries the LAYER's language, never `ar`, and the
 *     one Arabic a result shows is the canonical text;
 *   - deactivation WITHHOLDS every Ayah while its stale rows are still indexed,
 *     and reconciliation then removes them;
 *   - unpublishing a translation and correcting a canonical Ayah each write the
 *     owed intent in their own transaction, and the re-projection follows;
 *   - query text is data, and the Arabic/Urdu tokenisation behaviour on
 *     NON-scriptural Arabic-script words is recorded as measured.
 *
 * NOTHING HERE IS THE QURAN. The corpus is engineering scaffolding (see
 * `../quran/fixture-sql.ts`): every canonical text is a
 * `NON_QURAN_FIXTURE_CANONICAL_{s}_{a}` sentinel, the neutral phrase "non-
 * Quranic test text", and one invented Latin word so a query can name exactly
 * one Ayah. Translations are sentinel prose; the people are fictional.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

/** One invented word per canonical Ayah, so each query has exactly one answer. */
const CANONICAL_WORD: Readonly<Record<string, string>> = {
  '1:1': 'quillbarrowfixture',
  '1:2': 'tamsinfoldfixture',
  '1:3': 'morrowgatefixture',
  '2:1': 'pendlecroftfixture',
  '2:2': 'brackwhistlefixture',
  '2:3': 'harrowdenfixture',
  '2:4': 'fennimorrfixture',
};

/** The word the corrected text of 1:3 carries instead of its original one. */
const CORRECTED_WORD = 'corriganvalefixture';

/** Words only the English translation carries. */
const TRANSLATION_WORD = 'lanternwickfixture';
const TRANSLITERATION_WORD = 'saltmarrowfixture';
const RECONCILED_WORD = 'nettlecombefixture';

/** Urdu interface-prose words, never scripture: "test", "text". */
const URDU_TEST = 'آزمائشی';
const URDU_TEXT = 'متن';

const canonicalText = (tag: string, surah: number, ayah: number, word: string) =>
  `NON_QURAN_FIXTURE_${tag}_${surah}_${ayah} ${NEUTRAL} ${word}`;

const corpus = (): FixtureAyah[] =>
  STRUCTURE.map((entry) => ({
    ...entry,
    text: canonicalText(
      'CANONICAL',
      entry.surah,
      entry.ayah,
      CANONICAL_WORD[`${entry.surah}:${entry.ayah}`]!,
    ),
  }));

live('Phase 18 Quran in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let canonical: QuranCanonicalPort;
  let quran: Awaited<ReturnType<typeof buildQuranService>>;
  let primary: RegisteredSource;
  let corrections: RegisteredSource;
  let editor: CanonicalAuthority;
  let administrator: { accountId: string };
  let english: TranslationRecord;
  /** Quran's public reader through the same guarded service the pages use. */
  let reader: QuranPublicReaderPort;

  /**
   * What a results page DISPLAYS for its Quran hits: one current-records read
   * for the page, through the pure presentation helper both pages render with.
   */
  async function displayed(hits: readonly SearchHit[]) {
    const records = await reader.searchAyahRecords(quranHitRefs(hits));
    const shown = quranHitDisplays(hits, records);
    return hits.map((hit) => ({
      citation: hit.resourceId,
      display: shown.get(quranHitKey(hit)) ?? null,
    }));
  }

  async function buildQuranService() {
    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createAuthorizationService } =
      await import('../../packages/server-core/src/authorization/index.ts');
    const { createQuranService } =
      await import('../../apps/web/src/contexts/quran/index.ts');
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    return createQuranService({
      persistence: database.createQuranPersistence(),
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

  async function citations(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.resourceId).sort();
  }

  /** The indexed documents of one Ayah scope: `textLanguage/contentLanguage`. */
  async function documentsOf(scope: string): Promise<string[]> {
    const rows = await db.admin.query<{ textLanguage: string; contentLanguage: string }>(
      `SELECT [textLanguage],[contentLanguage] FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = N'quran-ayah' AND [scopeId] = N'${scope}'
        ORDER BY [textLanguage];`,
    );
    return rows.map((row) => `${row.textLanguage}/${row.contentLanguage}`);
  }

  async function quranDocuments(): Promise<number> {
    const [row] = await db.admin.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM [dbo].[SearchDocument] WHERE [kind] = N'quran-ayah';`,
    );
    return Number(row?.total ?? -1);
  }

  async function activate(source: RegisteredSource) {
    await db.admin.query(
      `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, N'${source.id}', N'NON_QURAN_FIXTURE operator');`,
    );
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    const database = await import('../../packages/database/src/index.ts');
    canonical = database.createQuranCanonical();
    quran = await buildQuranService();
    const { createQuranReadService } =
      await import('../../apps/web/src/contexts/quran/index.ts');
    reader = createQuranReadService(database.createQuranPublicReader());

    // What only the operator registers: the sources.
    primary = await registerSource(db.admin, {
      code: 'non-quran-fixture-search-primary',
      authority: 'fixture',
      ayat: corpus(),
    });
    corrections = await registerSource(db.admin, {
      code: 'non-quran-fixture-search-corrections',
      authority: 'fixture',
      ayat: STRUCTURE.filter((entry) => entry.surah === 1).map((entry) => ({
        ...entry,
        text: canonicalText(
          'CORRECTED',
          entry.surah,
          entry.ayah,
          entry.ayah === 3 ? CORRECTED_WORD : CANONICAL_WORD[`1:${entry.ayah}`]!,
        ),
      })),
    });

    // The canonical authority the procedures re-verify: a live assignment, a
    // session and a purpose-bound, unexpired step-up grant — all real rows.
    const holder = await accountWith(db.admin, ['quran.editCanonical']);
    const session = await sessionFor(db.admin, holder);
    editor = {
      actorId: holder,
      sessionId: session,
      stepUpGrantId: await grantFor(db.admin, holder, session, 'quran-canonical-edit'),
    };
    administrator = await h.account(['quran.read', 'quran.administer']);

    await canonical.acceptCorpus({
      authority: editor,
      sourceId: primary.id,
      candidate: primary.ayat.map((entry) => ({ ...entry })),
    });

    // A PUBLISHED English translation and Urdu translation and an English
    // transliteration, all fixture-sourced — while the corpus is still inactive.
    const translator = await person(
      db.admin,
      `fixture-translator-${randomUUID().slice(0, 8)}`,
    );
    const work = async (languageCode: string, texts: Record<string, string>) => {
      const created = await quran.createTranslation(administrator, {
        value: {
          slug: `non-quran-fixture-search-${languageCode}-${randomUUID().slice(0, 8)}`,
          name: 'NON_QURAN_FIXTURE translation',
          description: null,
          attribution: null,
          languageCode,
          sourceId: primary.id,
          contributors: [{ personId: translator, role: 'translator' }],
        },
      });
      let current = created;
      for (const surah of [1, 2]) {
        const changes = Object.entries(texts)
          .filter(([ref]) => ref.startsWith(`${surah}:`))
          .map(([ref, text]) => ({ ayah: Number(ref.split(':')[1]), text }));
        if (changes.length === 0) continue;
        current = await quran.saveTranslationTexts(administrator, {
          id: current.id,
          expectedVersion: current.version,
          surah,
          changes,
        });
      }
      return quran.setTranslationState(administrator, {
        id: current.id,
        expectedVersion: current.version,
        state: 'published',
      });
    };
    english = await work('en', {
      // Shares its Ayah's canonical word, so ONE query matches two documents.
      '1:1': `NON_QURAN_FIXTURE translation 1:1 ${CANONICAL_WORD['1:1']}`,
      '1:2': `NON_QURAN_FIXTURE translation 1:2 ${TRANSLATION_WORD}`,
      '1:3': 'NON_QURAN_FIXTURE translation 1:3',
      '2:1': 'NON_QURAN_FIXTURE translation 2:1',
    });
    await work('ur', {
      '1:1': `NON_QURAN_FIXTURE ${URDU_TEST} ${URDU_TEXT} 1:1`,
      '2:2': `NON_QURAN_FIXTURE ${URDU_TEST} ${URDU_TEXT} 2:2`,
    });

    const transliteration = await quran.createTransliteration(administrator, {
      value: {
        slug: `non-quran-fixture-search-transliteration-${randomUUID().slice(0, 8)}`,
        name: 'NON_QURAN_FIXTURE transliteration',
        description: null,
        attribution: null,
        languageCode: 'en',
        sourceId: primary.id,
        scheme: null,
      },
    });
    const withText = await quran.saveTransliterationTexts(administrator, {
      id: transliteration.id,
      expectedVersion: transliteration.version,
      surah: 2,
      changes: [
        {
          ayah: 1,
          text: `NON_QURAN_FIXTURE_TRANSLITERATION_2_1 ${TRANSLITERATION_WORD}`,
        },
      ],
    });
    await quran.setTransliterationState(administrator, {
      id: withText.id,
      expectedVersion: withText.version,
      state: 'published',
    });

    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    await quran.addAyahTopic(administrator, {
      ref: { surah: 2, ayah: 2 },
      topicId: topic.id,
    });
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('before activation', () => {
    it('projects nothing for an accepted but inactive corpus, whatever is published', async () => {
      // Publication owed a re-projection of every Ayah the work carries — the
      // English and the Urdu translation each requested 1:1...
      expect(await intents(db.admin, '1:1')).toBe(2);
      // ...and processing it indexes nothing, because nothing is public.
      await h.indexNow();
      expect(await h.wiring.sources['quran-ayah'].project('1:1')).toBeNull();
      expect(await h.wiring.targets['quran-ayah'](['1:1', '2:4'])).toEqual(new Map());
      expect(await quranDocuments()).toBe(0);

      await h.search.rebuild();
      await h.indexNow();
      expect(await quranDocuments()).toBe(0);
      expect(await citations(CANONICAL_WORD['1:1']!)).toEqual([]);
      expect(await citations(TRANSLATION_WORD)).toEqual([]);
    });
  });

  describe('in fixture mode', () => {
    beforeAll(async () => {
      // Activation is the operator's act and owes no intent of its own: the
      // operator's rebuild projects the newly public corpus.
      await activate(primary);
      await h.search.rebuild();
      await h.indexNow();
    }, 300_000);

    it('indexes one document per text language of each Ayah, keyed by its citation', async () => {
      expect(await documentsOf('1:1')).toEqual(['ar/ar', 'en/en', 'ur/ur']);
      expect(await documentsOf('1:2')).toEqual(['ar/ar', 'en/en']);
      // The translation AND the transliteration of 2:1 are one English document.
      expect(await documentsOf('2:1')).toEqual(['ar/ar', 'en/en']);
      expect(await documentsOf('2:2')).toEqual(['ar/ar', 'ur/ur']);
      expect(await documentsOf('2:4')).toEqual(['ar/ar']);

      const [shape] = await db.admin.query<{ resources: number; duplicated: number }>(
        `SELECT COUNT(DISTINCT [resourceId]) AS resources,
                (SELECT COUNT(*) FROM (SELECT [resourceId],[textLanguage] FROM [dbo].[SearchDocument]
                   WHERE [kind] = N'quran-ayah' GROUP BY [resourceId],[textLanguage] HAVING COUNT(*) > 1) d) AS duplicated
           FROM [dbo].[SearchDocument] WHERE [kind] = N'quran-ayah';`,
      );
      expect(Number(shape?.resources)).toBe(STRUCTURE.length);
      expect(Number(shape?.duplicated)).toBe(0);

      // Every title is the citation; the Arabic document's summary is the
      // canonical text exactly as accepted.
      const [arabic] = await db.admin.query<{ title: string; summary: string }>(
        `SELECT [title],[summary] FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'quran-ayah' AND [scopeId] = N'2:4' AND [textLanguage] = N'ar';`,
      );
      expect(arabic).toEqual({ title: '2:4', summary: primary.ayat[6]!.text });
    });

    it('answers ONE result per Ayah at its citation address when canonical and translation both match', async () => {
      const english = await find(CANONICAL_WORD['1:1']!);
      expect(english.hits).toHaveLength(1);
      expect(english.hits[0]).toMatchObject({
        kind: 'quran-ayah',
        resourceId: '1:1',
        href: '/quran/surah/1/1',
        title: '1:1',
        textLanguage: 'en',
        contentLanguage: 'en',
      });
      // An English reader is shown the translation layer — labelled by its own
      // language, never as the Arabic.
      expect(english.hits[0]?.summary).toContain('NON_QURAN_FIXTURE translation 1:1');

      const arabic = await find(CANONICAL_WORD['1:1']!, {}, 'ar');
      expect(arabic.hits).toHaveLength(1);
      expect(arabic.hits[0]).toMatchObject({
        resourceId: '1:1',
        href: '/quran/surah/1/1',
        textLanguage: 'ar',
        contentLanguage: 'ar',
        summary: primary.ayat[0]!.text,
      });
    });

    it('answers a translation-only query with the canonical citation, in the layer language', async () => {
      const found = await find(TRANSLATION_WORD);
      expect(found.hits).toHaveLength(1);
      expect(found.hits[0]).toMatchObject({
        kind: 'quran-ayah',
        resourceId: '1:2',
        href: '/quran/surah/1/2',
        title: '1:2',
        textLanguage: 'en',
        contentLanguage: 'en',
      });
      // A translation's words are never presented as the Arabic, whatever the
      // reader's interface language.
      const arabicReader = await find(TRANSLATION_WORD, {}, 'ar');
      expect(arabicReader.hits.map((hit) => hit.textLanguage)).toEqual(['en']);
      expect(await citations(TRANSLATION_WORD, { language: 'ar' })).toEqual([]);
      expect(await citations(TRANSLATION_WORD, { language: 'en' })).toEqual(['1:2']);

      // A transliteration is matched in its own language's document too.
      expect(await citations(TRANSLITERATION_WORD)).toEqual(['2:1']);
    });

    it('filters by the quran-ayah kind and by an Ayah topic', async () => {
      expect(await citations(CANONICAL_WORD['2:3']!, { type: 'quran-ayah' })).toEqual([
        '2:3',
      ]);
      expect(await citations(CANONICAL_WORD['2:3']!, { type: 'audio' })).toEqual([]);
      expect(await citations('اختبار', { type: 'audio' })).toEqual([]);
      // Typed foreign-key topic assignment reaches every document of the Ayah.
      expect(
        await citations(CANONICAL_WORD['2:2']!, {
          type: 'quran-ayah',
          topic: 'education',
        }),
      ).toEqual(['2:2']);
      expect(
        await citations(URDU_TEXT, { type: 'quran-ayah', topic: 'education' }),
      ).toEqual(['2:2']);
      expect(
        await citations(CANONICAL_WORD['2:3']!, {
          type: 'quran-ayah',
          topic: 'education',
        }),
      ).toEqual([]);
    });

    describe('Arabic and Urdu tokenisation on NON-scriptural words — measured, not assumed', () => {
      it('Arabic: the neutral phrase is found in every canonical document, with and without the article', async () => {
        // "اختبار" ("test") is a word of the neutral fixture phrase, in every Ayah.
        const tested = await find('اختبار', { type: 'quran-ayah' }, 'ar');
        expect(tested.hits.map((hit) => hit.resourceId).sort()).toEqual(
          STRUCTURE.map((entry) => `${entry.surah}:${entry.ayah}`).sort(),
        );
        expect(new Set(tested.hits.map((hit) => hit.textLanguage))).toEqual(
          new Set(['ar']),
        );
        // The Arabic breaker removes the definite article (TECH_STACK.md §10).
        expect(await citations('الاختبار', { type: 'quran-ayah' })).toHaveLength(
          STRUCTURE.length,
        );
        // Harakat typed in the query are folded away before matching.
        expect(await citations('اخْتِبَار', { type: 'quran-ayah' })).toHaveLength(
          STRUCTURE.length,
        );
      });

      it('records the known limitation: Arabic yeh and Urdu yeh are different words', async () => {
        // "غير" is stored with the ARABIC yeh (U+064A). Typed with the Urdu/Farsi
        // yeh (U+06CC) it is a different word to every SQL Server breaker — the
        // V1 limitation TECH_STACK.md §10 records, asserted so a change is seen.
        expect(await citations('غير', { type: 'quran-ayah' })).toHaveLength(
          STRUCTURE.length,
        );
        expect(await citations('غیر', { type: 'quran-ayah' })).toEqual([]);

        // And the other way: the Urdu word "آزمائشی" is stored with the Urdu
        // yeh, in the Urdu layer documents of 1:1 and 2:2.
        expect(await citations(URDU_TEST, { type: 'quran-ayah' })).toEqual([
          '1:1',
          '2:2',
        ]);
        expect(
          await citations(URDU_TEST.replace('ی', 'ي'), { type: 'quran-ayah' }),
        ).toEqual([]);
        const urdu = await find(URDU_TEXT, { type: 'quran-ayah' }, 'ur');
        expect(urdu.hits.map((hit) => [hit.resourceId, hit.textLanguage])).toEqual(
          expect.arrayContaining([
            ['1:1', 'ur'],
            ['2:2', 'ur'],
          ]),
        );
      });
    });

    it('treats query text as data: quotes, operators, wildcards and SQL cannot escape', async () => {
      const hostile = [
        `"; DROP TABLE [SearchDocument]; --`,
        `${CANONICAL_WORD['1:1']}" OR "*`,
        `NEAR((${CANONICAL_WORD['1:1']}, ${TRANSLATION_WORD}), 5)`,
        `FORMSOF(INFLECTIONAL, ${CANONICAL_WORD['1:1']})`,
        `${CANONICAL_WORD['1:1']}*`,
        `' OR 1=1 --`,
        `<script>alert(1)</script>`,
      ];
      for (const q of hostile) {
        const outcome = await h.search.search(
          { q, type: 'quran-ayah' },
          { locale: 'en' },
        );
        expect(['results', 'invalid'], q).toContain(outcome.state);
      }
      // Operator words are just words, all required: nothing holds "not".
      expect(
        await citations(`${CANONICAL_WORD['1:1']} AND NOT ${TRANSLATION_WORD}`),
      ).toEqual([]);
      // The expensive-query bounds apply unchanged to the new kind.
      for (const raw of [
        { q: 'a b c d e f g h i', type: 'quran-ayah' },
        { q: 'x'.repeat(201), type: 'quran-ayah' },
        { q: 'fixture', type: 'quran-ayah', page: '51' },
      ]) {
        expect((await h.search.search(raw, { locale: 'en' })).state).toBe('invalid');
      }
      expect(h.reported).toEqual([]);
    });

    describe('a stale index never discloses', () => {
      it('withholds every Ayah of a deactivated corpus while its rows remain, then drops them', async () => {
        const indexed = await quranDocuments();
        expect(indexed).toBeGreaterThan(STRUCTURE.length);

        await db.admin.query(`DELETE FROM [dbo].[QuranActivation];`);
        // Nothing asked to re-index: the ONLY protection left is the owner's
        // query-time visibility recheck.
        expect(await quranDocuments()).toBe(indexed);
        const stale = await find(CANONICAL_WORD['1:1']!);
        expect(stale.hits).toEqual([]);
        expect(stale.withheld).toBeGreaterThan(0);
        const all = await find('اختبار', { type: 'quran-ayah' });
        expect(all.hits).toEqual([]);
        expect(all.withheld).toBe(STRUCTURE.length);

        const summary = await h.search.reconcile();
        expect(summary.orphaned).toBeGreaterThanOrEqual(STRUCTURE.length);
        await h.indexNow();
        expect(await quranDocuments()).toBe(0);
        expect((await find(CANONICAL_WORD['1:1']!)).withheld).toBe(0);

        // Re-activated, reconciliation finds every Ayah missing and restores it.
        await activate(primary);
        const restored = await h.search.reconcile();
        expect(restored.missing).toBeGreaterThanOrEqual(STRUCTURE.length);
        await h.indexNow();
        expect(await quranDocuments()).toBe(indexed);
        expect(await citations(CANONICAL_WORD['1:1']!)).toEqual(['1:1']);
      });

      it('unpublishing a translation owes every Ayah it carries a re-projection, which drops its layer', async () => {
        const reach = ['1:1', '1:2', '1:3', '2:1'];
        const owed = await Promise.all(reach.map((scope) => intents(db.admin, scope)));
        const current = await quran.translation(administrator, english.id);
        if (current === null) throw new Error('fixture translation missing');
        await quran.setTranslationState(administrator, {
          id: current.id,
          expectedVersion: current.version,
          state: 'archived',
        });
        expect(await Promise.all(reach.map((scope) => intents(db.admin, scope)))).toEqual(
          owed.map((total) => total + 1),
        );

        // BEFORE the indexer runs, the archived translation's document still
        // matches and the Ayah is still public, so Search answers with it — its
        // indexed summary is the archived translation. What a page DISPLAYS is
        // the current record: the citation, with the canonical text labelled
        // as the Arabic, and none of the archived words.
        const stale = await find(TRANSLATION_WORD);
        expect(stale.hits.map((hit) => [hit.resourceId, hit.textLanguage])).toEqual([
          ['1:2', 'en'],
        ]);
        expect(stale.hits[0]?.summary).toContain(TRANSLATION_WORD);
        const shown = await displayed(stale.hits);
        expect(shown).toEqual([
          {
            citation: '1:2',
            display: { layer: 'arabic', language: 'ar', text: primary.ayat[1]!.text },
          },
        ]);
        expect(JSON.stringify(shown)).not.toContain(TRANSLATION_WORD);
        expect(JSON.stringify(shown)).not.toContain('NON_QURAN_FIXTURE translation');
        // An Ayah answering in a language that still has a public layer shows
        // that CURRENT layer, never the archived one: 1:1's Urdu remains.
        const urduReader = await find(CANONICAL_WORD['1:1']!, {}, 'ur');
        for (const { display } of await displayed(urduReader.hits))
          expect(display?.text ?? '').not.toContain('NON_QURAN_FIXTURE translation');

        await h.indexNow();
        expect(await citations(TRANSLATION_WORD)).toEqual([]);
        expect((await find(TRANSLATION_WORD)).withheld).toBe(0);
        expect(await documentsOf('1:2')).toEqual(['ar/ar']);
        expect(await documentsOf('1:1')).toEqual(['ar/ar', 'ur/ur']);
        // The transliteration is still public, so 2:1 keeps its English document.
        expect(await documentsOf('2:1')).toEqual(['ar/ar', 'en/en']);
        // The canonical result is untouched: an English reader now sees the Arabic.
        const canonicalHit = await find(CANONICAL_WORD['1:1']!);
        expect(canonicalHit.hits).toHaveLength(1);
        expect(canonicalHit.hits[0]).toMatchObject({
          resourceId: '1:1',
          textLanguage: 'ar',
          summary: primary.ayat[0]!.text,
        });
      });

      it('a canonical correction owes its Ayah a re-projection, which carries the new text', async () => {
        const owed = await intents(db.admin, '1:3');
        const reviewedText = corrections.ayat.find((entry) => entry.ayah === 3)!.text;
        const corrected = await canonical.correctAyah({
          authority: editor,
          ref: { surah: 1, ayah: 3 },
          expectedVersion: 1,
          sourceId: corrections.id,
          reviewedText,
          reason: 'NON_QURAN_FIXTURE search correction proof',
        });
        expect(corrected.version).toBe(2);
        expect(await intents(db.admin, '1:3')).toBe(owed + 1);

        // BEFORE the indexer runs, the superseded text still matches and is the
        // indexed summary. What a page DISPLAYS is the corrected text, at the
        // same citation, and none of the superseded words.
        const stale = await find(CANONICAL_WORD['1:3']!, {}, 'ar');
        expect(stale.hits.map((hit) => hit.resourceId)).toEqual(['1:3']);
        expect(stale.hits[0]?.summary).toContain(CANONICAL_WORD['1:3']!);
        const shown = await displayed(stale.hits);
        expect(shown).toEqual([
          {
            citation: '1:3',
            display: { layer: 'arabic', language: 'ar', text: reviewedText },
          },
        ]);
        expect(JSON.stringify(shown)).not.toContain(CANONICAL_WORD['1:3']!);

        await h.indexNow();
        expect(await citations(CANONICAL_WORD['1:3']!)).toEqual([]);
        const found = await find(CORRECTED_WORD, {}, 'ar');
        expect(found.hits).toHaveLength(1);
        expect(found.hits[0]).toMatchObject({
          resourceId: '1:3',
          href: '/quran/surah/1/3',
          textLanguage: 'ar',
          summary: reviewedText,
        });
      });
    });

    describe('rebuild and reconciliation', () => {
      it('rebuilds the Quran inventory from the owner alone, starting from empty', async () => {
        const before = await quranDocuments();
        await db.admin.query(
          `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
           DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
        );
        await h.engineSettled();
        expect(await citations(CORRECTED_WORD)).toEqual([]);

        await h.search.rebuild();
        await h.indexNow();

        expect(await quranDocuments()).toBe(before);
        const [inventory] = await db.admin.query<{ kinds: string }>(
          `SELECT STRING_AGG([kind], N',') WITHIN GROUP (ORDER BY [kind]) AS kinds
             FROM (SELECT DISTINCT [kind] FROM [dbo].[SearchDocument]) k;`,
        );
        expect(inventory?.kinds).toBe('quran-ayah,topic');
        expect(await citations(CORRECTED_WORD)).toEqual(['1:3']);
        expect(await citations(TRANSLATION_WORD)).toEqual([]);
        for (const [ref, word] of Object.entries(CANONICAL_WORD).filter(
          ([ref]) => ref !== '1:3',
        ))
          expect(await citations(word), ref).toEqual([ref]);
      });

      it('reconciles an Ayah projection the index lost and one its owner changed unannounced', async () => {
        await db.admin.query(
          `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'quran-ayah' AND [scopeId] = N'2:4';`,
        );
        // A layer work changed with no request at all, as a restore or a manual
        // repair might: only the owner's stamp — its work versions — can tell
        // reconciliation.
        await db.admin.query(
          `UPDATE [dbo].[QuranTranslationText] SET [text] = N'NON_QURAN_FIXTURE ${URDU_TEST} ${RECONCILED_WORD}'
            WHERE [surahNumber] = 2 AND [ayahNumber] = 2;
           UPDATE [dbo].[QuranTranslation] SET [version] = [version] + 1
            WHERE [id] IN (SELECT [translationId] FROM [dbo].[QuranTranslationText]
                            WHERE [surahNumber] = 2 AND [ayahNumber] = 2);`,
        );
        await h.engineSettled();
        expect(await citations(CANONICAL_WORD['2:4']!)).toEqual([]);
        expect(await citations(RECONCILED_WORD)).toEqual([]);

        const summary = await h.search.reconcile();
        expect(summary.missing).toBeGreaterThanOrEqual(1);
        expect(summary.stale).toBeGreaterThanOrEqual(1);
        await h.indexNow();
        expect(await citations(CANONICAL_WORD['2:4']!)).toEqual(['2:4']);
        expect(await citations(RECONCILED_WORD)).toEqual(['2:2']);
      });
    });
  });

  it('reports no swallowed failure', () => {
    expect(h.reported).toEqual([]);
  });
});
