import { describe, expect, it } from 'vitest';

import type {
  ClassAdminPort,
  ClassCommunicationPort,
  ClassLearnerPort,
  ClassSessionView,
  CourseListing,
  TeachingPort,
} from '../../packages/contracts/src/learning/index.ts';
import type {
  AuditEvent,
  DeliveryRecord,
} from '../../packages/contracts/src/platform/index.ts';
import {
  createClassAdminService,
  createClassCommunicationService,
  createClassLearnerService,
  createTeachingService,
  learningFailure,
} from '../../apps/web/src/contexts/learning/index.ts';

/**
 * Phase 23 — the class services' rules, over fake ports.
 *
 * WHAT IS PROVED HERE, AND ONLY HERE CHEAPLY: a teacher is identified by
 * Identity's LIVE assignments on EVERY call and by nothing else — not a
 * profile, not a role name, not a form field — and an empty answer is a
 * denial; nothing opens while live learning is not activated; the class keys
 * open the operator surface and `learning.read` does not; scoping admits only
 * an account Identity AND People vouch for and grants no key; identity reads
 * are audited by identifier only; a learner's acts carry the session's account
 * and no other; and a relayed or rendered message is owed only while the
 * re-check says so, is addressed by Identity, and never carries a meeting
 * address. The SQL half is `classes.integration.test.ts`.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-01T12:00:00Z');
const limiter = { consume: async () => ({ allowed: true, retryAfter: null }) };
const key = (purpose: string, subject: string) => `${purpose}:${subject}`;

const course: CourseListing = {
  id: ID(1),
  slug: 'non-learning-fixture-live',
  primaryLocale: 'en',
  state: 'published',
  level: null,
  format: 'live',
  languageCode: 'en',
  labels: [{ locale: 'en', title: 'NON_LEARNING_FIXTURE_TITLE', summary: '' }],
  teacherIds: [],
  modules: 1,
  lessons: 1,
  version: 1,
  updatedAt: NOW,
};

const session = (over: Partial<ClassSessionView['session']> = {}): ClassSessionView => ({
  course,
  session: {
    id: ID(2),
    courseId: ID(1),
    kind: 'course',
    teachingScopeId: ID(3),
    teacherAccountId: 'account-teacher',
    startsAt: new Date('2026-10-10T14:00:00Z'),
    endsAt: new Date('2026-10-10T15:00:00Z'),
    timeZone: 'Asia/Karachi',
    startsLocal: '2026-10-10T19:00',
    endsLocal: '2026-10-10T20:00',
    state: 'scheduled',
    meetingProvider: 'google-meet',
    hasMeetingUrl: true,
    reminderAt: new Date('2026-10-10T13:00:00Z'),
    version: 1,
    createdAt: NOW,
    closedAt: null,
    ...over,
  },
});

const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return learningFailure(error);
  }
  return 'resolved';
};

function recorder<T extends object>() {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const answers = new Map<string, unknown>();
  const port = new Proxy({} as T, {
    get(_target, method: string) {
      return async (...input: unknown[]) => {
        calls.push({ method, input: input.length === 1 ? input[0] : input });
        return answers.has(method) ? answers.get(method) : null;
      };
    },
  });
  return { port, calls, answers };
}

function teaching(
  options: {
    readonly assignments?: readonly string[];
    readonly activated?: boolean;
  } = {},
) {
  const store = recorder<TeachingPort>();
  const audited: AuditEvent[] = [];
  const asked: string[] = [];
  const service = createTeachingService({
    teaching: store.port,
    authority: {
      permits: async () => false,
      liveTeachingAssignments: async (accountId) => {
        asked.push(accountId);
        return options.assignments ?? [ID(9)];
      },
    },
    activation: {
      activeMode: async () => (options.activated === false ? null : 'fixture'),
    },
    audit: { record: async (event) => void audited.push(event) },
    limiter,
    key,
    clock: () => NOW,
  });
  return { service, store, audited, asked };
}

describe('the Teacher area', () => {
  it('asks Identity for live teaching assignments on every call and carries them into the adapter', async () => {
    const t = teaching({ assignments: [ID(9), ID(8)] });
    t.store.answers.set('courses', []);
    await t.service.courses({ accountId: 'account-teacher' });
    await t.service.availability({ accountId: 'account-teacher' });
    expect(t.asked).toEqual(['account-teacher', 'account-teacher']);
    expect(t.store.calls[0]).toEqual({
      method: 'courses',
      input: { accountId: 'account-teacher', assignmentIds: [ID(9), ID(8)] },
    });
  });

  it('denies an account with no live assignment, whatever profile or attribution it has', async () => {
    const t = teaching({ assignments: [] });
    expect(await t.service.access({ accountId: 'account-profile-only' })).toBe(
      'not-a-teacher',
    );
    expect(await refusal(t.service.courses({ accountId: 'account-profile-only' }))).toBe(
      'not-a-teacher',
    );
    expect(
      await refusal(t.service.meetingUrl({ accountId: 'account-profile-only' }, ID(2))),
    ).toBe('not-a-teacher');
    expect(
      await refusal(
        t.service.openAvailability({ accountId: 'account-profile-only' }, {}),
      ),
    ).toBe('not-a-teacher');
    expect(t.store.calls).toEqual([]);
  });

  it('is unavailable while live learning is not activated, before Identity is even asked', async () => {
    const t = teaching({ activated: false });
    expect(await t.service.access({ accountId: 'account-teacher' })).toBe(
      'not-activated',
    );
    expect(
      await refusal(t.service.session({ accountId: 'account-teacher' }, ID(2))),
    ).toBe('not-activated');
    expect(t.asked).toEqual([]);
    expect(t.store.calls).toEqual([]);
  });

  it('audits student-data reads by identifier only', async () => {
    const t = teaching();
    t.store.answers.set('students', {
      items: [{ accountId: 'account-learner', courses: [] }],
      hasMore: false,
    });
    t.store.answers.set('student', {
      accountId: 'account-learner',
      courses: [],
      classes: [],
    });
    await t.service.students({ accountId: 'account-teacher' }, ID(1));
    await t.service.student({ accountId: 'account-teacher' }, 'account-learner');
    expect(
      t.audited.map((event) => [event.action, event.targetType, event.targetId]),
    ).toEqual([
      ['learning.students.listed', 'course', ID(1)],
      ['learning.student.accessed', 'account', 'account-learner'],
    ]);
    expect(JSON.stringify(t.audited)).not.toMatch(/meet\.google|name|email/u);
  });

  it('canonicalises a meeting address and refuses a lookalike before the adapter sees it', async () => {
    const t = teaching();
    t.store.answers.set('setMeeting', session());
    await t.service.setMeeting({ accountId: 'account-teacher' }, ID(2), 1, {
      provider: 'google-meet',
      url: 'https://meet.google.com/ABC-DEFG-HIJ/',
    });
    expect(t.store.calls.at(-1)?.input).toMatchObject({
      meeting: { provider: 'google-meet', url: 'https://meet.google.com/abc-defg-hij' },
    });
    expect(
      await refusal(
        t.service.setMeeting({ accountId: 'account-teacher' }, ID(2), 1, {
          provider: 'google-meet',
          url: 'https://meet.google.com@evil.example/abc-defg-hij',
        }),
      ),
    ).toBe('invalid-meeting');
  });

  it('keeps the reminder lead when a class is moved, and refuses a skipped wall time', async () => {
    const t = teaching();
    t.store.answers.set('session', session());
    t.store.answers.set('reschedule', session());
    await t.service.reschedule({ accountId: 'account-teacher' }, ID(2), 1, {
      timeZone: 'Asia/Karachi',
      startsLocal: '2026-10-12T19:00',
      endsLocal: '2026-10-12T20:00',
    });
    const moved = t.store.calls.at(-1)?.input as {
      schedule: { startsAt: Date; reminderAt: Date | null };
    };
    expect(moved.schedule.startsAt.toISOString()).toBe('2026-10-12T14:00:00.000Z');
    expect(moved.schedule.reminderAt?.toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(
      await refusal(
        t.service.reschedule({ accountId: 'account-teacher' }, ID(2), 1, {
          timeZone: 'Europe/London',
          startsLocal: '2027-03-28T01:30',
          endsLocal: '2027-03-28T02:30',
        }),
      ),
    ).toBe('nonexistent-time');
  });
});

function admin(
  options: {
    readonly permissions?: readonly string[];
    readonly teachers?: readonly string[];
    readonly listed?: readonly string[];
    readonly activated?: boolean;
  } = {},
) {
  const store = recorder<ClassAdminPort>();
  const audited: AuditEvent[] = [];
  const permissions = new Set(
    options.permissions ?? ['learning.classes.read', 'learning.classes.administer'],
  );
  const service = createClassAdminService({
    admin: store.port,
    authority: {
      permits: async (_account, permission) => permissions.has(permission),
      liveTeachingAssignments: async (accountId) =>
        (options.teachers ?? ['account-teacher']).includes(accountId) ? [ID(9)] : [],
    },
    activation: {
      activeMode: async () => (options.activated === false ? null : 'fixture'),
    },
    directory: {
      teacherAccounts: async (ids) =>
        ids.filter((id) => (options.listed ?? ['account-teacher']).includes(id)),
    },
    audit: { record: async (event) => void audited.push(event) },
    clock: () => NOW,
  });
  return { service, store, audited };
}

describe('the class administration', () => {
  it('opens under the class keys only — learning.read and learning.administer see nothing here', async () => {
    const catalogue = admin({ permissions: ['learning.read', 'learning.administer'] });
    expect(await refusal(catalogue.service.trialRequests({ accountId: 'a' }, null))).toBe(
      'denied',
    );
    expect(await refusal(catalogue.service.sessions({ accountId: 'a' }))).toBe('denied');
    expect(catalogue.store.calls).toEqual([]);
    const reader = admin({ permissions: ['learning.classes.read'] });
    reader.store.answers.set('sessions', { items: [], hasMore: false });
    await reader.service.sessions({ accountId: 'a' });
    expect(await refusal(reader.service.cancel({ accountId: 'a' }, ID(2), 1))).toBe(
      'denied',
    );
    expect(
      await refusal(
        reader.service.grantScope({ accountId: 'a' }, ID(1), 'account-teacher'),
      ),
    ).toBe('denied');
  });

  it('scopes only an account Identity reports live for teaching.perform AND People lists, naming that assignment', async () => {
    const a = admin();
    a.store.answers.set('grantScope', { scope: {}, course });
    await a.service.grantScope({ accountId: 'operator' }, ID(1), 'account-teacher');
    expect(a.store.calls.at(-1)).toEqual({
      method: 'grantScope',
      input: {
        actorId: 'operator',
        courseId: ID(1),
        accountId: 'account-teacher',
        roleAssignmentId: ID(9),
      },
    });
    const noGrant = admin({ teachers: [] });
    expect(
      await refusal(
        noGrant.service.grantScope({ accountId: 'operator' }, ID(1), 'account-teacher'),
      ),
    ).toBe('not-a-teacher');
    const noProfile = admin({ listed: [] });
    expect(
      await refusal(
        noProfile.service.grantScope({ accountId: 'operator' }, ID(1), 'account-teacher'),
      ),
    ).toBe('not-a-teacher');
    expect(noProfile.store.calls).toEqual([]);
  });

  it('confirms a trial only while activated, for a window whose owner holds a live grant now', async () => {
    const off = admin({ activated: false });
    expect(
      await refusal(
        off.service.confirmTrial(
          { accountId: 'operator' },
          { requestId: ID(5), availabilityId: ID(6) },
        ),
      ),
    ).toBe('not-activated');
    const a = admin();
    a.store.answers.set('availabilityOwner', 'account-teacher');
    a.store.answers.set('confirmTrial', { booking: {}, session: session() });
    await a.service.confirmTrial(
      { accountId: 'operator' },
      { requestId: ID(5), availabilityId: ID(6), reminderLeadMinutes: 60 },
    );
    expect(a.store.calls.at(-1)?.input).toEqual({
      actorId: 'operator',
      requestId: ID(5),
      availabilityId: ID(6),
      teacherAssignmentIds: [ID(9)],
      reminderLeadMinutes: 60,
    });
    const revoked = admin({ teachers: [] });
    revoked.store.answers.set('availabilityOwner', 'account-teacher');
    expect(
      await refusal(
        revoked.service.confirmTrial(
          { accountId: 'operator' },
          { requestId: ID(5), availabilityId: ID(6) },
        ),
      ),
    ).toBe('not-a-teacher');
  });

  it('audits identity reads and never a mutation of Identity', async () => {
    const a = admin();
    a.store.answers.set('trialRequests', {
      items: [
        {
          id: ID(5),
          accountId: 'account-learner',
          course,
          requestedAt: NOW,
          booking: null,
        },
      ],
      hasMore: false,
    });
    a.store.answers.set('participants', [
      { accountId: 'account-learner', participation: 'enrolment', attendance: null },
    ]);
    await a.service.trialRequests({ accountId: 'operator' }, null);
    await a.service.participants({ accountId: 'operator' }, ID(2));
    expect(a.audited.map((event) => event.action)).toEqual([
      'learning.trial-requests.accessed',
      'learning.participants.accessed',
    ]);
    expect(Object.keys(a.service)).not.toContain('grantPermission');
  });

  it('replaces a teacher only onto a current scope whose teacher holds a live grant', async () => {
    const a = admin();
    a.store.answers.set('scope', {
      scope: { id: ID(3), accountId: 'account-teacher', endedAt: null },
      course,
    });
    a.store.answers.set('replaceTeacher', session());
    await a.service.replaceTeacher({ accountId: 'operator' }, ID(2), 1, ID(3));
    expect(a.store.calls.at(-1)?.input).toMatchObject({
      scopeId: ID(3),
      teacherAssignmentIds: [ID(9)],
    });
    a.store.answers.set('scope', {
      scope: { id: ID(3), accountId: 'account-teacher', endedAt: NOW },
      course,
    });
    expect(
      await refusal(a.service.replaceTeacher({ accountId: 'operator' }, ID(2), 1, ID(3))),
    ).toBe('not-a-teacher');
  });
});

describe('My Classes', () => {
  it('acts for the session account only and discloses a link only while activated', async () => {
    const store = recorder<ClassLearnerPort>();
    let activated = true;
    const service = createClassLearnerService({
      classes: store.port,
      activation: { activeMode: async () => (activated ? 'fixture' : null) },
      limiter,
      key,
      clock: () => NOW,
    });
    store.answers.set('meetingUrl', 'https://meet.google.com/abc-defg-hij');
    expect(await service.meetingUrl({ accountId: 'account-learner' }, ID(2))).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(store.calls.at(-1)).toEqual({
      method: 'meetingUrl',
      input: ['account-learner', ID(2)],
    });
    activated = false;
    expect(await service.meetingUrl({ accountId: 'account-learner' }, ID(2))).toBeNull();
    expect(await refusal(service.cancelBooking({ accountId: '' }, ID(7), 1))).toBe(
      'denied',
    );
    expect(
      await service.session({ accountId: 'account-learner' }, 'not-an-id'),
    ).toBeNull();
  });
});

describe('class communication', () => {
  function communication(
    options: {
      readonly owed?: boolean;
      readonly recipient?: boolean;
      readonly state?: 'pending' | 'relayed' | 'abandoned';
    } = {},
  ) {
    const store = recorder<ClassCommunicationPort>();
    const enqueued: unknown[] = [];
    const intent = {
      id: ID(11),
      purpose: 'learning.class-reminder' as const,
      sessionId: ID(2),
      accountId: 'account-learner',
      dueAt: NOW,
      state: options.state ?? 'pending',
      idempotencyKey: `learning.class-reminder:${ID(2)}:account-learner:1`,
    };
    store.answers.set('claimDue', [intent]);
    store.answers.set('deliverySource', {
      intent,
      session: session(),
      recipientRole: 'learner',
      owed: options.owed ?? true,
    });
    const service = createClassCommunicationService({
      communication: store.port,
      recipients: {
        recipients: async (ids) =>
          options.recipient === false
            ? []
            : ids.map((accountId) => ({
                accountId,
                email: `${accountId}@learning-proof.invalid`,
                locale: 'ur',
              })),
      },
      enqueue: async (delivery) => void enqueued.push(delivery),
      baseUrl: 'https://example.invalid',
      clock: () => NOW,
    });
    return { service, store, enqueued, intent };
  }

  it("relays an owed intent to Identity's current address with the intent's own key, then marks it relayed", async () => {
    const c = communication();
    expect(await c.service.relayPendingIntents(10)).toBe(1);
    expect(c.enqueued).toEqual([
      {
        purpose: 'learning.class-reminder',
        recipient: 'account-learner@learning-proof.invalid',
        sourceReference: `learning:${ID(11)}`,
        idempotencyKey: c.intent.idempotencyKey,
      },
    ]);
    expect(c.store.calls.map((call) => call.method)).toEqual([
      'claimDue',
      'deliverySource',
      'markRelayed',
    ]);
  });

  it('abandons what is no longer owed, and what has no active recipient', async () => {
    const stale = communication({ owed: false });
    expect(await stale.service.relayPendingIntents(10)).toBe(0);
    expect(stale.store.calls.map((call) => call.method)).toEqual([
      'claimDue',
      'deliverySource',
      'markAbandoned',
    ]);
    const closed = communication({ recipient: false });
    expect(await closed.service.relayPendingIntents(10)).toBe(0);
    expect(closed.enqueued).toEqual([]);
  });

  it("renders at send time in the recipient's locale with a link to their own page, never a meeting address", async () => {
    const c = communication({ state: 'relayed' });
    const delivery: DeliveryRecord = {
      id: ID(12),
      purpose: 'learning.class-reminder',
      sourceReference: `learning:${ID(11)}`,
      idempotencyKey: c.intent.idempotencyKey,
      status: 'sending',
      attemptCount: 0,
    };
    const resolved = await c.service.resolveDelivery(delivery);
    expect(resolved.outcome).toBe('send');
    if (resolved.outcome !== 'send') return;
    expect(resolved.message.recipient).toBe('account-learner@learning-proof.invalid');
    expect(resolved.message.html).toContain('<html lang="ur" dir="rtl">');
    expect(resolved.message.text).toContain(
      `https://example.invalid/ur/my/classes/${ID(2)}`,
    );
    expect(resolved.message.text).not.toMatch(/meet\.google/u);
    expect(
      await c.service.resolveDelivery({
        ...delivery,
        purpose: 'identity.password-reset',
      }),
    ).toEqual({ outcome: 'nothing-owed' });
    const gone = communication({ owed: false, state: 'relayed' });
    expect(await gone.service.resolveDelivery(delivery)).toEqual({
      outcome: 'nothing-owed',
    });
  });
});
