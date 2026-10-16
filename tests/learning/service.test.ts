import { describe, expect, it } from 'vitest';

import type {
  LearnerPort,
  LearningDispositionPort,
  LearningExportPort,
  LearningPersistencePort,
  PathDetail,
} from '../../packages/contracts/src/learning/index.ts';
import {
  createLearnerService,
  createLearningAccountService,
  createLearningService,
  learningFailure,
} from '../../apps/web/src/contexts/learning/index.ts';

/**
 * Phase 22 — the Learning services' rules, over fake ports.
 *
 * WHAT IS PROVED HERE, AND ONLY HERE CHEAPLY: every catalogue read requires
 * `learning.read` and every change `learning.administer`, asked of the
 * authority LIVE, and no other key — a teacher attribution or a would-be
 * `teaching.perform` — opens anything; references are asked of their owners;
 * a learner's every act runs for the session's account and no other; and a
 * closed account's disposition is refused for an account Identity does not
 * report closed. The SQL half is `persistence.integration.test.ts`.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = { accountId: 'account-admin' };

const courseValue = {
  slug: 'non-learning-fixture-course',
  primaryLocale: 'en',
  level: 'beginner',
  format: 'live',
  languageCode: 'en',
  labels: [
    { locale: 'en', title: 'NON_LEARNING_FIXTURE_TITLE', summary: '', description: '' },
  ],
  topicIds: [ID(7)],
  teacherIds: [ID(8)],
};

function admin(
  options: {
    readonly permissions?: readonly string[];
    readonly references?: boolean;
    readonly path?: PathDetail | null;
  } = {},
) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const asked: string[] = [];
  const permissions = new Set(
    options.permissions ?? ['learning.read', 'learning.administer'],
  );
  const persistence = new Proxy({} as LearningPersistencePort, {
    get(_target, method: string) {
      return async (input?: unknown) => {
        calls.push({ method, input });
        if (method === 'path') return options.path ?? null;
        return { done: method };
      };
    },
  });
  const service = createLearningService({
    persistence,
    authority: {
      async permits(accountId, permission) {
        asked.push(`${accountId}:${permission}`);
        return permissions.has(permission);
      },
    },
    references: {
      validPeople: async () => options.references ?? true,
      validTopics: async () => options.references ?? true,
      validLanguage: async () => options.references ?? true,
    },
  });
  return { service, calls, asked };
}

const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return learningFailure(error);
  }
  return 'resolved';
};

describe('the catalogue administration', () => {
  it('reads under learning.read and changes under learning.administer, live', async () => {
    const reader = admin({ permissions: ['learning.read'] });
    await reader.service.courses(ADMIN);
    expect(reader.asked).toEqual(['account-admin:learning.read']);
    expect(await refusal(reader.service.saveCourse(ADMIN, null, null, courseValue))).toBe(
      'denied',
    );
    expect(
      await refusal(reader.service.transitionCourse(ADMIN, ID(1), 1, 'published')),
    ).toBe('denied');
    expect(
      await refusal(
        reader.service.changeModule(ADMIN, ID(1), 1, { op: 'remove', moduleId: ID(2) }),
      ),
    ).toBe('denied');
    expect(reader.calls.map((call) => call.method)).toEqual(['courses']);
  });

  it('opens nothing to an account holding no Learning key, whatever else it holds', async () => {
    const outsider = admin({ permissions: ['teaching.perform', 'media.administer'] });
    expect(await refusal(outsider.service.courses(ADMIN))).toBe('denied');
    expect(await refusal(outsider.service.enrolmentSummary(ADMIN))).toBe('denied');
    expect(await refusal(outsider.service.trialSummary(ADMIN))).toBe('denied');
    expect(outsider.calls).toEqual([]);
  });

  it('refuses a save whose teacher, topic or language its owner does not vouch for', async () => {
    const harness = admin({ references: false });
    expect(
      await refusal(harness.service.saveCourse(ADMIN, null, null, courseValue)),
    ).toBe('invalid');
    expect(harness.calls).toEqual([]);
  });

  it('names a version for an edit and none for a create', async () => {
    const harness = admin();
    expect(await refusal(harness.service.saveCourse(ADMIN, null, 3, courseValue))).toBe(
      'invalid',
    );
    expect(
      await refusal(harness.service.saveCourse(ADMIN, ID(1), null, courseValue)),
    ).toBe('invalid');
    await harness.service.saveCourse(ADMIN, ID(1), 2, courseValue);
    expect(harness.calls.at(-1)).toMatchObject({
      method: 'saveCourse',
      input: { actorId: 'account-admin', id: ID(1), expectedVersion: 2 },
    });
  });

  it('refuses a lifecycle the vocabulary does not have', async () => {
    expect(
      await refusal(admin().service.transitionCourse(ADMIN, ID(1), 1, 'scheduled')),
    ).toBe('invalid');
  });

  it('applies a path change to the version the operator saw, or not at all', async () => {
    const path = {
      id: ID(5),
      version: 4,
      members: [{ id: ID(1) }, { id: ID(2) }],
    } as PathDetail;
    const stale = admin({ path });
    expect(
      await refusal(
        stale.service.changePath(ADMIN, ID(5), 3, { op: 'add', courseId: ID(3) }),
      ),
    ).toBe('conflict');
    expect(
      await refusal(
        stale.service.changePath(ADMIN, ID(5), 4, { op: 'add', courseId: ID(1) }),
      ),
    ).toBe('duplicate-member');
    await stale.service.changePath(ADMIN, ID(5), 4, {
      op: 'move',
      courseId: ID(2),
      direction: 'earlier',
    });
    expect(stale.calls.at(-1)).toMatchObject({
      method: 'setPathCourses',
      input: {
        pathId: ID(5),
        expectedVersion: 4,
        courseIds: [ID(2), ID(1)],
        change: 'move',
      },
    });
  });

  it('reports an adapter refusal as itself and an outage as unavailable', () => {
    expect(learningFailure({ reason: 'in-published-path' })).toBe('in-published-path');
    expect(learningFailure(new Error('connection lost'))).toBe('unavailable');
    expect(learningFailure({ reason: 'not-a-reason' })).toBe('unavailable');
  });
});

function learner(options: { readonly allowed?: boolean; readonly enrol?: boolean } = {}) {
  const calls: { readonly method: string; readonly args: unknown[] }[] = [];
  const port = new Proxy({} as LearnerPort, {
    get(_target, method: string) {
      return async (...args: unknown[]) => {
        calls.push({ method, args });
        if (method === 'enrol' || method === 'requestTrial') return options.enrol ?? true;
        if (method === 'completeLesson') return 'recorded';
        return null;
      };
    },
  });
  const spent: string[] = [];
  const service = createLearnerService({
    learner: port,
    limiter: {
      async consume(key) {
        spent.push(key);
        return { allowed: options.allowed ?? true } as never;
      },
    } as never,
    key: (purpose, subject) => `${purpose}:${subject}`,
  });
  return { service, calls, spent };
}

describe("a learner's own acts", () => {
  it('act for the session account and no other', async () => {
    const harness = learner();
    await harness.service.enrol({ accountId: 'account-a' }, ID(1));
    await harness.service.completeLesson({ accountId: 'account-a' }, ID(1), ID(2));
    await harness.service.requestTrial({ accountId: 'account-a' }, ID(1));
    await harness.service.courses({ accountId: 'account-a' });
    expect(harness.calls.map((call) => call.args[0])).toEqual([
      'account-a',
      'account-a',
      'account-a',
      'account-a',
    ]);
    expect(harness.spent).toEqual([
      'learning-write:account-a',
      'learning-write:account-a',
      'learning-write:account-a',
    ]);
  });

  it('refuses an actor without an account before anything is read', async () => {
    const harness = learner();
    expect(await refusal(harness.service.enrol({ accountId: '' }, ID(1)))).toBe('denied');
    expect(await refusal(harness.service.trials({} as never))).toBe('denied');
    expect(harness.calls).toEqual([]);
  });

  it('refuses a Course that is not enrollable as unavailable, never as success', async () => {
    const harness = learner({ enrol: false });
    expect(await refusal(harness.service.enrol({ accountId: 'a' }, ID(1)))).toBe(
      'course-unavailable',
    );
    expect(await refusal(harness.service.requestTrial({ accountId: 'a' }, ID(1)))).toBe(
      'course-unavailable',
    );
  });

  it('is rate-limited per account', async () => {
    const harness = learner({ allowed: false });
    expect(await refusal(harness.service.enrol({ accountId: 'a' }, ID(1)))).toBe(
      'rate-limited',
    );
    expect(harness.calls).toEqual([]);
  });

  it('answers a malformed slug or identifier as absent rather than querying it', async () => {
    const harness = learner();
    expect(await harness.service.course({ accountId: 'a' }, 'Not A Slug')).toBeNull();
    expect(await harness.service.lesson({ accountId: 'a' }, 'x', ID(1))).toBeNull();
    expect(await refusal(harness.service.enrol({ accountId: 'a' }, 'not-a-uuid'))).toBe(
      'invalid',
    );
    expect(harness.calls).toEqual([]);
  });
});

describe('export and closure', () => {
  function account(closed: readonly string[], allowed = true) {
    const disposed: string[] = [];
    let remaining = 3;
    const service = createLearningAccountService({
      exports: {
        collect: async () => ({
          enrolments: [],
          progress: [],
          trialRequests: [],
          bookings: [],
          classes: [],
          attendance: [],
          availability: [],
          teachingScopes: [],
        }),
      } as LearningExportPort,
      disposition: {
        async disposeAccount(accountId) {
          disposed.push(accountId);
          const batch = Math.min(remaining, 2);
          remaining -= batch;
          return batch;
        },
        accountsWithData: async (after) => (after === null ? ['closed-1', 'live-1'] : []),
      } as LearningDispositionPort,
      accounts: {
        closedAccounts: async (ids) => ids.filter((id) => closed.includes(id)),
      },
      limiter: { consume: async () => ({ allowed }) } as never,
      key: (purpose, subject) => `${purpose}:${subject}`,
      clock: () => new Date('2026-10-15T00:00:00.000Z'),
    });
    return { service, disposed };
  }

  it('exports a deterministic, versioned document of identifiers', async () => {
    expect(await account([]).service.export({ accountId: 'a' })).toEqual({
      schema: 'minhaj.learning.export',
      // Version 2 since Phase 23: the person's own classes join the document.
      version: 2,
      generatedAt: '2026-10-15T00:00:00.000Z',
      enrolments: [],
      progress: [],
      trialRequests: [],
      bookings: [],
      classes: [],
      attendance: [],
      availability: [],
      teachingScopes: [],
    });
    expect(await refusal(account([], false).service.export({ accountId: 'a' }))).toBe(
      'rate-limited',
    );
  });

  it('disposes of a CLOSED account in batches, and refuses a living one', async () => {
    const closed = account(['closed-1']);
    expect(await closed.service.disposeAccount('closed-1')).toEqual({
      removed: 3,
      complete: true,
    });
    expect(await refusal(closed.service.disposeAccount('live-1'))).toBe('denied');
    expect(closed.disposed.every((id) => id === 'closed-1')).toBe(true);
  });

  it('reconciles only the accounts Identity reports closed', async () => {
    const harness = account(['closed-1']);
    expect(await harness.service.reconcileClosedAccounts()).toEqual({
      removed: 3,
      complete: true,
    });
    expect(new Set(harness.disposed)).toEqual(new Set(['closed-1']));
  });
});
