import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  NEWSLETTER_CONFIRMATION_HOURS,
  NOTIFICATION_CATEGORIES,
  PERSONAL_EXPORT_SCHEMA,
  PERSONAL_EXPORT_VERSION,
  PERSONAL_LIMITS,
  isInternalDestination,
  maskEmail,
  newsletterSubmissionSchema,
  targetKey,
  type NewsletterIssue,
  type NewsletterPort,
  type PersonalDispositionPort,
  type PersonalExport,
  type PersonalExportPort,
  type PersonalHistoryPort,
  type PersonalNotificationPort,
  type PersonalPurgePort,
  type PersonalSavedPort,
  type PersonalSettingsPort,
  type PersonalTarget,
} from '../../packages/contracts/src/personalisation/index.ts';
import type {
  DeliveryRecord,
  RateLimitRule,
  RateLimiterPort,
} from '../../packages/contracts/src/platform/index.ts';
import {
  EXPORT_RULE,
  HISTORY_RULE,
  NEWSLETTER_ADDRESS_RULE,
  NEWSLETTER_CLIENT_RULE,
  NEWSLETTER_LINK_RULE,
  NEWSLETTER_MAIL_LOCALES,
  NOTIFICATION_BULK_RULE,
  PERSONAL_REFUSAL_REASONS,
  PersonalRefusal,
  WRITE_RULE,
  createAccountService,
  createHistoryService,
  createNewsletterLinkReader,
  createNewsletterService,
  createNotificationService,
  createSavedService,
  createSettingsService,
  isPersonalRefusalReason,
  personalFailure,
  withDefaults,
  type PersonalActor,
} from '../../apps/web/src/contexts/personalisation-notifications/index.ts';
import { renderNewsletterConfirmation } from '../../apps/web/src/contexts/personalisation-notifications/application/newsletter-mail.ts';

/**
 * Phase 21 — the Personalisation & Notifications services' rules, over fake
 * ports.
 *
 * WHAT IS PROVED HERE, CHEAPLY: the actor is checked before anything is read
 * or spent; a spent rate budget refuses before any port is reached; a target
 * that is not public now is refused EXACTLY like one that does not exist,
 * while removing what is already held never asks; malformed input never
 * reaches a port; an adapter refusal keeps its category and an outage stays an
 * outage; the export is one fixed document with no newsletter in it; and a
 * newsletter link is a 256-bit, purpose-bound token whose hash alone is ever
 * handed to storage. What only the database can prove is in
 * `persistence.integration.test.ts`.
 */

const ID = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const ACTOR: PersonalActor = { accountId: 'proof-account-1' };
const ARTICLE: PersonalTarget = { kind: 'article', id: ID(1) };
const CLOCK = new Date('2031-03-04T05:06:07.000Z');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * A port that records every call and answers from `answers`, or with a
 * neutral default. Anything unexpected is visible in `calls`.
 */
function fake<T extends object>(
  answers: Partial<Record<string, (...args: unknown[]) => unknown>> = {},
): { port: T; calls: Call[] } {
  const calls: Call[] = [];
  const port = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args });
          const answer = answers[method];
          return answer === undefined ? undefined : answer(...args);
        },
    },
  ) as T;
  return { port, calls };
}

function limiter(allowed = true) {
  const consumed: { key: string; rule: RateLimitRule }[] = [];
  const port: RateLimiterPort = {
    consume: async (key, rule) => {
      consumed.push({ key, rule });
      return { allowed, retryAfter: allowed ? null : 60 };
    },
    purgeExpired: async () => 0,
  };
  return { port, consumed };
}

const key = (purpose: string, subject: string) => `${purpose}|${subject}`;

/** What a target's owner says: public, or not — and nothing else. */
function targets(publicIds: readonly string[] = [ID(1)]) {
  const asked: PersonalTarget[] = [];
  return {
    asked,
    port: {
      available: async (target: PersonalTarget) => {
        asked.push(target);
        return target.kind === 'ayah' ? target.ayah <= 7 : publicIds.includes(target.id);
      },
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return 'accepted';
}

/** Runs `work` so that a synchronous throw arrives as a rejection too. */
const settle = (work: () => Promise<unknown>) => Promise.resolve().then(work);

const reasonOf = async (promise: Promise<unknown>) => {
  const outcome = await refusal(promise);
  return outcome === 'accepted' ? outcome : personalFailure(outcome);
};

/* ===========================================================================
 * Refusals
 * ========================================================================= */

describe('the refusal vocabulary', () => {
  it('is a closed list of categories', () => {
    expect([...PERSONAL_REFUSAL_REASONS]).toEqual([
      'denied',
      'not-found',
      'conflict',
      'invalid',
      'invalid-state',
      'limit',
      'rate-limited',
      'unavailable',
    ]);
    expect(isPersonalRefusalReason('conflict')).toBe(true);
    expect(isPersonalRefusalReason('constructor')).toBe(false);
    expect(isPersonalRefusalReason(undefined)).toBe(false);
  });

  it('maps every failure to a reason, and anything unrecognised to unavailable', () => {
    expect(personalFailure(new PersonalRefusal('limit'))).toBe('limit');
    expect(personalFailure({ reason: 'conflict' })).toBe('conflict');
    expect(personalFailure(z.string().safeParse(1).error)).toBe('invalid');
    expect(personalFailure({ reason: 'select * from note' })).toBe('unavailable');
    expect(personalFailure(new Error('conflict'))).toBe('unavailable');
    expect(personalFailure(null)).toBe('unavailable');
    expect(personalFailure('denied')).toBe('unavailable');
  });

  it('carries an adapter refusal through as a domain refusal, and an outage as itself', async () => {
    const adapterRefusal = Object.assign(new Error('conflict'), { reason: 'conflict' });
    const outage = new Error('connection reset');
    for (const [thrown, expected] of [
      [adapterRefusal, 'conflict'],
      [outage, 'unavailable'],
    ] as const) {
      const saved = fake<PersonalSavedPort>({
        bookmark: () => {
          throw thrown;
        },
      });
      const service = createSavedService({
        saved: saved.port,
        targets: targets().port,
        limiter: limiter().port,
        key,
      });
      const error = await refusal(service.bookmark(ACTOR, ARTICLE));
      expect(personalFailure(error)).toBe(expected);
      if (expected === 'conflict') expect(error).toBeInstanceOf(PersonalRefusal);
      else expect(error).toBe(outage);
    }
  });
});

/* ===========================================================================
 * The actor, the rate budget and the input — checked before any port
 * ========================================================================= */

function services(options: { allowed?: boolean; publicIds?: readonly string[] } = {}) {
  const saved = fake<PersonalSavedPort>({
    bookmarks: () => ({ items: [], total: 0, offset: 0 }),
    writeNote: () => ({ version: 1 }),
    addToCollection: () => ({ version: 2 }),
    removeFromCollection: () => ({ version: 2 }),
    targetState: () => ({ bookmarked: false, note: null, collections: [] }),
  });
  const history = fake<PersonalHistoryPort>({
    setQuranProgress: () => ({ version: 1 }),
    quranProgress: () => ({
      surah: 1,
      ayah: 2,
      version: 3,
      updatedAt: CLOCK.toISOString(),
    }),
  });
  const settings = fake<PersonalSettingsPort>({
    settings: () => ({
      onboarding: null,
      interests: [],
      goals: [],
      historyEnabled: true,
      version: 0,
    }),
  });
  const notifications = fake<PersonalNotificationPort>({
    produce: () => 'created',
    unread: () => 0,
    preferences: () => [],
  });
  const exports = fake<PersonalExportPort>({ collect: () => COLLECTED });
  const owner = targets(options.publicIds);
  const budget = limiter(options.allowed ?? true);
  const common = { limiter: budget.port, key };
  return {
    saved,
    history,
    settings,
    notifications,
    exports,
    owner,
    budget,
    savedService: createSavedService({
      saved: saved.port,
      targets: owner.port,
      ...common,
    }),
    historyService: createHistoryService({
      history: history.port,
      targets: owner.port,
      clock: () => CLOCK,
      ...common,
    }),
    settingsService: createSettingsService({
      settings: settings.port,
      saved: saved.port,
      history: history.port,
      clock: () => CLOCK,
      ...common,
    }),
    notificationService: createNotificationService({
      notifications: notifications.port,
      ids: () => ID(900),
      clock: () => CLOCK,
      ...common,
    }),
    accountService: createAccountService({
      exports: exports.port,
      disposition: fake<PersonalDispositionPort>().port,
      purge: fake<PersonalPurgePort>().port,
      accounts: { closedAccounts: async () => [] },
      clock: () => CLOCK,
      ...common,
    }),
  };
}

describe('the actor is the session’s account, checked first', () => {
  it.each([
    ['an empty id', { accountId: '' }],
    ['an over-long id', { accountId: 'x'.repeat(37) }],
    ['a non-string id', { accountId: 42 as unknown as string }],
  ])('refuses %s before any port or budget is touched', async (_label, actor) => {
    const h = services();
    const attempts = [
      h.savedService.bookmarks(actor, 0),
      h.savedService.bookmark(actor, ARTICLE),
      h.savedService.collections(actor),
      h.historyService.reading(actor, 0),
      h.historyService.recordRead(actor, ARTICLE),
      h.settingsService.settings(actor),
      h.settingsService.targetState(actor, ARTICLE),
      h.notificationService.unread(actor),
      h.notificationService.markAllRead(actor),
      h.accountService.export(actor),
    ];
    for (const attempt of attempts) expect(await reasonOf(attempt)).toBe('denied');
    expect(h.saved.calls).toEqual([]);
    expect(h.history.calls).toEqual([]);
    expect(h.settings.calls).toEqual([]);
    expect(h.notifications.calls).toEqual([]);
    expect(h.exports.calls).toEqual([]);
    expect(h.budget.consumed).toEqual([]);
  });

  it('passes exactly the session’s account to the port, never anything the input names', async () => {
    const h = services();
    await h.savedService.bookmark(ACTOR, { ...ARTICLE });
    expect(h.saved.calls[0]?.args[0]).toBe(ACTOR.accountId);
    expect(
      await reasonOf(
        h.savedService.bookmark(ACTOR, { ...ARTICLE, accountId: 'proof-account-2' }),
      ),
    ).toBe('invalid');
  });
});

describe('a spent rate budget refuses before any port', () => {
  it('refuses owner writes, history, exports and bulk actions alike', async () => {
    const h = services({ allowed: false });
    for (const attempt of [
      h.savedService.bookmark(ACTOR, ARTICLE),
      h.savedService.unbookmark(ACTOR, ARTICLE),
      h.savedService.createCollection(ACTOR, {
        title: 'NON_PERSONAL_FIXTURE',
        description: null,
      }),
      h.historyService.recordRead(ACTOR, ARTICLE),
      h.historyService.clear(ACTOR),
      h.settingsService.setHistory(ACTOR, { enabled: true, expectedVersion: 0 }),
      h.notificationService.markAllRead(ACTOR),
      h.notificationService.markRead(ACTOR, ID(5)),
      h.accountService.export(ACTOR),
    ])
      expect(await reasonOf(attempt)).toBe('rate-limited');
    expect(h.saved.calls).toEqual([]);
    expect(h.history.calls).toEqual([]);
    expect(h.settings.calls).toEqual([]);
    expect(h.notifications.calls).toEqual([]);
    expect(h.exports.calls).toEqual([]);
    expect(h.owner.asked).toEqual([]);
  });

  it('spends each purpose’s own budget, keyed by the account', async () => {
    const h = services();
    await h.savedService.bookmark(ACTOR, ARTICLE);
    await h.historyService.recordRead(ACTOR, ARTICLE);
    await h.notificationService.markAllRead(ACTOR);
    await h.accountService.export(ACTOR);
    expect(h.budget.consumed).toEqual([
      { key: `personal-write|${ACTOR.accountId}`, rule: WRITE_RULE },
      { key: `personal-history|${ACTOR.accountId}`, rule: HISTORY_RULE },
      {
        key: `personal-notification-bulk|${ACTOR.accountId}`,
        rule: NOTIFICATION_BULK_RULE,
      },
      { key: `personal-export|${ACTOR.accountId}`, rule: EXPORT_RULE },
    ]);
  });
});

describe('malformed input never reaches a port', () => {
  it.each([
    ['an id that is not a UUID', { kind: 'article', id: 'article-1' }],
    ['an unknown kind', { kind: 'course', id: ID(1) }],
    ['a smuggled field', { kind: 'article', id: ID(1), targetType: 'article' }],
    ['an Ayah outside the Quran', { kind: 'ayah', surah: 115, ayah: 1 }],
    ['an Ayah zero', { kind: 'ayah', surah: 1, ayah: 0 }],
    ['a fractional Ayah', { kind: 'ayah', surah: 1, ayah: 1.5 }],
    ['nothing', null],
  ])('refuses %s as a target', async (_label, target) => {
    const h = services();
    expect(await reasonOf(h.savedService.bookmark(ACTOR, target))).toBe('invalid');
    expect(await reasonOf(h.savedService.unbookmark(ACTOR, target))).toBe('invalid');
    expect(await reasonOf(h.settingsService.targetState(ACTOR, target))).toBe('invalid');
    expect(h.saved.calls).toEqual([]);
    expect(h.budget.consumed).toEqual([]);
  });

  it('refuses notes, labels and orders the schemas forbid', async () => {
    const h = services();
    for (const body of [
      '',
      '   ',
      'a'.repeat(PERSONAL_LIMITS.noteMax + 1),
      'bell\u0007',
      '\ud800',
    ])
      expect(
        await reasonOf(
          h.savedService.writeNote(ACTOR, { target: ARTICLE, body, expectedVersion: 0 }),
        ),
        JSON.stringify(body),
      ).toBe('invalid');
    for (const title of [
      '',
      'a'.repeat(PERSONAL_LIMITS.collectionTitle + 1),
      'line\nbreak',
    ])
      expect(
        await reasonOf(
          h.savedService.createCollection(ACTOR, { title, description: null }),
        ),
      ).toBe('invalid');
    expect(
      await reasonOf(
        h.savedService.reorderCollection(ACTOR, {
          collectionId: ID(2),
          savedItemIds: [ID(3), ID(3)],
          expectedVersion: 1,
        }),
      ),
    ).toBe('invalid');
    expect(
      await reasonOf(
        h.savedService.removeNote(ACTOR, { target: ARTICLE, expectedVersion: 0 }),
      ),
    ).toBe('invalid');
    // A video is watched, never read.
    expect(
      await reasonOf(h.historyService.recordRead(ACTOR, { kind: 'video', id: ID(1) })),
    ).toBe('invalid');
    expect(await reasonOf(h.historyService.recordWatch(ACTOR, 'video-1'))).toBe(
      'invalid',
    );
    expect(h.saved.calls).toEqual([]);
    expect(h.history.calls).toEqual([]);
  });

  it('trims a note but keeps its line breaks', async () => {
    const h = services();
    await h.savedService.writeNote(ACTOR, {
      target: ARTICLE,
      body: '  first line\nsecond\tline  ',
      expectedVersion: 0,
    });
    expect(h.saved.calls[0]?.args[1]).toMatchObject({ body: 'first line\nsecond\tline' });
  });

  it('answers a malformed collection id as missing, without a query', async () => {
    const h = services();
    expect(await h.savedService.collection(ACTOR, 'not-a-uuid')).toBeNull();
    expect(h.saved.calls).toEqual([]);
  });
});

/* ===========================================================================
 * Public now — the owner's answer, and an oracle that stays closed
 * ========================================================================= */

describe('saving asks the owner whether the target is public now', () => {
  const draft: PersonalTarget = { kind: 'article', id: ID(2) };
  const missing: PersonalTarget = { kind: 'article', id: ID(3) };

  it('refuses a non-public target exactly like a missing one, and writes nothing', async () => {
    const h = services({ publicIds: [ID(1)] });
    const attempts = (target: PersonalTarget) => [
      h.savedService.bookmark(ACTOR, target),
      h.savedService.writeNote(ACTOR, {
        target,
        body: 'NON_PERSONAL_FIXTURE',
        expectedVersion: 0,
      }),
      h.savedService.addToCollection(ACTOR, {
        collectionId: ID(9),
        target,
        expectedVersion: 1,
      }),
    ];
    const onDraft = await Promise.all(attempts(draft).map(refusal));
    const onMissing = await Promise.all(attempts(missing).map(refusal));
    for (const [index, error] of onDraft.entries()) {
      expect(error).toBeInstanceOf(PersonalRefusal);
      expect(personalFailure(error)).toBe('not-found');
      const other = onMissing[index] as Error;
      expect((error as Error).message).toBe(other.message);
      expect((error as Error).name).toBe(other.name);
      expect(Object.keys(error as object)).toEqual(Object.keys(other));
    }
    expect(
      await reasonOf(
        h.historyService.setQuranProgress(ACTOR, {
          surah: 1,
          ayah: 8,
          expectedVersion: 0,
        }),
      ),
    ).toBe('not-found');
    expect(h.saved.calls).toEqual([]);
    expect(h.history.calls).toEqual([]);
  });

  it('records no history for a target that is not public, and says nothing about it', async () => {
    const h = services({ publicIds: [ID(1)] });
    expect(await h.historyService.recordRead(ACTOR, draft)).toBeUndefined();
    expect(await h.historyService.recordRead(ACTOR, missing)).toBeUndefined();
    expect(await h.historyService.recordWatch(ACTOR, ID(2))).toBeUndefined();
    expect(h.history.calls).toEqual([]);
    await h.historyService.recordRead(ACTOR, ARTICLE);
    expect(h.history.calls).toEqual([
      { method: 'recordRead', args: [ACTOR.accountId, ARTICLE, CLOCK] },
    ]);
  });

  it('lets an existing note be edited after its target was withdrawn', async () => {
    const h = services({ publicIds: [] });
    await h.savedService.writeNote(ACTOR, {
      target: draft,
      body: 'NON_PERSONAL_FIXTURE',
      expectedVersion: 3,
    });
    expect(h.owner.asked).toEqual([]);
    expect(h.saved.calls.map((call) => call.method)).toEqual(['writeNote']);
  });

  it('never asks the owner to remove what is already held', async () => {
    const h = services({ publicIds: [] });
    await h.savedService.unbookmark(ACTOR, draft);
    await h.savedService.removeNote(ACTOR, { target: draft, expectedVersion: 1 });
    await h.savedService.removeFromCollection(ACTOR, {
      collectionId: ID(9),
      target: draft,
      expectedVersion: 1,
    });
    await h.historyService.removeRead(ACTOR, draft);
    await h.historyService.removeWatch(ACTOR, ID(2));
    await h.historyService.clearQuranProgress(ACTOR, { expectedVersion: 1 });
    expect(h.owner.asked).toEqual([]);
    expect(h.saved.calls.map((call) => call.method)).toEqual([
      'unbookmark',
      'removeNote',
      'removeFromCollection',
    ]);
    expect(h.history.calls.map((call) => call.method)).toEqual([
      'removeRead',
      'removeWatch',
      'clearQuranProgress',
    ]);
  });

  it('records with the SERVER’s instant, never one the request supplies', async () => {
    const h = services();
    expect(
      await reasonOf(
        h.historyService.recordRead(ACTOR, { ...ARTICLE, at: '1999-01-01T00:00:00Z' }),
      ),
    ).toBe('invalid');
    await h.historyService.setQuranProgress(ACTOR, {
      surah: 1,
      ayah: 2,
      expectedVersion: 0,
    });
    expect(h.history.calls[0]?.args[2]).toBe(CLOCK);
  });
});

describe('a public page’s private island learns only its own target', () => {
  it('reports the Quran position only on the Ayah it names', async () => {
    const h = services();
    const here = await h.settingsService.targetState(ACTOR, {
      kind: 'ayah',
      surah: 1,
      ayah: 2,
    });
    const there = await h.settingsService.targetState(ACTOR, {
      kind: 'ayah',
      surah: 1,
      ayah: 3,
    });
    expect(here).toMatchObject({
      quranPosition: true,
      quranProgressVersion: 3,
      historyEnabled: true,
    });
    expect(there).toMatchObject({ quranPosition: false, quranProgressVersion: 3 });
  });
});

/* ===========================================================================
 * Notifications
 * ========================================================================= */

describe('notifications and their preferences', () => {
  it('fills every category and channel with the stored choice or the default', () => {
    expect(withDefaults([])).toEqual([
      { category: 'questions', channel: 'in-app', enabled: true },
    ]);
    expect(
      withDefaults([{ category: 'questions', channel: 'in-app', enabled: false }]),
    ).toEqual([{ category: 'questions', channel: 'in-app', enabled: false }]);
    expect(
      withDefaults([
        { category: 'security' as never, channel: 'email' as never, enabled: false },
      ]),
    ).toEqual([{ category: 'questions', channel: 'in-app', enabled: true }]);
    expect(withDefaults([]).map((row) => row.category)).toEqual([
      ...NOTIFICATION_CATEGORIES,
    ]);
  });

  it('produces only a valid kind, key and site path, for a named account', async () => {
    const valid = {
      accountId: 'proof-account-1',
      kind: 'question-answered',
      destination: `/my/questions/${ID(4)}`,
      idempotencyKey: `fatwa:question-answered:${ID(4)}`,
    };
    for (const bad of [
      { ...valid, kind: 'message-received' },
      { ...valid, destination: 'https://evil.example/my' },
      { ...valid, destination: '//evil.example' },
      { ...valid, idempotencyKey: 'two words' },
      { ...valid, idempotencyKey: '' },
      { ...valid, accountId: '' },
      { ...valid, body: 'NON_PERSONAL_FIXTURE prose' },
    ]) {
      const h = services();
      expect(
        await reasonOf(h.notificationService.produce(bad)),
        JSON.stringify(bad),
      ).toBe('invalid');
      expect(h.notifications.calls).toEqual([]);
    }
    const h = services();
    expect(await h.notificationService.produce({ ...valid, destination: null })).toBe(
      'created',
    );
    expect(h.notifications.calls).toEqual([
      { method: 'produce', args: [{ ...valid, destination: null }, ID(900), CLOCK] },
    ]);
  });

  it('returns preferences with defaults filled in', async () => {
    const h = services();
    expect(await h.notificationService.preferences(ACTOR)).toEqual([
      { category: 'questions', channel: 'in-app', enabled: true },
    ]);
  });
});

/* ===========================================================================
 * Export and disposition
 * ========================================================================= */

const COLLECTED: Omit<PersonalExport, 'schema' | 'version' | 'generatedAt'> = {
  settings: { onboarding: null, interests: [], goals: [], historyEnabled: false },
  bookmarks: [{ target: ARTICLE, createdAt: CLOCK.toISOString() }],
  notes: [],
  collections: [],
  readingHistory: [],
  watchHistory: [],
  quranProgress: null,
  notificationPreferences: [],
  notifications: [],
};

function accountHarness(options: {
  readonly closed?: readonly string[];
  readonly batches?: readonly number[];
  readonly owners?: readonly (readonly string[])[];
}) {
  const exports = fake<PersonalExportPort>({ collect: () => COLLECTED });
  const batches = [...(options.batches ?? [0])];
  const pages = [...(options.owners ?? [[]])];
  const disposition = fake<PersonalDispositionPort>({
    disposeAccount: () => batches.shift() ?? 500,
    accountsWithData: () => pages.shift() ?? [],
  });
  const purge = fake<PersonalPurgePort>({
    releaseArticle: () => 0,
    releaseAyah: () => 0,
  });
  const service = createAccountService({
    exports: exports.port,
    disposition: disposition.port,
    purge: purge.port,
    accounts: {
      closedAccounts: async (ids) =>
        ids.filter((id) => (options.closed ?? []).includes(id)),
    },
    limiter: limiter().port,
    key,
    clock: () => CLOCK,
  });
  return { service, disposition, purge };
}

describe('the person’s own export', () => {
  it('is one fixed document: schema, version, instant and defaults — and no newsletter', async () => {
    const { service } = accountHarness({});
    const exported = await service.export(ACTOR);
    expect(Object.keys(exported).sort()).toEqual(
      [
        'schema',
        'version',
        'generatedAt',
        'settings',
        'bookmarks',
        'notes',
        'collections',
        'readingHistory',
        'watchHistory',
        'quranProgress',
        'notificationPreferences',
        'notifications',
      ].sort(),
    );
    expect(exported).toMatchObject({
      schema: PERSONAL_EXPORT_SCHEMA,
      version: PERSONAL_EXPORT_VERSION,
      generatedAt: CLOCK.toISOString(),
      notificationPreferences: [
        { category: 'questions', channel: 'in-app', enabled: true },
      ],
    });
    expect(JSON.stringify(exported)).not.toMatch(/newsletter|email|password|token/iu);
  });
});

describe('this context’s part of account closure', () => {
  it('refuses a malformed id and an account Identity does not call closed', async () => {
    const h = accountHarness({ closed: [] });
    expect(await reasonOf(h.service.disposeAccount(''))).toBe('invalid');
    expect(await reasonOf(h.service.disposeAccount('proof-account-live'))).toBe('denied');
    expect(h.disposition.calls).toEqual([]);
  });

  it('disposes in batches until nothing is left, and reports an unfinished run honestly', async () => {
    const done = accountHarness({ closed: ['proof-closed'], batches: [500, 7, 0] });
    expect(await done.service.disposeAccount('proof-closed')).toEqual({
      removed: 507,
      complete: true,
    });
    const unfinished = accountHarness({ closed: ['proof-closed'], batches: [] });
    expect(await unfinished.service.disposeAccount('proof-closed')).toMatchObject({
      complete: false,
    });
  });

  it('reconciles only the accounts Identity says are closed', async () => {
    const h = accountHarness({
      closed: ['proof-b'],
      owners: [['proof-a', 'proof-b', 'proof-c']],
      batches: [3, 0],
    });
    expect(await h.service.reconcileClosedAccounts()).toEqual({
      removed: 3,
      complete: true,
    });
    expect(
      h.disposition.calls
        .filter((call) => call.method === 'disposeAccount')
        .map((c) => c.args[0]),
    ).toEqual(['proof-b', 'proof-b']);
  });

  it('participates in a purge only by typed, validated identity', async () => {
    const h = accountHarness({});
    expect(
      personalFailure(await refusal(settle(() => h.service.purge.article('not-a-uuid')))),
    ).toBe('invalid');
    expect(personalFailure(await refusal(settle(() => h.service.purge.ayah(0, 1))))).toBe(
      'invalid',
    );
    expect(
      personalFailure(await refusal(settle(() => h.service.purge.ayah(1, 1.5)))),
    ).toBe('invalid');
    expect(await h.service.purge.article(ID(1))).toBe(0);
    expect(await h.service.purge.ayah(1, 2)).toBe(0);
    expect(h.purge.calls.map((call) => call.args)).toEqual([
      [ID(1), 500],
      [{ kind: 'ayah', surah: 1, ayah: 2 }, 500],
    ]);
    expect(Object.keys(h.service.purge).sort()).toEqual(
      ['article', 'ayah', 'hadith', 'video', 'work'].sort(),
    );
  });
});

/* ===========================================================================
 * The newsletter
 * ========================================================================= */

/** An in-memory newsletter store keyed by HASHES, as the adapter is. */
function newsletterStore() {
  interface Row {
    id: string;
    email: string | null;
    state: string;
    generation: number;
    issue: NewsletterIssue;
  }
  const rows = new Map<string, Row>();
  const calls: Call[] = [];
  const port: NewsletterPort = {
    async submit(input) {
      calls.push({ method: 'submit', args: [input] });
      const existing = rows.get(input.emailDigest);
      if (existing && (existing.state === 'confirmed' || existing.state === 'suppressed'))
        return { outcome: 'unchanged' };
      const id = existing?.id ?? input.subscriberId;
      const generation = (existing?.generation ?? 0) + 1;
      rows.set(input.emailDigest, {
        id,
        email: input.email,
        state: 'pending',
        generation,
        issue: input.issue(id, generation),
      });
      return { outcome: 'issued', subscriberId: id, generation };
    },
    async deliverySource(subscriberId, generation) {
      const row = [...rows.values()].find(
        (entry) =>
          entry.id === subscriberId &&
          entry.generation === generation &&
          entry.state === 'pending',
      );
      return row === undefined
        ? null
        : {
            subscriberId: row.id,
            email: row.email!,
            locale: 'en',
            confirmSalt: row.issue.confirmSalt,
            unsubscribeSalt: row.issue.unsubscribeSalt,
            tokenKeyVersion: row.issue.tokenKeyVersion,
            expiresAt: row.issue.expiresAt,
          };
    },
    async linkIsCurrent(purpose, hash) {
      return [...rows.values()].some((row) =>
        purpose === 'confirm'
          ? row.state === 'pending' && row.issue.confirmHash === hash
          : row.issue.unsubscribeHash === hash,
      );
    },
    async confirmationAddress(hash) {
      return (
        [...rows.values()].find(
          (row) => row.state === 'pending' && row.issue.confirmHash === hash,
        )?.email ?? null
      );
    },
    async confirm(hash) {
      calls.push({ method: 'confirm', args: [hash] });
      const row = [...rows.values()].find(
        (entry) => entry.state === 'pending' && entry.issue.confirmHash === hash,
      );
      if (row === undefined) return false;
      row.state = 'confirmed';
      return true;
    },
    async unsubscribe(hash) {
      calls.push({ method: 'unsubscribe', args: [hash] });
      const row = [...rows.values()].find(
        (entry) => entry.issue.unsubscribeHash === hash,
      );
      if (row === undefined) return false;
      row.state = 'unsubscribed';
      return true;
    },
    async expireLapsed() {
      return 0;
    },
    async counts() {
      calls.push({ method: 'counts', args: [] });
      return { pending: 0, confirmed: 0, unsubscribed: 0, expired: 0, suppressed: 0 };
    },
    async list(state, offset) {
      calls.push({ method: 'list', args: [state, offset] });
      return { items: [], total: 0, offset: 0 };
    },
    async suppress(...args) {
      calls.push({ method: 'suppress', args });
    },
    async reinstate(...args) {
      calls.push({ method: 'reinstate', args });
    },
  };
  return { port, rows, calls };
}

function newsletterHarness(
  options: {
    readonly suppressed?: readonly string[];
    readonly permissions?: readonly string[];
    readonly allowed?: boolean;
    readonly tokenVersion?: number;
  } = {},
) {
  const store = newsletterStore();
  const enqueued: {
    recipient: string;
    sourceReference: string;
    idempotencyKey: string;
  }[] = [];
  const budget = limiter(options.allowed ?? true);
  let next = 100;
  const service = createNewsletterService({
    newsletter: store.port,
    limiter: budget.port,
    key,
    digest: (email) => ({ digest: `digest:${email}`, keyVersion: 1 }),
    tokenKey: {
      key: 'non-personal-fixture-token-key',
      version: options.tokenVersion ?? 1,
    },
    suppressed: async (email) => (options.suppressed ?? []).includes(email),
    enqueue: async (delivery) => {
      enqueued.push(delivery);
    },
    baseUrl: 'https://minhaj.invalid',
    authority: {
      permits: async (_actor, permission) =>
        (options.permissions ?? []).includes(permission),
    },
    ids: () => ID((next += 1)),
    clock: () => CLOCK,
  });
  return { service, store, enqueued, budget };
}

const asRecord = (delivery: {
  sourceReference: string;
  idempotencyKey: string;
}): DeliveryRecord => ({
  id: ID(700),
  purpose: 'newsletter.confirmation',
  sourceReference: delivery.sourceReference,
  idempotencyKey: delivery.idempotencyKey,
  status: 'pending',
  attemptCount: 0,
});

async function tokensOf(h: ReturnType<typeof newsletterHarness>) {
  const delivery = h.enqueued.at(-1)!;
  const resolution = await h.service.resolveDelivery(asRecord(delivery));
  if (resolution.outcome !== 'send') throw new Error('nothing owed');
  const text = resolution.message.text;
  return {
    confirm: /confirm\?token=([^\s]+)/u.exec(text)![1]!,
    unsubscribe: /unsubscribe\?token=([^\s]+)/u.exec(text)![1]!,
    message: resolution.message,
  };
}

describe('newsletter submission', () => {
  it('canonicalises the address exactly as Identity does, and nothing more', () => {
    expect(
      newsletterSubmissionSchema.parse({
        email: '  Person.Name+tag@Example.ORG ',
        locale: 'ur',
      }),
    ).toEqual({ email: 'person.name+tag@example.org', locale: 'ur' });
    for (const bad of [
      { email: 'not-an-address', locale: 'en' },
      { email: 'person@example.org', locale: 'fr' },
      { email: 'person@example.org', locale: 'en', accountId: 'proof-account-1' },
    ])
      expect(newsletterSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('issues one pending subscription and owes exactly one confirmation', async () => {
    const h = newsletterHarness();
    expect(
      await h.service.submit({ email: 'Person@Example.org', locale: 'en' }, 'client'),
    ).toBe(undefined);
    expect(h.enqueued).toEqual([
      {
        recipient: 'person@example.org',
        sourceReference: `newsletter:${ID(101)}:1`,
        idempotencyKey: `newsletter.confirmation:${ID(101)}:1`,
      },
    ]);
    expect(h.budget.consumed).toEqual([
      { key: 'newsletter-client|client', rule: NEWSLETTER_CLIENT_RULE },
      {
        key: 'newsletter-address|digest:person@example.org',
        rule: NEWSLETTER_ADDRESS_RULE,
      },
    ]);
  });

  it('answers a confirmed, suppressed or provider-blocked address exactly as a new one', async () => {
    const blocked = newsletterHarness({ suppressed: ['blocked@example.org'] });
    expect(
      await blocked.service.submit({ email: 'blocked@example.org', locale: 'en' }, 'c'),
    ).toBe(undefined);
    expect(blocked.store.calls).toEqual([]);
    expect(blocked.enqueued).toEqual([]);

    const h = newsletterHarness();
    await h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c');
    expect(await h.service.confirm((await tokensOf(h)).confirm, 'c')).toBe('confirmed');
    expect(
      await h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c'),
    ).toBe(undefined);
    expect(h.enqueued).toHaveLength(1);
  });

  it('refuses malformed input and a spent budget before the store', async () => {
    const h = newsletterHarness({ allowed: false });
    expect(await reasonOf(h.service.submit({ email: 'x', locale: 'en' }, 'c'))).toBe(
      'invalid',
    );
    expect(
      await reasonOf(
        h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c'),
      ),
    ).toBe('rate-limited');
    expect(await reasonOf(h.service.confirm('a'.repeat(43), 'c'))).toBe('rate-limited');
    expect(await reasonOf(h.service.unsubscribe('a'.repeat(43), 'c'))).toBe(
      'rate-limited',
    );
    expect(h.store.calls).toEqual([]);
  });
});

describe('newsletter link tokens', () => {
  it('stores only hashes and salts, and derives 256-bit base64url tokens at send time', async () => {
    const h = newsletterHarness();
    await h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c');
    const issue = [...h.store.rows.values()][0]!.issue;
    expect(issue.confirmHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(issue.unsubscribeHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(issue.confirmSalt).toMatch(/^[\w-]{43}$/u);
    expect(issue.unsubscribeSalt).not.toBe(issue.confirmSalt);
    expect(issue.tokenKeyVersion).toBe(1);
    expect(issue.expiresAt.getTime() - CLOCK.getTime()).toBe(
      NEWSLETTER_CONFIRMATION_HOURS * 3_600_000,
    );

    const tokens = await tokensOf(h);
    expect(tokens.confirm).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(tokens.unsubscribe).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(tokens.confirm).not.toBe(tokens.unsubscribe);
    expect(sha256(tokens.confirm)).toBe(issue.confirmHash);
    expect(sha256(tokens.unsubscribe)).toBe(issue.unsubscribeHash);
    expect(JSON.stringify(h.store.calls)).not.toContain(tokens.confirm);
    expect(JSON.stringify(h.store.calls)).not.toContain(tokens.unsubscribe);

    // A retried delivery carries the same links.
    expect((await tokensOf(h)).confirm).toBe(tokens.confirm);
  });

  it('binds each token to its purpose', async () => {
    const h = newsletterHarness();
    await h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c');
    const tokens = await tokensOf(h);
    const reader = createNewsletterLinkReader(h.store.port);
    expect(await reader.linkStatus('confirm', tokens.unsubscribe)).toBe('invalid');
    expect(await reader.linkStatus('unsubscribe', tokens.confirm)).toBe('invalid');
    expect(await h.service.confirm(tokens.unsubscribe, 'c')).toBe('invalid');
    expect(await h.service.unsubscribe(tokens.confirm, 'c')).toBe('invalid');
    expect(await reader.linkStatus('confirm', tokens.confirm)).toBe('valid');
    expect(await h.service.confirm(tokens.confirm, 'c')).toBe('confirmed');
    expect(await h.service.unsubscribe(tokens.unsubscribe, 'c')).toBe('unsubscribed');
  });

  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['standard base64', `${'a'.repeat(41)}+/`],
    ['padded', `${'a'.repeat(42)}=`],
    ['not a string', 42],
    ['absent', undefined],
  ])('answers a %s token invalid without asking the store', async (_label, token) => {
    const h = newsletterHarness();
    expect(await h.service.confirm(token, 'c')).toBe('invalid');
    expect(await h.service.unsubscribe(token, 'c')).toBe('invalid');
    expect(
      await createNewsletterLinkReader(h.store.port).linkStatus('confirm', token),
    ).toBe('invalid');
    expect(h.store.calls).toEqual([]);
    expect(h.budget.consumed.every((entry) => entry.rule === NEWSLETTER_LINK_RULE)).toBe(
      true,
    );
  });

  it('refuses to confirm an address the provider has since suppressed', async () => {
    const h = newsletterHarness({ suppressed: [] });
    await h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c');
    const tokens = await tokensOf(h);
    const later = newsletterHarness({ suppressed: ['person@example.org'] });
    later.store.rows.set('x', [...h.store.rows.values()][0]!);
    expect(await later.service.confirm(tokens.confirm, 'c')).toBe('invalid');
    expect(later.store.calls.filter((call) => call.method === 'confirm')).toEqual([]);
  });

  it('owes nothing for a rotated key, a stale generation or a foreign reference', async () => {
    const h = newsletterHarness();
    await h.service.submit({ email: 'person@example.org', locale: 'en' }, 'c');
    const delivery = h.enqueued[0]!;
    const rotated = newsletterHarness({ tokenVersion: 2 });
    rotated.store.rows.set('x', [...h.store.rows.values()][0]!);
    expect(await rotated.service.resolveDelivery(asRecord(delivery))).toEqual({
      outcome: 'nothing-owed',
    });
    for (const sourceReference of [
      `newsletter:${ID(101)}:2`,
      `newsletter:${ID(101)}:0`,
      `newsletter:${ID(101)}`,
      `identity:${ID(101)}:1`,
      `newsletter:${ID(101)}:1:extra`,
    ])
      expect(
        await h.service.resolveDelivery(asRecord({ ...delivery, sourceReference })),
        sourceReference,
      ).toEqual({ outcome: 'nothing-owed' });
  });
});

describe('the confirmation message', () => {
  it('is authored in every interface locale', () => {
    expect([...NEWSLETTER_MAIL_LOCALES]).toEqual(['en', 'ur', 'ar']);
  });

  it.each([
    ['en', 'ltr'],
    ['ur', 'rtl'],
    ['ar', 'rtl'],
  ] as const)('renders %s %s with both links, escaped', (locale, dir) => {
    const message = renderNewsletterConfirmation({
      locale,
      recipient: 'person@example.org',
      confirmUrl:
        'https://minhaj.invalid/x/newsletter/confirm?token=abc&a="><script>alert(1)</script>',
      unsubscribeUrl: 'https://minhaj.invalid/x/newsletter/unsubscribe?token=def',
    });
    expect(message.recipient).toBe('person@example.org');
    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.html).toContain(`lang="${locale}" dir="${dir}"`);
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('token=abc&amp;a=&quot;&gt;');
    expect(message.html).toContain(
      'https://minhaj.invalid/x/newsletter/unsubscribe?token=def',
    );
    expect(message.text).toContain('newsletter/confirm?token=abc');
    expect(message.text).toContain('newsletter/unsubscribe?token=def');
  });
});

describe('newsletter administration', () => {
  it('requires newsletter.read to read and newsletter.operate to change, before any input is read', async () => {
    const nobody = newsletterHarness({ permissions: [] });
    expect(await reasonOf(nobody.service.counts(ACTOR))).toBe('denied');
    expect(await reasonOf(nobody.service.list(ACTOR, null, 0))).toBe('denied');
    expect(await reasonOf(nobody.service.suppress(ACTOR, { junk: true }))).toBe('denied');
    expect(await reasonOf(nobody.service.reinstate(ACTOR, { junk: true }))).toBe(
      'denied',
    );

    const reader = newsletterHarness({ permissions: ['newsletter.read'] });
    expect(
      await reasonOf(
        reader.service.suppress(ACTOR, { subscriberId: ID(1), expectedVersion: 1 }),
      ),
    ).toBe('denied');
    expect(nobody.store.calls).toEqual([]);
    expect(reader.store.calls).toEqual([]);

    const operator = newsletterHarness({
      permissions: ['newsletter.read', 'newsletter.operate'],
    });
    expect(
      await reasonOf(
        operator.service.suppress(ACTOR, { subscriberId: 'x', expectedVersion: 1 }),
      ),
    ).toBe('invalid');
    await operator.service.suppress(ACTOR, { subscriberId: ID(1), expectedVersion: 1 });
    expect(operator.store.calls).toEqual([
      {
        method: 'suppress',
        args: [ACTOR.accountId, { subscriberId: ID(1), expectedVersion: 1 }, CLOCK],
      },
    ]);
  });

  it('filters a list only by a known state', async () => {
    const h = newsletterHarness({ permissions: ['newsletter.read'] });
    await h.service.list(ACTOR, 'confirmed', 20);
    await h.service.list(ACTOR, "pending' OR 1=1 --", -5);
    expect(h.store.calls).toEqual([
      { method: 'list', args: ['confirmed', 20] },
      { method: 'list', args: [null, 0] },
    ]);
  });

  it('masks an address to its first character and domain', () => {
    expect(maskEmail('person@example.org')).toBe('p•••@example.org');
    expect(maskEmail('@example.org')).toBe('•••');
    expect(maskEmail('no-at-sign')).toBe('•••');
  });
});

/* ===========================================================================
 * Vocabulary
 * ========================================================================= */

describe('a notification destination is a plain path on this site', () => {
  it.each([
    '/my/questions/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    '/my/notifications',
    '/en/library/articles/some-slug',
    '/a',
    '/my/file.name~x_y-z',
  ])('accepts %s', (value) => {
    expect(isInternalDestination(value)).toBe(true);
  });

  it.each([
    '',
    '/',
    'my/questions',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'data:text/html,x',
    '/my/../admin',
    '/my/./x',
    '/my//questions',
    '/my/.hidden',
    '/.well-known',
    '/..',
    '/%2e%2e/admin',
    '/%2F%2Fevil.example',
    '/my?next=x',
    '/my#x',
    '/user:pass@evil',
    '/my questions',
    '/my\nquestions',
    `/${'a'.repeat(300)}`,
  ])('refuses %j', (value) => {
    expect(isInternalDestination(value)).toBe(false);
  });
});

describe('a target key is one stable string per target', () => {
  it('distinguishes kinds and Ayah positions', () => {
    expect(targetKey({ kind: 'ayah', surah: 2, ayah: 255 })).toBe('ayah:2:255');
    expect(targetKey({ kind: 'article', id: ID(1) })).toBe(`article:${ID(1)}`);
    const keys = (['article', 'work', 'video', 'hadith'] as const).map((kind) =>
      targetKey({ kind, id: ID(1) }),
    );
    expect(new Set(keys).size).toBe(4);
    expect(targetKey({ kind: 'ayah', surah: 1, ayah: 12 })).not.toBe(
      targetKey({ kind: 'ayah', surah: 11, ayah: 2 }),
    );
  });
});
