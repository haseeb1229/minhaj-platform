import { describe, expect, it } from 'vitest';

import type {
  IndexDocument,
  IndexQuery,
  IndexRow,
  SearchClaim,
  SearchIndexPort,
  SearchKind,
  SearchScopeKind,
  SearchScopeRef,
  SearchScopeSource,
  SearchTargetResolver,
} from '../../packages/contracts/src/search/index.ts';
import { createSearchService } from '../../packages/search/src/service.ts';

/**
 * The SearchService's own decisions, over in-memory fakes.
 *
 * What only the service decides — and so what these prove without an engine:
 * that current visibility is rechecked ONCE PER KIND per page, that a withheld
 * row is never returned, that each failure is recorded under the right
 * category, that an owner's projection is validated before anything is written,
 * and that enumeration ends only on an empty page. The live engine proofs are in
 * `search.integration.test.ts`.
 */

const KINDS: readonly SearchScopeKind[] = ['topic', 'person', 'article', 'page', 'work'];

function row(kind: SearchKind, resourceId: string): IndexRow {
  return {
    kind,
    resourceId,
    textLanguage: 'en',
    contentLanguage: null,
    title: `Title ${resourceId}`,
    summary: '',
    year: null,
  };
}

function fakeIndex(overrides: Partial<SearchIndexPort> = {}) {
  const requested: SearchScopeRef[] = [];
  const applied: { claim: SearchClaim; documents: readonly IndexDocument[] }[] = [];
  const failed: { claim: SearchClaim; category: string }[] = [];
  const queries: IndexQuery[] = [];
  const pendingClaims: SearchClaim[] = [];

  const index: SearchIndexPort = {
    request: async (scopes) => void requested.push(...scopes),
    relay: async () => 0,
    claim: async () => pendingClaims.splice(0),
    apply: async (claim, projection) => {
      applied.push({ claim, documents: projection.documents });
      return 'current';
    },
    fail: async (claim, input) => {
      failed.push({ claim, category: input.category });
      return 'retrying';
    },
    query: async (query) => {
      queries.push(query);
      return { total: 0, rows: [] };
    },
    scopeStates: async () => new Map(),
    indexedScopes: async () => [],
    retryFailed: async () => 0,
    status: async () => ({
      pending: 0,
      failed: 0,
      retrying: 0,
      oldestPendingAt: null,
      lastIndexedAt: null,
      documents: 0,
      enginePending: 0,
      failures: [],
    }),
    ...overrides,
  };

  return { index, requested, applied, failed, queries, pendingClaims };
}

const emptySource: SearchScopeSource = {
  project: async () => null,
  list: async () => [],
};

function sources(overrides: Partial<Record<SearchScopeKind, SearchScopeSource>> = {}) {
  return Object.fromEntries(
    KINDS.map((kind) => [kind, overrides[kind] ?? emptySource]),
  ) as Record<SearchScopeKind, SearchScopeSource>;
}

function targets(
  resolve: (kind: SearchKind, ids: readonly string[]) => ReadonlyMap<string, string>,
  calls: { kind: SearchKind; ids: readonly string[] }[],
): Record<SearchKind, SearchTargetResolver> {
  const make =
    (kind: SearchKind): SearchTargetResolver =>
    async (ids) => {
      calls.push({ kind, ids });
      return resolve(kind, ids);
    };
  return {
    topic: make('topic'),
    person: make('person'),
    article: make('article'),
    page: make('page'),
    work: make('work'),
    edition: make('edition'),
    'book-translation': make('book-translation'),
  };
}

const claim = (kind: SearchScopeKind, id: string): SearchClaim => ({
  kind,
  id,
  generation: 1,
  attempts: 1,
  leaseToken: 'lease',
});

describe('search — the stale-index rule', () => {
  it('rechecks current visibility once per kind, and withholds what its owner no longer publishes', async () => {
    const fake = fakeIndex({
      query: async () => ({
        total: 4,
        rows: [
          row('article', 'a1'),
          row('work', 'w1'),
          row('article', 'a2'),
          row('work', 'w2'),
        ],
      }),
    });
    const calls: { kind: SearchKind; ids: readonly string[] }[] = [];
    const service = createSearchService({
      index: fake.index,
      sources: sources(),
      targets: targets(
        (kind, ids) =>
          new Map(
            ids
              // a2 has been withdrawn since it was indexed.
              .filter((id) => id !== 'a2')
              .map((id) => [id, `/${kind}/${id}`]),
          ),
        calls,
      ),
      resolveTopic: async () => null,
      report: () => undefined,
    });

    const outcome = await service.search({ q: 'book' }, { locale: 'en' });
    expect(outcome.state).toBe('results');
    if (outcome.state !== 'results') return;

    expect(outcome.results.hits.map((hit) => hit.resourceId)).toEqual(['a1', 'w1', 'w2']);
    expect(outcome.results.withheld).toBe(1);
    expect(outcome.results.hits.find((hit) => hit.resourceId === 'a1')?.href).toBe(
      '/article/a1',
    );

    // ONE call per kind present on the page — never one per result.
    expect(calls.map((call) => call.kind).sort()).toEqual(['article', 'work']);
    expect(calls.find((call) => call.kind === 'article')?.ids).toEqual(['a1', 'a2']);
  });

  it('shows an honest short page rather than reaching for more', async () => {
    let queried = 0;
    const fake = fakeIndex({
      query: async () => {
        queried += 1;
        return { total: 2, rows: [row('page', 'p1'), row('page', 'p2')] };
      },
    });
    const service = createSearchService({
      index: fake.index,
      sources: sources(),
      targets: targets(() => new Map(), []),
      resolveTopic: async () => null,
      report: () => undefined,
    });

    const outcome = await service.search({ q: 'x1' }, { locale: 'en' });
    expect(outcome.state === 'results' && outcome.results.hits).toEqual([]);
    expect(queried).toBe(1);
  });

  it('is unavailable — never falsely empty — when the index or an owner fails', async () => {
    const reported: string[] = [];
    const failing = createSearchService({
      index: fakeIndex({
        query: async () => {
          throw new Error('synthetic engine fault');
        },
      }).index,
      sources: sources(),
      targets: targets(() => new Map(), []),
      resolveTopic: async () => null,
      report: (operation) => reported.push(operation),
    });

    expect((await failing.search({ q: 'book' }, { locale: 'en' })).state).toBe(
      'unavailable',
    );
    expect(reported).toEqual(['search.query']);
  });

  it('touches nothing for an empty or invalid request', async () => {
    const fake = fakeIndex();
    const service = createSearchService({
      index: fake.index,
      sources: sources(),
      targets: targets(() => new Map(), []),
      resolveTopic: async () => null,
      report: () => undefined,
    });

    expect((await service.search({}, { locale: 'en' })).state).toBe('initial');
    expect((await service.search({ q: '"*"' }, { locale: 'en' })).state).toBe('invalid');
    expect(fake.queries).toEqual([]);
  });

  it('passes terms, never text, and bounds the page', async () => {
    const fake = fakeIndex();
    const service = createSearchService({
      index: fake.index,
      sources: sources(),
      targets: targets(() => new Map(), []),
      resolveTopic: async (slug) => ({ id: 't-1', slug, name: 'Topic' }),
      report: () => undefined,
    });

    await service.search(
      { q: 'Book "OR" *', topic: 'education', page: '3' },
      { locale: 'ur' },
    );
    expect(fake.queries[0]).toMatchObject({
      terms: ['book', 'or'],
      topicId: 't-1',
      preferredLanguage: 'ur',
      offset: 40,
      limit: 20,
    });
  });
});

describe('processDue — derived work, recorded honestly', () => {
  const doc = (overrides: Record<string, unknown> = {}) => ({
    kind: 'article',
    resourceId: 'a1',
    textLanguage: 'en',
    contentLanguage: 'en',
    title: 'A title',
    summary: 'A summary',
    body: 'Body text',
    year: 2024,
    topicIds: ['t2', 't1', 't1'],
    ...overrides,
  });

  async function settle(project: SearchScopeSource['project']) {
    const fake = fakeIndex();
    fake.pendingClaims.push(claim('article', 'a1'));
    const reported: string[] = [];
    const service = createSearchService({
      index: fake.index,
      sources: sources({ article: { project, list: async () => [] } }),
      targets: targets(() => new Map(), []),
      resolveTopic: async () => null,
      report: (operation) => reported.push(operation),
    });
    const summary = await service.processDue({ budgetMs: 1_000 });
    return { fake, summary, reported };
  }

  it('normalises a valid projection: folded match text, de-duplicated topics, a checksum', async () => {
    const { fake, summary } = await settle(async () => ({
      stamp: '3',
      documents: [doc()],
    }));
    expect(summary.current).toBe(1);
    const [written] = fake.applied[0]?.documents ?? [];
    expect(written?.topicIds).toEqual(['t1', 't2']);
    expect(written?.matchText).toBe('a title\na summary\nbody text');
    expect(written?.checksum).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('a withdrawn scope is applied as empty, which removes it', async () => {
    const { fake } = await settle(async () => null);
    expect(fake.applied[0]?.documents).toEqual([]);
  });

  it('records an owner that cannot answer as source-unavailable', async () => {
    const { fake, reported } = await settle(async () => {
      throw new Error('synthetic owner outage');
    });
    expect(fake.failed).toEqual([
      { claim: claim('article', 'a1'), category: 'source-unavailable' },
    ]);
    expect(reported).toEqual(['search.index.source-unavailable']);
    expect(fake.applied).toEqual([]);
  });

  it('refuses a projection outside the contract before writing anything', async () => {
    for (const bad of [
      doc({ kind: 'video' }),
      doc({ kind: 'work', resourceId: 'a1' }),
      doc({ resourceId: 'someone-else' }),
      doc({ title: '   ' }),
      doc({ year: 0 }),
      doc({ textLanguage: 'not a language' }),
    ]) {
      const { fake } = await settle(async () => ({ stamp: '1', documents: [bad] }));
      expect(fake.failed[0]?.category, JSON.stringify(bad)).toBe('invalid-projection');
      expect(fake.applied).toEqual([]);
    }
    const duplicate = await settle(async () => ({
      stamp: '1',
      documents: [doc(), doc()],
    }));
    expect(duplicate.fake.failed[0]?.category).toBe('invalid-projection');
  });

  it('records an index write failure as index-write-failed', async () => {
    const fake = fakeIndex({
      apply: async () => {
        throw new Error('synthetic write fault');
      },
    });
    fake.pendingClaims.push(claim('article', 'a1'));
    const service = createSearchService({
      index: fake.index,
      sources: sources({
        article: {
          project: async () => ({ stamp: '1', documents: [doc()] }),
          list: async () => [],
        },
      }),
      targets: targets(() => new Map(), []),
      resolveTopic: async () => null,
      report: () => undefined,
    });
    const summary = await service.processDue({ budgetMs: 1_000 });
    expect(summary.retrying).toBe(1);
    expect(fake.failed[0]?.category).toBe('index-write-failed');
  });
});

describe('rebuild and reconcile — bounded enumeration', () => {
  it('enumerates until an EMPTY page, whatever size an owner returns', async () => {
    const fake = fakeIndex();
    let calls = 0;
    // An owner that caps its pages at 3 regardless of what was asked for.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const capped: SearchScopeSource = {
      project: async () => null,
      list: async ({ after }) => {
        calls += 1;
        const start = after === null ? 0 : ids.indexOf(after) + 1;
        return ids.slice(start, start + 3).map((id) => ({ id, stamp: '1' }));
      },
    };
    const service = createSearchService({
      index: fake.index,
      sources: sources({ topic: capped }),
      targets: targets(() => new Map(), []),
      resolveTopic: async () => null,
      report: () => undefined,
    });

    await service.rebuild();
    expect(
      fake.requested.filter((ref) => ref.kind === 'topic').map((ref) => ref.id),
    ).toEqual(ids);
    expect(calls).toBe(4);
  });

  it('reconciles only what differs: missing, stale and orphaned', async () => {
    const fake = fakeIndex({
      scopeStates: async (kind, ids) =>
        new Map(
          kind === 'article'
            ? ids.flatMap((id) =>
                id === 'fresh'
                  ? [[id, { documents: 1, stamp: '5', settled: true }] as const]
                  : id === 'stale'
                    ? [[id, { documents: 1, stamp: '4', settled: true }] as const]
                    : [],
              )
            : [],
        ),
      indexedScopes: async ({ kind, after }) =>
        kind === 'article' && after === null ? ['fresh', 'stale', 'withdrawn'] : [],
    });
    const listed = ['fresh', 'missing', 'stale'];
    const service = createSearchService({
      index: fake.index,
      sources: sources({
        article: {
          project: async () => null,
          list: async ({ after }) =>
            after === null ? listed.map((id) => ({ id, stamp: '5' })) : [],
        },
      }),
      targets: targets(
        (kind, ids) =>
          new Map(
            ids.filter((id) => id !== 'withdrawn').map((id) => [id, `/${kind}/${id}`]),
          ),
        [],
      ),
      resolveTopic: async () => null,
      report: () => undefined,
    });

    expect(await service.reconcile()).toEqual({
      missing: 1,
      stale: 1,
      orphaned: 1,
      retried: 0,
    });
    expect(fake.requested.map((ref) => ref.id).sort()).toEqual([
      'missing',
      'stale',
      'withdrawn',
    ]);
  });
});
