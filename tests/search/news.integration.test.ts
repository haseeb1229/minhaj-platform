import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  ArticleDetail,
  NewsKind,
  WorkflowAction,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { buildSearchHarness, type SearchHarness } from './harness.ts';

/**
 * Phase 13 — the four News families in the Search foundation, over REAL SQL
 * Server Full-Text Search.
 *
 * WHAT IS PROVED, and only against the live engine, for EACH family: a record
 * is projected by Editorial's own workflow and found at its CURRENT canonical
 * address under its OWN kind, so the type filter tells the four apart; a draft
 * or an unpublished revision is never indexed; a renamed record resolves to its
 * new address before any re-indexing; a record made non-public is WITHHELD while
 * its stale rows are still in the index and then leaves it; a rebuild
 * reproduces the inventory from Editorial alone; and reconciliation repairs
 * what the index lost. A Statement's issuer and a coverage record's outlet are
 * matched; a coverage record's source address is not.
 *
 * EVERYTHING IS SYNTHETIC. Titles say they are fixtures and the words are
 * invented; no real organisation, authority or outlet is named.
 *
 * Runs in the `Database foundation` CI job (`npm run test:search`), where a
 * skipped suite fails the job (`scripts/assert-search-proofs.mjs`).
 */

const live = databaseConfigured ? describe : describe.skip;

const KINDS: readonly NewsKind[] = [
  'news-article',
  'press-release',
  'statement',
  'media-coverage',
];
const TABLE: Readonly<Record<NewsKind, string>> = {
  'news-article': 'NewsArticle',
  'press-release': 'PressRelease',
  statement: 'Statement',
  'media-coverage': 'MediaCoverage',
};
const SEGMENT: Readonly<Record<NewsKind, string>> = {
  'news-article': '/news',
  'press-release': '/news/press-releases',
  statement: '/news/statements',
  'media-coverage': '/news/media-coverage',
};
/** One invented word per family, so each query has exactly one answer. */
const WORD: Readonly<Record<NewsKind, string>> = {
  'news-article': 'quillmarshfixture',
  'press-release': 'tanglebrookfixture',
  statement: 'hollowvanefixture',
  'media-coverage': 'fernwickfixture',
};

const slug = (kind: NewsKind) => `${kind}-search-${randomUUID().slice(0, 8)}`;

function input(
  kind: NewsKind,
  title: string,
  value = slug(kind),
  topicIds: string[] = [],
) {
  const document = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Synthetic body for ${title}.` }],
      },
    ],
  });
  return {
    slug: value,
    primaryLanguage: 'en',
    translations: [
      {
        languageCode: 'en',
        title,
        excerpt: 'Non-authoritative search fixture',
        seoTitle: '',
        seoDescription: '',
        document,
        ...(kind === 'statement' ? { issuer: 'Synthetic Brackenfold Office' } : {}),
      },
    ],
    topicIds,
    contributors: [],
    ...(kind === 'media-coverage'
      ? {
          coverage: {
            outlet: 'Synthetic Larchmoor Outlet',
            sourceUrl: 'https://thistlegatefixture.example.invalid/story',
            sourceDate: '2031-05-06',
          },
        }
      : {}),
  };
}

live('Phase 13 News in Search (real SQL Server FTS)', () => {
  let db: DisposableDatabase;
  let h: SearchHarness;
  let author: { accountId: string };
  let reviewer: { accountId: string };
  let publisher: { accountId: string };
  let educationTopic: string;
  const records = new Map<NewsKind, ArticleDetail>();

  async function find(q: string, extra: Record<string, string> = {}) {
    const outcome = await h.search.search({ q, ...extra }, { locale: 'en' });
    if (outcome.state !== 'results') {
      throw new Error(`Expected results for a proof query, got ${outcome.state}.`);
    }
    return outcome.results;
  }
  async function kinds(q: string, extra: Record<string, string> = {}) {
    return (await find(q, extra)).hits.map((hit) => hit.kind).sort();
  }
  async function documentsOf(kind: NewsKind, id: string): Promise<number> {
    const [row] = await db.admin.query<{ documents: number }>(
      `SELECT COUNT(*) AS documents FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'${kind}' AND [scopeId] = N'${id}';`,
    );
    return Number(row?.documents ?? 0);
  }
  const step = (
    kind: NewsKind,
    row: ArticleDetail,
    action: WorkflowAction,
    actor: { accountId: string },
  ) =>
    h.editorial.transition(actor, kind, {
      id: row.id,
      expectedVersion: row.version,
      action,
      scheduledAt: null,
      timezone: null,
    });
  async function publish(kind: NewsKind, row: ArticleDetail) {
    const approved = await step(
      kind,
      await step(kind, row, 'submit', author),
      'approve',
      reviewer,
    );
    return step(kind, approved, 'publish', publisher);
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    h = await buildSearchHarness(db.admin);
    author = await h.account(['content.read', 'content.author']);
    reviewer = await h.account(['content.read', 'content.review']);
    publisher = await h.account(['content.read', 'content.publish']);
    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');
    educationTopic = topic.id;

    for (const kind of KINDS) {
      const created = await h.editorial.create(
        author,
        kind,
        input(kind, `Synthetic ${kind} ${WORD[kind]}`, slug(kind), [educationTopic]),
      );
      records.set(kind, await publish(kind, created));
    }
    // A draft of every family, named with one shared word no public record has.
    for (const kind of KINDS)
      await h.editorial.create(
        author,
        kind,
        input(kind, 'Synthetic draft sorrelfixture'),
      );
    await h.indexNow();
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  });

  const record = (kind: NewsKind) => {
    const row = records.get(kind);
    if (row === undefined) throw new Error(`fixture ${kind} missing`);
    return row;
  };

  it('finds each family under its own kind at its own canonical address', async () => {
    for (const kind of KINDS) {
      const hits = (await find(WORD[kind])).hits;
      expect(hits, kind).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        kind,
        href: `${SEGMENT[kind]}/${record(kind).slug}`,
        contentLanguage: 'en',
      });
    }
  });

  it('tells the four families apart through the type filter and combines topic and year', async () => {
    for (const kind of KINDS) {
      expect(await kinds('synthetic', { type: kind, topic: 'education' })).toEqual([
        kind,
      ]);
      const year = String(new Date().getUTCFullYear());
      expect(await kinds(WORD[kind], { type: kind, from: year, to: year })).toEqual([
        kind,
      ]);
      for (const other of KINDS.filter((entry) => entry !== kind))
        expect(await kinds(WORD[kind], { type: other })).toEqual([]);
    }
  });

  it('matches an issuer and an outlet, never a source address', async () => {
    expect(await kinds('brackenfold')).toEqual(['statement']);
    expect(await kinds('larchmoor')).toEqual(['media-coverage']);
    expect(await kinds('thistlegatefixture')).toEqual([]);
  });

  it('never indexes a draft', async () => {
    expect(await kinds('sorrelfixture')).toEqual([]);
  });

  it('commits search intent with each mutation and projects nothing for a draft', async () => {
    for (const kind of KINDS) {
      const draft = await h.editorial.create(
        author,
        kind,
        input(kind, 'Synthetic probe'),
      );
      const submitted = await step(kind, draft, 'submit', author);
      const [row] = await db.admin.query<{ requests: number }>(
        `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'${kind}' AND [scopeId] = N'${submitted.id}';`,
      );
      expect(Number(row?.requests), kind).toBeGreaterThanOrEqual(1);
      await h.indexNow();
      expect(await documentsOf(kind, submitted.id)).toBe(0);
    }
  });

  it('addresses a renamed record at its CURRENT slug before any re-indexing', async () => {
    for (const kind of KINDS) {
      const current = record(kind);
      const renamed = slug(kind);
      let next = await h.editorial.revise(
        author,
        kind,
        current.id,
        current.version,
        input(kind, `Synthetic ${kind} ${WORD[kind]}`, renamed, [educationTopic]),
      );
      next = await publish(kind, next);
      records.set(kind, next);
      expect((await find(WORD[kind])).hits[0]?.href).toBe(`${SEGMENT[kind]}/${renamed}`);
    }
    await h.indexNow();
  });

  describe('a stale index never discloses', () => {
    it('withholds each archived family while its rows remain, then drops them', async () => {
      for (const kind of KINDS) {
        const archived = await step(kind, record(kind), 'archive', publisher);
        records.set(kind, archived);
        // The stale rows are still there — and nothing of them is returned.
        expect(await documentsOf(kind, archived.id)).toBeGreaterThan(0);
        const stale = await find(WORD[kind]);
        expect(stale.hits, kind).toEqual([]);
        expect(stale.withheld).toBeGreaterThanOrEqual(1);
      }
      await h.indexNow();
      for (const kind of KINDS) {
        expect(await documentsOf(kind, record(kind).id)).toBe(0);
        expect((await find(WORD[kind])).withheld).toBe(0);
      }
    });

    it('withholds a record unpublished with no request at all, until reconciliation', async () => {
      for (const kind of KINDS) {
        const row = await publish(
          kind,
          await h.editorial.create(
            author,
            kind,
            input(kind, `Synthetic resurfaced ${kind} ${WORD[kind]}`),
          ),
        );
        records.set(kind, row);
      }
      await h.indexNow();
      for (const kind of KINDS) {
        const id = record(kind).id;
        // Bypasses the workflow entirely, as a restore or a manual repair might:
        // nothing asked to re-index, so the ONLY protection left is the
        // query-time visibility recheck.
        await db.admin.query(
          `UPDATE [dbo].[${TABLE[kind]}] SET [state] = N'archived' WHERE [id] = N'${id}';`,
        );
        expect(await documentsOf(kind, id)).toBeGreaterThan(0);
        const stale = await find(WORD[kind]);
        expect(stale.hits, kind).toEqual([]);
        expect(stale.withheld).toBe(1);
      }
      const summary = await h.search.reconcile();
      expect(summary.orphaned).toBeGreaterThanOrEqual(KINDS.length);
      await h.indexNow();
      for (const kind of KINDS) expect(await documentsOf(kind, record(kind).id)).toBe(0);
    });
  });

  describe('rebuild and reconciliation', () => {
    it('rebuilds the News inventory from Editorial alone, starting from empty', async () => {
      const kept = new Map<NewsKind, ArticleDetail>();
      for (const kind of KINDS)
        kept.set(
          kind,
          await publish(
            kind,
            await h.editorial.create(
              author,
              kind,
              input(kind, `Synthetic rebuilt ${kind} rookfieldfixture`),
            ),
          ),
        );
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocumentTopic]; DELETE FROM [dbo].[SearchDocument];
         DELETE FROM [dbo].[SearchIndexScope]; DELETE FROM [dbo].[SearchIndexRequest];`,
      );
      await h.engineSettled();
      expect(await kinds('rookfieldfixture')).toEqual([]);

      await h.search.rebuild();
      await h.indexNow();

      expect(await kinds('rookfieldfixture')).toEqual([...KINDS].sort());
      // The archived and the withdrawn stay out; the drafts never enter.
      for (const kind of KINDS) expect(await kinds(WORD[kind])).toEqual([]);
      expect(await kinds('sorrelfixture')).toEqual([]);
      for (const [kind, row] of kept)
        expect((await find('rookfieldfixture', { type: kind })).hits[0]?.href).toBe(
          `${SEGMENT[kind]}/${row.slug}`,
        );
    });

    it('reconciles a News projection the index lost without being told', async () => {
      const row = await publish(
        'press-release',
        await h.editorial.create(
          author,
          'press-release',
          input('press-release', 'Synthetic reconcile probe wrenhollowfixture'),
        ),
      );
      await h.indexNow();
      await db.admin.query(
        `DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'press-release' AND [scopeId] = N'${row.id}';`,
      );
      const summary = await h.search.reconcile();
      expect(summary.missing).toBeGreaterThanOrEqual(1);
      await h.indexNow();
      expect(await kinds('wrenhollowfixture')).toEqual(['press-release']);
    });
  });

  it('reports no swallowed failure', () => {
    expect(h.reported).toEqual([]);
  });
});
