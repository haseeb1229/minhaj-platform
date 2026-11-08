import { describe, expect, it } from 'vitest';

import {
  EDITORIAL_BATCH_LIMIT,
  workflowBatchSchema,
  type ArticleDetail,
  type EditorialPersistencePort,
  type EditorialReferencesPort,
  type EditorialTransition,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  createEditorialService,
  editorialFailure,
} from '../../apps/web/src/contexts/editorial/index.ts';

/**
 * R2 — the second administrator's "approve and publish selected": each named
 * record goes through the single-record workflow (approve, then publish at the
 * version the approval produced), checked and recorded on its own; a refusal
 * is that record's alone, and an outage stops the batch.
 */

const SECOND = 'synthetic-second-administrator';
const MIGRATOR = 'synthetic-migration-publisher';
const BOTH = ['content.review', 'content.publish'];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function record(n: number, overrides: Partial<ArticleDetail> = {}): ArticleDetail {
  return {
    id: id(n),
    slug: `synthetic-${n}`,
    state: 'in-review',
    version: 2,
    currentRevision: 1,
    title: `Synthetic ${n}`,
    updatedAt: new Date(),
    scheduledAt: null,
    scheduleStatus: null,
    creatorId: MIGRATOR,
    approvedRevision: null,
    approvedById: null,
    scheduledById: null,
    scheduledRevision: null,
    revision: {
      number: 1,
      editorId: MIGRATOR,
      createdAt: new Date(),
      slug: `synthetic-${n}`,
      primaryLanguage: 'en',
      topicIds: [],
      contributors: [],
      translations: [],
    },
    ...overrides,
  };
}

function harness(
  records: readonly ArticleDetail[],
  options: {
    readonly permissions?: Readonly<Record<string, readonly string[]>>;
    readonly outageOn?: string;
  } = {},
) {
  const store = new Map(records.map((entry) => [entry.id, { ...entry }]));
  const recorded: { id: string; action: string; actorId: string }[] = [];
  const permissions = options.permissions ?? { [SECOND]: BOTH };
  const transition = async (input: EditorialTransition) => {
    if (input.id === options.outageOn) throw new Error('synthetic outage');
    const current = store.get(input.id)!;
    const next: ArticleDetail = {
      ...current,
      version: current.version + 1,
      ...(input.action === 'approve'
        ? { approvedById: input.actorId, approvedRevision: current.currentRevision }
        : {}),
      ...(input.action === 'publish' ? { state: 'published' } : {}),
    };
    store.set(input.id, next);
    recorded.push({ id: input.id, action: input.action, actorId: input.actorId });
    return next;
  };
  const persistence = {
    news: async (_kind: string, recordId: string) => store.get(recordId) ?? null,
    transitionNews: async (_kind: string, input: EditorialTransition) =>
      transition(input),
    article: async (recordId: string) => store.get(recordId) ?? null,
    transitionArticle: transition,
  } as unknown as EditorialPersistencePort;
  const references = {} as EditorialReferencesPort;
  const service = createEditorialService({
    persistence,
    authority: {
      permits: async (accountId, permission) =>
        (permissions[accountId] ?? []).includes(permission),
    },
    references,
    reportFailure: () => undefined,
  });
  return { service, store, recorded };
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return editorialFailure(error);
  }
  throw new Error('expected a refusal');
}

const items = (...entries: [number, number][]) =>
  entries.map(([n, expectedVersion]) => ({ id: id(n), expectedVersion }));

describe('approveAndPublishMany', () => {
  it('approves then publishes every named record, each as its own recorded transition', async () => {
    const w = harness([record(1), record(2)]);
    const result = await w.service.approveAndPublishMany(
      { accountId: SECOND },
      { kind: 'news-article', items: items([1, 2], [2, 2]) },
    );
    expect(result).toEqual({ decided: 2, refused: [] });
    expect(w.recorded).toEqual([
      { id: id(1), action: 'approve', actorId: SECOND },
      { id: id(1), action: 'publish', actorId: SECOND },
      { id: id(2), action: 'approve', actorId: SECOND },
      { id: id(2), action: 'publish', actorId: SECOND },
    ]);
    expect(w.store.get(id(1))?.state).toBe('published');
    expect(w.store.get(id(2))?.approvedById).toBe(SECOND);
  });

  it.each([
    ['content.review only', ['content.review']],
    ['content.publish only', ['content.publish']],
    ['neither', []],
  ])('refuses an actor holding %s, before anything is done', async (_label, held) => {
    const w = harness([record(1)], { permissions: { [SECOND]: held } });
    expect(
      await refusal(
        w.service.approveAndPublishMany(
          { accountId: SECOND },
          { kind: 'news-article', items: items([1, 2]) },
        ),
      ),
    ).toBe('denied');
    expect(w.recorded).toEqual([]);
  });

  it('refuses self-approval for that record alone — creator or last editor — and continues', async () => {
    const w = harness([
      record(1, { creatorId: SECOND }),
      record(2),
      record(3, {
        revision: { ...record(3).revision, editorId: SECOND },
      }),
    ]);
    const result = await w.service.approveAndPublishMany(
      { accountId: SECOND },
      { kind: 'news-article', items: items([1, 2], [2, 2], [3, 2]) },
    );
    expect(result).toEqual({
      decided: 1,
      refused: [
        { id: id(1), reason: 'self-approval' },
        { id: id(3), reason: 'self-approval' },
      ],
    });
    expect(w.recorded.map((entry) => entry.id)).toEqual([id(2), id(2)]);
    expect(w.store.get(id(1))?.state).toBe('in-review');
  });

  it('refuses a record changed since it was shown, and one no longer in review', async () => {
    const w = harness([record(1), record(2, { state: 'published' }), record(3)]);
    const result = await w.service.approveAndPublishMany(
      { accountId: SECOND },
      { kind: 'article', items: items([1, 1], [2, 2], [3, 2]) },
    );
    expect(result).toEqual({
      decided: 1,
      refused: [
        { id: id(1), reason: 'conflict' },
        { id: id(2), reason: 'invalid-state' },
      ],
    });
    expect(w.recorded.every((entry) => entry.id === id(3))).toBe(true);
  });

  it('refuses publication when the approver no longer holds content.review', async () => {
    // The approval stands (as after a single approve); publication needs the
    // approver's live review authority, and here the check runs once more.
    let calls = 0;
    const w = harness([record(1)]);
    const service = createEditorialService({
      persistence: {
        news: async (_kind: string, recordId: string) => w.store.get(recordId) ?? null,
        transitionNews: async (_kind: string, input: EditorialTransition) => {
          const current = w.store.get(input.id)!;
          const next = {
            ...current,
            version: current.version + 1,
            approvedById: input.actorId,
            approvedRevision: current.currentRevision,
          };
          w.store.set(input.id, next);
          return next;
        },
      } as unknown as EditorialPersistencePort,
      authority: {
        permits: async (_account, permission) =>
          permission !== 'content.review' || (calls += 1) <= 2,
      },
      references: {} as EditorialReferencesPort,
      reportFailure: () => undefined,
    });
    const result = await service.approveAndPublishMany(
      { accountId: SECOND },
      { kind: 'news-article', items: items([1, 2]) },
    );
    expect(result.decided).toBe(0);
    expect(result.refused).toEqual([{ id: id(1), reason: 'approval-required' }]);
  });

  it('stops the batch on an outage, keeping what was done before it', async () => {
    const w = harness([record(1), record(2), record(3)], { outageOn: id(2) });
    await expect(
      w.service.approveAndPublishMany(
        { accountId: SECOND },
        { kind: 'news-article', items: items([1, 2], [2, 2], [3, 2]) },
      ),
    ).rejects.toThrow('synthetic outage');
    expect(w.store.get(id(1))?.state).toBe('published');
    expect(w.recorded.some((entry) => entry.id === id(3))).toBe(false);
  });

  it('refuses a malformed selection before anything is done', async () => {
    const w = harness([record(1)]);
    for (const input of [
      { kind: 'news-article', items: [] },
      { kind: 'sermon', items: items([1, 2]) },
      { kind: 'news-article', items: items([1, 2], [1, 2]) },
      { kind: 'news-article', items: items([1, 0]) },
      { kind: 'news-article', items: items([1, 2]), extra: true },
    ])
      expect(
        await refusal(w.service.approveAndPublishMany({ accountId: SECOND }, input)),
      ).toBe('invalid');
    expect(w.recorded).toEqual([]);
  });
});

describe('workflowBatchSchema', () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ id: id(n + 1), expectedVersion: 1 }));

  it('admits one page and refuses more', () => {
    expect(
      workflowBatchSchema.safeParse({
        kind: 'article',
        items: many(EDITORIAL_BATCH_LIMIT),
      }).success,
    ).toBe(true);
    expect(
      workflowBatchSchema.safeParse({
        kind: 'article',
        items: many(EDITORIAL_BATCH_LIMIT + 1),
      }).success,
    ).toBe(false);
  });

  it('refuses an identifier that is not one, and an unknown field per item', () => {
    expect(
      workflowBatchSchema.safeParse({
        kind: 'article',
        items: [{ id: 'not-an-id', expectedVersion: 1 }],
      }).success,
    ).toBe(false);
    expect(
      workflowBatchSchema.safeParse({
        kind: 'article',
        items: [{ id: id(1), expectedVersion: 1, action: 'archive' }],
      }).success,
    ).toBe(false);
  });
});
