import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R2 (audit F28, F30) — THE ADMINISTRATION DASHBOARD'S QUEUES AND THE AREA
 * ROOTS.
 *
 * Each queue is counted by its owning context's own service and asked for
 * only when the viewer holds the key that opens it; one area failing leaves
 * its card "unavailable" while the others still count. An area's root address
 * sends the reader to the first surface of that area their keys open.
 */

const calls: string[] = [];
const fail = new Set<string>();

function answer<T>(name: string, value: T): Promise<T> {
  calls.push(name);
  return fail.has(name)
    ? Promise.reject(new Error('unavailable'))
    : Promise.resolve(value);
}

vi.mock('@/composition/logging', () => ({
  appLogger: () => ({ warn: () => undefined, error: () => undefined }),
}));
vi.mock('@/composition/editorial', () => ({
  editorialRuntime: () => ({
    editorial: {
      directory: (_actor: unknown, kind: string, offset: number, state: string) =>
        answer(`editorial:${kind}:${String(offset)}:${state}`, {
          items: kind === 'article' ? Array.from({ length: 25 }, () => ({})) : [{}],
          more: kind === 'article',
        }),
    },
  }),
}));
vi.mock('@/composition/migration', () => ({
  migrationRuntime: () => ({
    read: {
      staged: (_actor: unknown, query: unknown) =>
        answer(`staged:${JSON.stringify(query)}`, { rows: [], total: 41, offset: 0 }),
      manifests: (_actor: unknown, query: unknown) =>
        answer(`manifests:${JSON.stringify(query)}`, { rows: [], total: 2, offset: 0 }),
    },
  }),
}));
vi.mock('@/composition/membership', () => ({
  membershipRuntime: () => ({
    admin: { openApplicationCount: () => answer('membership', 3) },
  }),
}));
vi.mock('@/composition/messaging', () => ({
  messagingRuntime: () => ({
    service: {
      reports: () => answer('reports', { reports: [{}, {}], next: null }),
      supportQueue: () => answer('support', { items: [{}], next: 'cursor' }),
    },
  }),
}));
vi.mock('@/composition/donations', () => ({
  donationsRuntime: () => ({ admin: { attentionCount: () => answer('donations', 0) } }),
}));
vi.mock('@/composition/fatwa', () => ({
  fatwaRuntime: () => ({
    workflow: {
      intake: () => answer('intake', { items: [], total: 5, offset: 0 }),
      reviewQueue: () => answer('review', { items: [], total: 1, offset: 0 }),
    },
  }),
}));
vi.mock('@/composition/learning', () => ({
  learningRuntime: () => ({
    learning: {
      trialSummary: () =>
        answer('trials', { items: [{ requests: 2 }, { requests: 4 }], hasMore: false }),
    },
  }),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock('@/config/route-locale', () => ({ requireLocale: vi.fn() }));
vi.mock('@/composition/authorization', () => ({ requireOwnSession: vi.fn() }));
vi.mock('@/composition/identity', () => ({ identityRuntime: vi.fn() }));

const { dashboardQueues } =
  await import('../../apps/web/src/app/[locale]/admin/dashboard.ts');
const { areaEntry } = await import('../../apps/web/src/app/[locale]/admin/area-root.ts');

const actor = { accountId: 'operator' };

beforeEach(() => {
  calls.length = 0;
  fail.clear();
});

describe('the dashboard queues', () => {
  it('asks only for the queues the viewer’s keys open', async () => {
    const queues = await dashboardQueues(
      actor,
      new Set(['membership.read', 'donations.read']),
    );
    expect(queues.map((queue) => queue.key)).toEqual([
      'membershipApplications',
      'donationsAttention',
    ]);
    expect(calls).toEqual(['membership', 'donations']);
  });

  it('holds no card at all for a viewer with no queue key', async () => {
    expect(await dashboardQueues(actor, new Set(['audit.read', 'users.read']))).toEqual(
      [],
    );
    expect(calls).toEqual([]);
  });

  it('counts each queue from its owner, linking to the filtered queue', async () => {
    const queues = await dashboardQueues(
      actor,
      new Set([
        'migration.read',
        'messaging.moderate',
        'messaging.support',
        'question.receive',
        'fatwa.publish',
        'learning.read',
      ]),
    );
    expect(Object.fromEntries(queues.map((queue) => [queue.key, queue]))).toEqual({
      migrationStaged: {
        key: 'migrationStaged',
        path: 'migration/staging?review=pending',
        count: { count: 41, more: false },
      },
      migrationManifests: {
        key: 'migrationManifests',
        path: 'migration/manifests?state=draft',
        count: { count: 2, more: false },
      },
      messagingReports: {
        key: 'messagingReports',
        path: 'messaging/reports',
        count: { count: 2, more: false },
      },
      // A cursor behind the first page: "1+", never a guessed total.
      messagingSupport: {
        key: 'messagingSupport',
        path: 'messaging/support',
        count: { count: 1, more: true },
      },
      fatwaIntake: {
        key: 'fatwaIntake',
        path: 'fatwa/questions',
        count: { count: 5, more: false },
      },
      fatwaReview: {
        key: 'fatwaReview',
        path: 'fatwa/review',
        count: { count: 1, more: false },
      },
      learningTrials: {
        key: 'learningTrials',
        path: 'learning/trials',
        count: { count: 6, more: false },
      },
    });
    expect(calls).toContain('staged:{"review":"pending"}');
    expect(calls).toContain('manifests:{"state":"draft"}');
  });

  it('adds up the editorial review queue across every kind, bounded per kind', async () => {
    const [queue] = await dashboardQueues(actor, new Set(['content.review']));
    expect(queue?.key).toBe('editorialReview');
    expect(queue?.count?.more).toBe(true);
    expect(queue?.count?.count).toBeGreaterThanOrEqual(25);
    expect(calls.every((call) => call.endsWith(':0:in-review'))).toBe(true);
  });

  it('says one area is unavailable without hiding the others', async () => {
    fail.add('membership');
    const queues = await dashboardQueues(
      actor,
      new Set(['membership.read', 'donations.read']),
    );
    expect(queues).toEqual([
      { key: 'membershipApplications', path: 'membership/applications', count: null },
      {
        key: 'donationsAttention',
        path: 'donations?attention=1',
        count: { count: 0, more: false },
      },
    ]);
  });
});

describe('an area root', () => {
  it('sends the reader to the first surface of that area their keys open', () => {
    expect(areaEntry('identity', new Set(['users.read', 'roles.read']))).toBe(
      'identity/users',
    );
    expect(areaEntry('identity', new Set(['assignments.read']))).toBe(
      'identity/assignments',
    );
    expect(areaEntry('system', new Set(['audit.read']))).toBe('system/audit');
    expect(areaEntry('quran', new Set(['quran.read']))).toBe('quran/surahs');
    expect(areaEntry('editorial', new Set(['content.read']))).toBe('editorial/articles');
    expect(areaEntry('communications', new Set(['delivery.read']))).toBe(
      'communications/delivery',
    );
  });

  it('opens nothing for keys of another area', () => {
    expect(areaEntry('identity', new Set(['audit.read']))).toBeNull();
    expect(areaEntry('hadith', new Set(['quran.read']))).toBeNull();
    expect(areaEntry('system', new Set())).toBeNull();
  });
});
