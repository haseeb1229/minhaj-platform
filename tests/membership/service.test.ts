import { describe, expect, it } from 'vitest';

import { PERMISSION_CATALOGUE } from '../../packages/contracts/src/identity/index.ts';
import {
  MEMBERSHIP_COMMUNICATION_PURPOSES,
  MEMBERSHIP_EXPORT_SCHEMA,
  MEMBERSHIP_EXPORT_VERSION,
  type MembershipAccountsPort,
  type MembershipApplicantPort,
  type MembershipAuthorityPort,
  type MembershipCataloguePort,
  type MembershipCommunicationIntentRecord,
  type MembershipCommunicationPort,
  type MembershipDispositionPort,
  type MembershipExportPort,
  type MembershipRecipientPort,
  type MembershipStaffPort,
  type MembershipTypeReference,
} from '../../packages/contracts/src/membership/index.ts';
import type {
  DeliveryRecord,
  RateLimiterPort,
} from '../../packages/contracts/src/platform/index.ts';
import {
  MEMBERSHIP_RATE_RULES,
  MembershipRefusal,
  createMembershipAccountService,
  createMembershipAdminService,
  createMembershipApplicantService,
  createMembershipCommunicationService,
  createMembershipPublicService,
  isMembershipDeliveryPurpose,
  membershipFailure,
} from '../../apps/web/src/contexts/membership/index.ts';

/**
 * Phase 26 — the Membership services' rules, over recording fakes.
 *
 * WHAT IS PROVED HERE, CHEAPLY: every administrative method asks Identity,
 * live, for exactly its own Membership key BEFORE anything is parsed, and no
 * other context's key — nor `membership.read` for a change — confers it; a
 * review or an approval is refused for a closed applicant while a rejection is
 * not; the applicant's acts run as the session account alone, spending their
 * own purpose-scoped budgets; the export is stamped deterministically; the
 * closure disposition refuses a living account and stops after bounded
 * rounds; and the relay claims, re-checks, resolves, enqueues under the
 * intent's own key and only then marks the intent relayed. The database's own
 * re-checks are proved in the persistence integration suite.
 *
 * Every identifier and string is a synthetic sentinel.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: 'proof-operator-1' };
const person = { accountId: 'proof-applicant-1' };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return membershipFailure(error);
  }
  return 'accepted';
}

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** A port whose every method is recorded and answered by `answer`. */
function recording<T extends object>(
  calls: Call[],
  answer: (method: string, args: readonly unknown[]) => unknown,
  throws: Partial<Record<string, unknown>> = {},
): T {
  return new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args });
          if (method in throws) throw throws[method];
          return answer(method, args);
        },
    },
  ) as T;
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

const LABEL = {
  locale: 'en',
  title: 'NON_MEMBERSHIP_FIXTURE_TITLE',
  summary: 'NON_MEMBERSHIP_FIXTURE_SUMMARY',
  description: 'NON_MEMBERSHIP_FIXTURE_DESCRIPTION',
  guidance: '',
};

/** One valid input for every administrative change. */
const CHANGES = {
  createType: { primaryLocale: 'en', displayOrder: 1, label: LABEL },
  reorderType: { id: ID(1), expectedVersion: 1, displayOrder: 2 },
  saveLabel: { id: ID(1), expectedVersion: 1, label: { ...LABEL, locale: 'ur' } },
  transitionType: { id: ID(1), expectedVersion: 1, to: 'published' },
  startReview: { id: ID(2), expectedVersion: 1 },
  decide: { id: ID(2), expectedVersion: 2, decision: 'approve' },
  closeMembership: { id: ID(3), expectedVersion: 1 },
} as const;

type Change = keyof typeof CHANGES;
const CHANGE_NAMES = Object.keys(CHANGES) as Change[];

const QUERY = { status: 'open', membershipTypeId: null, offset: 0 };
const MEMBER_QUERY = { status: 'active', membershipTypeId: null, offset: 0 };

function adminHarness(
  options: {
    readonly permissions?: readonly string[];
    readonly closed?: readonly string[];
    readonly application?: unknown;
    readonly throws?: Partial<Record<string, unknown>>;
  } = {},
) {
  const calls: Call[] = [];
  const asked: string[] = [];
  const closedAsked: (readonly string[])[] = [];
  const answer = (method: string, args: readonly unknown[]) => {
    if (method === 'application')
      return options.application === undefined
        ? { id: args[1], applicantAccountId: person.accountId }
        : options.application;
    // The decision guard's identifier-only lookup: NOT the audited access.
    if (method === 'applicantOf')
      return options.application === undefined
        ? person.accountId
        : options.application === null
          ? null
          : (options.application as { applicantAccountId: string }).applicantAccountId;
    if (method === 'types') return [];
    if (method === 'type') return null;
    if (method === 'applications' || method === 'memberships')
      return { rows: [], total: 0 };
    return { id: (args[0] as { id?: string }).id ?? null };
  };
  const catalogue = recording<MembershipCataloguePort>(calls, answer, options.throws);
  const staff = recording<MembershipStaffPort>(calls, answer, options.throws);
  const authority: MembershipAuthorityPort = {
    permits: async (_accountId, permission) => {
      asked.push(permission);
      return (options.permissions ?? []).includes(permission);
    },
  };
  const accounts: MembershipAccountsPort = {
    closedAccounts: async (ids) => {
      closedAsked.push(ids);
      return ids.filter((id) => (options.closed ?? []).includes(id));
    },
  };
  let n = 900;
  const service = createMembershipAdminService({
    catalogue,
    staff,
    authority,
    accounts,
    ids: () => ID((n += 1)),
  });
  return { service, calls, asked, closedAsked };
}

/** Every administrative read, with a valid argument. */
const reads = (service: ReturnType<typeof adminHarness>['service']) => ({
  types: () => service.types(actor),
  type: () => service.type(actor, ID(1)),
  applications: () => service.applications(actor, QUERY),
  application: () => service.application(actor, ID(2)),
  memberships: () => service.memberships(actor, MEMBER_QUERY),
});

const change = (
  service: ReturnType<typeof adminHarness>['service'],
  name: Change,
  input: unknown = CHANGES[name],
) => service[name](actor, input);

/** Every catalogue key but Membership's own — the whole administrator bundle included. */
const OTHER_KEYS = PERMISSION_CATALOGUE.map((entry) => entry.key).filter(
  (key) => !key.startsWith('membership.'),
);

describe('Membership administration asks for exactly its own key, first', () => {
  it('refuses every read to a holder of every other key, asking only membership.read', async () => {
    expect(OTHER_KEYS.some((key) => key.startsWith('people.'))).toBe(true);
    expect(OTHER_KEYS.some((key) => key.startsWith('global.'))).toBe(true);
    expect(OTHER_KEYS.some((key) => key.startsWith('content.'))).toBe(true);
    const { service, calls, asked } = adminHarness({
      permissions: [...OTHER_KEYS, 'membership.administer'],
    });
    for (const [name, read] of Object.entries(reads(service)))
      expect(await failure(read()), name).toBe('denied');
    expect(calls).toEqual([]);
    expect(new Set(asked)).toEqual(new Set(['membership.read']));
  });

  it('refuses every change to a holder of every other key and of membership.read', async () => {
    const { service, calls, asked } = adminHarness({
      permissions: [...OTHER_KEYS, 'membership.read'],
    });
    for (const name of CHANGE_NAMES)
      expect(await failure(change(service, name)), name).toBe('denied');
    expect(calls).toEqual([]);
    expect(new Set(asked)).toEqual(new Set(['membership.administer']));
  });

  it('denies before parsing, so an unauthorised caller learns nothing of the rules', async () => {
    const refused = adminHarness();
    for (const name of CHANGE_NAMES)
      expect(await failure(change(refused.service, name, { junk: true })), name).toBe(
        'denied',
      );
    expect(await failure(refused.service.applications(actor, { junk: true }))).toBe(
      'denied',
    );
    expect(await failure(refused.service.memberships(actor, 'junk'))).toBe('denied');
    expect(refused.calls).toEqual([]);

    const permitted = adminHarness({
      permissions: ['membership.read', 'membership.administer'],
    });
    for (const name of CHANGE_NAMES)
      expect(await failure(change(permitted.service, name, { junk: true })), name).toBe(
        'invalid',
      );
    expect(await failure(permitted.service.applications(actor, { junk: true }))).toBe(
      'invalid',
    );
    expect(await failure(permitted.service.memberships(actor, 'junk'))).toBe('invalid');
    expect(permitted.calls).toEqual([]);
  });

  it('asks Identity again on every call, and denies an actor without an account outright', async () => {
    const { service, asked } = adminHarness({ permissions: ['membership.read'] });
    await service.types(actor);
    await service.types(actor);
    expect(asked).toEqual(['membership.read', 'membership.read']);
    expect(await failure(service.types({ accountId: '' }))).toBe('denied');
    expect(asked).toHaveLength(2);
  });

  it('answers a malformed id with null after the permission, without reaching persistence', async () => {
    const { service, calls, asked } = adminHarness({ permissions: ['membership.read'] });
    expect(await service.type(actor, 'not-an-id')).toBeNull();
    expect(await service.application(actor, `${ID(2)}' OR 1=1`)).toBeNull();
    expect(calls).toEqual([]);
    expect(asked).toEqual(['membership.read', 'membership.read']);
  });

  it('hands the port the session actor and the parsed value — never the input’s own account', async () => {
    const { service, calls } = adminHarness({ permissions: ['membership.administer'] });
    await service.createType(actor, CHANGES.createType);
    expect(calls).toEqual([
      {
        method: 'createType',
        args: [
          {
            id: ID(901),
            actorId: actor.accountId,
            value: { ...CHANGES.createType, label: { ...LABEL, guidance: null } },
          },
        ],
      },
    ]);
    // Strict schemas: a smuggled actor or extra field is refused, not ignored.
    expect(
      await failure(
        service.reorderType(actor, { ...CHANGES.reorderType, actorId: 'someone-else' }),
      ),
    ).toBe('invalid');
    // A type begins with its primary locale's words.
    expect(
      await failure(
        service.createType(actor, { ...CHANGES.createType, primaryLocale: 'ar' }),
      ),
    ).toBe('invalid');
    expect(calls).toHaveLength(1);
  });

  it('reads the queue with the parsed query under the reading actor', async () => {
    const { service, calls } = adminHarness({ permissions: ['membership.read'] });
    await service.applications(actor, QUERY);
    await service.memberships(actor, MEMBER_QUERY);
    expect(calls).toEqual([
      { method: 'applications', args: [actor.accountId, QUERY] },
      { method: 'memberships', args: [actor.accountId, MEMBER_QUERY] },
    ]);
  });
});

describe('Membership decisions are not taken for a closed account', () => {
  const administer = ['membership.administer'];

  it('refuses to start a review for a closed applicant', async () => {
    const { service, calls, closedAsked } = adminHarness({
      permissions: administer,
      closed: [person.accountId],
    });
    expect(await failure(service.startReview(actor, CHANGES.startReview))).toBe(
      'applicant-closed',
    );
    expect(closedAsked).toEqual([[person.accountId]]);
    expect(calls.map((call) => call.method)).toEqual(['applicantOf']);
  });

  it('refuses an approval for a closed applicant, but lets a rejection through', async () => {
    const { service, calls } = adminHarness({
      permissions: administer,
      closed: [person.accountId],
    });
    expect(await failure(service.decide(actor, CHANGES.decide))).toBe('applicant-closed');
    expect(calls.map((call) => call.method)).toEqual(['applicantOf']);

    calls.length = 0;
    await service.decide(actor, { ...CHANGES.decide, decision: 'reject' });
    expect(calls.map((call) => call.method)).toEqual(['decide']);
  });

  it('approves an open applicant with a fresh Membership id, after asking Identity', async () => {
    const { service, calls, closedAsked } = adminHarness({ permissions: administer });
    await service.decide(actor, CHANGES.decide);
    expect(closedAsked).toEqual([[person.accountId]]);
    expect(calls).toEqual([
      { method: 'applicantOf', args: [ID(2)] },
      {
        method: 'decide',
        args: [
          {
            actorId: actor.accountId,
            id: ID(2),
            expectedVersion: 2,
            decision: 'approve',
            membershipId: ID(901),
          },
        ],
      },
    ]);
  });

  it('answers not-found for an application that does not exist', async () => {
    const { service, calls } = adminHarness({
      permissions: administer,
      application: null,
    });
    expect(await failure(service.startReview(actor, CHANGES.startReview))).toBe(
      'not-found',
    );
    expect(await failure(service.decide(actor, CHANGES.decide))).toBe('not-found');
    expect(calls.map((call) => call.method)).toEqual(['applicantOf', 'applicantOf']);
  });

  it('reads an adapter refusal as its reason and leaves an outage an outage', async () => {
    const conflict = adminHarness({
      permissions: administer,
      throws: {
        closeMembership: { reason: 'conflict' },
        transitionType: { reason: 'incomplete' },
      },
    });
    const refused = await conflict.service
      .closeMembership(actor, CHANGES.closeMembership)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MembershipRefusal);
    expect((refused as MembershipRefusal).reason).toBe('conflict');
    expect(
      await failure(conflict.service.transitionType(actor, CHANGES.transitionType)),
    ).toBe('incomplete');

    const outage = new Error('NON_MEMBERSHIP_FIXTURE_OUTAGE');
    const broken = adminHarness({
      permissions: administer,
      throws: { reorderType: outage },
    });
    await expect(broken.service.reorderType(actor, CHANGES.reorderType)).rejects.toBe(
      outage,
    );
    expect(membershipFailure(outage)).toBe('unavailable');
  });
});

/* ===========================================================================
 * The applicant's own acts
 * ========================================================================= */

const NOW = new Date('2026-10-09T12:00:00.000Z');

const EXPORT_ROWS = {
  applications: [
    {
      id: ID(2),
      membershipTypeId: ID(1),
      status: 'approved' as const,
      withdrawalSource: null,
      submittedAt: '2026-10-01T00:00:00.000Z',
      reviewStartedAt: '2026-10-02T00:00:00.000Z',
      decidedAt: '2026-10-03T00:00:00.000Z',
      withdrawnAt: null,
    },
  ],
  memberships: [
    {
      id: ID(3),
      membershipTypeId: ID(1),
      sourceApplicationId: ID(2),
      status: 'active' as const,
      closureSource: null,
      activatedAt: '2026-10-03T00:00:00.000Z',
      closedAt: null,
    },
  ],
};

function applicantHarness(
  options: {
    readonly allowed?: boolean;
    readonly throws?: Partial<Record<string, unknown>>;
  } = {},
) {
  const calls: Call[] = [];
  const consumed: { readonly key: string; readonly rule: unknown }[] = [];
  const applicant = recording<MembershipApplicantPort>(
    calls,
    (method, args) => {
      if (method === 'state')
        return { available: [], applications: [], memberships: [], types: [] };
      if (method === 'submit')
        return { applicationId: (args[0] as { id: string }).id, created: true };
      return { id: (args[0] as { id: string }).id };
    },
    options.throws,
  );
  const exporter: MembershipExportPort = {
    collect: async (accountId) => {
      calls.push({ method: 'collect', args: [accountId] });
      return EXPORT_ROWS;
    },
  };
  const limiter: RateLimiterPort = {
    consume: async (key, rule) => {
      consumed.push({ key, rule });
      return options.allowed === false
        ? { allowed: false, retryAfter: 60 }
        : { allowed: true, retryAfter: null };
    },
    purgeExpired: async () => 0,
  };
  const service = createMembershipApplicantService({
    applicant,
    exporter,
    limiter,
    key: (purpose, subject) => `${purpose}|${subject}`,
    ids: () => ID(700),
    clock: () => NOW,
  });
  return { service, calls, consumed };
}

describe('a person’s own Membership acts', () => {
  it('acts as the session account alone, with a purpose-scoped budget per act', async () => {
    const { service, calls, consumed } = applicantHarness();
    expect(await service.submit(person, { membershipTypeId: ID(1) })).toEqual({
      applicationId: ID(700),
      created: true,
    });
    await service.withdraw(person, { id: ID(2), expectedVersion: 1 });
    await service.closeOwn(person, { id: ID(3), expectedVersion: 1 });
    await service.export(person);
    await service.state(person);
    expect(calls).toEqual([
      {
        method: 'submit',
        args: [{ id: ID(700), accountId: person.accountId, membershipTypeId: ID(1) }],
      },
      {
        method: 'withdraw',
        args: [{ accountId: person.accountId, id: ID(2), expectedVersion: 1 }],
      },
      {
        method: 'closeOwn',
        args: [{ accountId: person.accountId, id: ID(3), expectedVersion: 1 }],
      },
      { method: 'collect', args: [person.accountId] },
      { method: 'state', args: [person.accountId] },
    ]);
    expect(consumed).toEqual([
      { key: 'membership-submit|proof-applicant-1', rule: MEMBERSHIP_RATE_RULES.submit },
      {
        key: 'membership-withdraw|proof-applicant-1',
        rule: MEMBERSHIP_RATE_RULES.withdraw,
      },
      { key: 'membership-close|proof-applicant-1', rule: MEMBERSHIP_RATE_RULES.close },
      { key: 'membership-export|proof-applicant-1', rule: MEMBERSHIP_RATE_RULES.export },
    ]);
  });

  it('fixes each budget', () => {
    expect(MEMBERSHIP_RATE_RULES).toEqual({
      submit: { window: 86_400, max: 10 },
      withdraw: { window: 3_600, max: 20 },
      close: { window: 3_600, max: 10 },
      export: { window: 3_600, max: 10 },
    });
    expect(Object.isFrozen(MEMBERSHIP_RATE_RULES)).toBe(true);
  });

  it('refuses a smuggled account or a malformed record before spending anything', async () => {
    const { service, calls, consumed } = applicantHarness();
    expect(
      await failure(
        service.submit(person, { membershipTypeId: ID(1), accountId: 'someone-else' }),
      ),
    ).toBe('invalid');
    expect(await failure(service.submit(person, { membershipTypeId: 'x' }))).toBe(
      'invalid',
    );
    expect(await failure(service.withdraw(person, { id: ID(2) }))).toBe('invalid');
    expect(await failure(service.closeOwn(person, { id: 'x', expectedVersion: 1 }))).toBe(
      'invalid',
    );
    expect(await failure(service.closeOwn(person, null))).toBe('invalid');
    expect(calls).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it('denies an actor without an account', async () => {
    const { service, calls, consumed } = applicantHarness();
    const nobody = { accountId: '' };
    expect(await failure(service.state(nobody))).toBe('denied');
    expect(await failure(service.submit(nobody, { membershipTypeId: ID(1) }))).toBe(
      'denied',
    );
    expect(await failure(service.export(nobody))).toBe('denied');
    expect(calls).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it('refuses rate-limited without reaching persistence', async () => {
    const { service, calls } = applicantHarness({ allowed: false });
    expect(await failure(service.submit(person, { membershipTypeId: ID(1) }))).toBe(
      'rate-limited',
    );
    expect(
      await failure(service.withdraw(person, { id: ID(2), expectedVersion: 1 })),
    ).toBe('rate-limited');
    expect(
      await failure(service.closeOwn(person, { id: ID(3), expectedVersion: 1 })),
    ).toBe('rate-limited');
    expect(await failure(service.export(person))).toBe('rate-limited');
    expect(calls).toEqual([]);
  });

  it('reads the adapter’s business refusals as their reasons', async () => {
    for (const reason of [
      'type-unavailable',
      'already-member',
      'not-found',
      'conflict',
    ]) {
      const { service } = applicantHarness({ throws: { submit: { reason } } });
      expect(await failure(service.submit(person, { membershipTypeId: ID(1) }))).toBe(
        reason,
      );
    }
  });

  it('stamps the export deterministically: schema, version, instant, then the rows', async () => {
    const { service } = applicantHarness();
    const document = await service.export(person);
    expect(document).toEqual({
      schema: MEMBERSHIP_EXPORT_SCHEMA,
      version: MEMBERSHIP_EXPORT_VERSION,
      generatedAt: '2026-10-09T12:00:00.000Z',
      ...EXPORT_ROWS,
    });
    expect(Object.keys(document)).toEqual([
      'schema',
      'version',
      'generatedAt',
      'applications',
      'memberships',
    ]);
    expect(JSON.stringify(document)).toBe(JSON.stringify(await service.export(person)));
  });
});

describe('the public catalogue', () => {
  it('answers the reader’s published types and nothing else', async () => {
    const types = [
      { id: ID(1), primaryLocale: 'en', displayOrder: 0, labels: [] },
    ] as const;
    const service = createMembershipPublicService({
      catalogue: { publishedTypes: async () => types },
    });
    expect(await service.publishedTypes()).toBe(types);
    expect(Object.keys(service)).toEqual(['publishedTypes']);
  });
});

/* ===========================================================================
 * Account closure
 * ========================================================================= */

function accountHarness(options: {
  readonly closed: readonly string[];
  readonly batches?: readonly number[];
  readonly pages?: readonly (readonly string[])[];
}) {
  const disposed: { readonly accountId: string; readonly limit: number }[] = [];
  const paged: { readonly after: string | null; readonly limit: number }[] = [];
  let batch = 0;
  let page = 0;
  const disposition: MembershipDispositionPort = {
    disposeAccount: async (accountId, limit) => {
      disposed.push({ accountId, limit });
      const batches = options.batches ?? [0];
      return batches[Math.min(batch++, batches.length - 1)] ?? 0;
    },
    accountsWithData: async (after, limit) => {
      paged.push({ after, limit });
      const pages = options.pages ?? [];
      return pages[Math.min(page++, pages.length - 1)] ?? [];
    },
  };
  const accounts: MembershipAccountsPort = {
    closedAccounts: async (ids) => ids.filter((id) => options.closed.includes(id)),
  };
  return {
    service: createMembershipAccountService({ disposition, accounts }),
    disposed,
    paged,
  };
}

describe('Membership’s part of account closure', () => {
  it('refuses an account Identity does not report closed, and a malformed one', async () => {
    const { service, disposed } = accountHarness({ closed: [] });
    expect(await failure(service.disposeAccount('proof-living-1'))).toBe('denied');
    expect(await failure(service.disposeAccount(''))).toBe('invalid');
    expect(disposed).toEqual([]);
  });

  it('disposes in bounded batches until nothing is left', async () => {
    const { service, disposed } = accountHarness({
      closed: ['proof-closed-1'],
      batches: [500, 500, 3, 0],
    });
    expect(await service.disposeAccount('proof-closed-1')).toEqual({
      removed: 1003,
      complete: true,
    });
    expect(disposed).toHaveLength(4);
    for (const call of disposed)
      expect(call).toEqual({ accountId: 'proof-closed-1', limit: 500 });
  });

  it('stops after its bounded rounds and reports the rest pending', async () => {
    const { service, disposed } = accountHarness({
      closed: ['proof-closed-1'],
      batches: [500],
    });
    expect(await service.disposeAccount('proof-closed-1')).toEqual({
      removed: 40 * 500,
      complete: false,
    });
    expect(disposed).toHaveLength(40);
  });

  it('reconciles only the closed accounts among those still holding rows', async () => {
    const { service, disposed, paged } = accountHarness({
      closed: ['proof-closed-2'],
      batches: [2, 0],
      pages: [['proof-living-1', 'proof-closed-2']],
    });
    expect(await service.reconcileClosedAccounts()).toEqual({
      removed: 2,
      complete: true,
    });
    expect(paged).toEqual([{ after: null, limit: 100 }]);
    expect(new Set(disposed.map((call) => call.accountId))).toEqual(
      new Set(['proof-closed-2']),
    );
  });

  it('pages onward from the last account and stops after its bounded pages', async () => {
    const full = Array.from(
      { length: 100 },
      (_, i) => `proof-account-${String(i).padStart(3, '0')}`,
    );
    const { service, paged, disposed } = accountHarness({ closed: [], pages: [full] });
    expect(await service.reconcileClosedAccounts()).toEqual({
      removed: 0,
      complete: false,
    });
    expect(paged).toHaveLength(10);
    expect(paged[1]).toEqual({ after: 'proof-account-099', limit: 100 });
    expect(disposed).toEqual([]);
  });
});

/* ===========================================================================
 * Durable communication
 * ========================================================================= */

const TYPE: MembershipTypeReference = {
  id: ID(1),
  primaryLocale: 'en',
  displayOrder: 0,
  state: 'published',
  labels: [
    {
      locale: 'en',
      title: 'NON_MEMBERSHIP_FIXTURE_EN_TITLE',
      summary: 's',
      description: 'd',
      guidance: null,
    },
    {
      locale: 'ur',
      title: 'NON_MEMBERSHIP_FIXTURE_UR_TITLE',
      summary: 's',
      description: 'd',
      guidance: null,
    },
  ],
};

const intent = (
  overrides: Partial<MembershipCommunicationIntentRecord> = {},
): MembershipCommunicationIntentRecord => ({
  id: ID(50),
  purpose: 'membership.application.approved',
  recipientAccountId: person.accountId,
  applicationId: ID(2),
  membershipId: null,
  dueAt: NOW,
  state: 'pending',
  idempotencyKey: `membership.application.approved:${ID(2)}`,
  ...overrides,
});

const RECIPIENT = {
  accountId: person.accountId,
  email: 'person@membership-proof.invalid',
  locale: 'ur',
};

function communicationHarness(
  options: {
    readonly due?: readonly MembershipCommunicationIntentRecord[];
    readonly source?: {
      readonly owed: boolean;
      readonly intent?: MembershipCommunicationIntentRecord;
    } | null;
    readonly recipients?: readonly (typeof RECIPIENT)[];
    readonly enqueueFails?: boolean;
  } = {},
) {
  const order: string[] = [];
  const calls: Call[] = [];
  const enqueued: unknown[] = [];
  const communication: MembershipCommunicationPort = {
    claimDue: async (...args) => {
      order.push('claimDue');
      calls.push({ method: 'claimDue', args });
      return options.due ?? [intent()];
    },
    deliverySource: async (intentId) => {
      order.push('deliverySource');
      calls.push({ method: 'deliverySource', args: [intentId] });
      if (options.source === null) return null;
      return {
        intent: options.source?.intent ?? intent({ id: intentId }),
        owed: options.source?.owed ?? true,
        type: TYPE,
      };
    },
    markRelayed: async (intentId) => {
      order.push('markRelayed');
      calls.push({ method: 'markRelayed', args: [intentId] });
    },
    markAbandoned: async (intentId) => {
      order.push('markAbandoned');
      calls.push({ method: 'markAbandoned', args: [intentId] });
    },
  };
  const recipients: MembershipRecipientPort = {
    recipients: async (ids) => {
      order.push('recipients');
      calls.push({ method: 'recipients', args: [ids] });
      return options.recipients ?? [RECIPIENT];
    },
  };
  const service = createMembershipCommunicationService({
    communication,
    recipients,
    enqueue: async (delivery) => {
      order.push('enqueue');
      if (options.enqueueFails) throw new Error('NON_MEMBERSHIP_FIXTURE_ENQUEUE_DOWN');
      enqueued.push(delivery);
    },
    baseUrl: 'https://membership-proof.invalid',
    clock: () => NOW,
  });
  return { service, order, calls, enqueued };
}

const delivery = (overrides: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  id: ID(80),
  purpose: 'membership.application.approved',
  sourceReference: `membership:${ID(50)}`,
  idempotencyKey: `membership.application.approved:${ID(2)}`,
  status: 'sending',
  attemptCount: 0,
  ...overrides,
});

describe('Membership’s durable communication', () => {
  it('names exactly its own six purposes', () => {
    for (const purpose of MEMBERSHIP_COMMUNICATION_PURPOSES)
      expect(isMembershipDeliveryPurpose(purpose), purpose).toBe(true);
    for (const purpose of [
      'newsletter.confirmation',
      'learning.class-reminder',
      'membership.application',
      'membership.closed ',
      'email-verification',
    ])
      expect(isMembershipDeliveryPurpose(purpose), purpose).toBe(false);
  });

  it('relays in order: claim, re-check, recipient, enqueue under the intent key, then relayed', async () => {
    const { service, order, calls, enqueued } = communicationHarness();
    expect(await service.relayPendingIntents(7)).toBe(1);
    expect(order).toEqual([
      'claimDue',
      'deliverySource',
      'recipients',
      'enqueue',
      'markRelayed',
    ]);
    expect(calls[0]).toEqual({ method: 'claimDue', args: [NOW, 7, 120] });
    expect(calls[2]).toEqual({ method: 'recipients', args: [[person.accountId]] });
    expect(enqueued).toEqual([
      {
        purpose: 'membership.application.approved',
        recipient: RECIPIENT.email,
        sourceReference: `membership:${ID(50)}`,
        idempotencyKey: `membership.application.approved:${ID(2)}`,
      },
    ]);
  });

  it('abandons an intent no longer owed, one whose record is gone, and one with no active recipient', async () => {
    for (const options of [
      { source: { owed: false } },
      { source: null },
      { recipients: [] },
    ] as const) {
      const { service, order, enqueued } = communicationHarness(options);
      expect(await service.relayPendingIntents(10)).toBe(0);
      expect(order.at(-1)).toBe('markAbandoned');
      expect(order).not.toContain('markRelayed');
      expect(enqueued).toEqual([]);
    }
  });

  it('leaves the intent pending when the enqueue fails', async () => {
    const { service, order } = communicationHarness({ enqueueFails: true });
    await expect(service.relayPendingIntents(10)).rejects.toThrow(
      'NON_MEMBERSHIP_FIXTURE_ENQUEUE_DOWN',
    );
    expect(order).not.toContain('markRelayed');
    expect(order).not.toContain('markAbandoned');
  });

  it('renders an owed delivery in the recipient’s locale, naming the type and linking their page', async () => {
    const { service } = communicationHarness();
    const resolution = await service.resolveDelivery(delivery());
    expect(resolution.outcome).toBe('send');
    if (resolution.outcome !== 'send') return;
    expect(resolution.message.recipient).toBe(RECIPIENT.email);
    expect(resolution.message.html).toContain('<html lang="ur" dir="rtl">');
    expect(resolution.message.text).toContain('NON_MEMBERSHIP_FIXTURE_UR_TITLE');
    expect(resolution.message.text).toContain(
      'https://membership-proof.invalid/ur/my/membership',
    );
    expect(resolution.message.html).not.toContain(RECIPIENT.email);
    expect(resolution.message.text).not.toContain(RECIPIENT.email);
  });

  it('falls back to the primary locale’s title, marked with its language, and to English for an unknown locale', async () => {
    const arabic = communicationHarness({ recipients: [{ ...RECIPIENT, locale: 'ar' }] });
    const resolved = await arabic.service.resolveDelivery(delivery());
    if (resolved.outcome !== 'send') throw new Error('expected a message');
    expect(resolved.message.html).toContain('<html lang="ar" dir="rtl">');
    expect(resolved.message.html).toContain(
      '<span lang="en" dir="ltr">NON_MEMBERSHIP_FIXTURE_EN_TITLE</span>',
    );
    expect(resolved.message.text).toContain(
      'https://membership-proof.invalid/ar/my/membership',
    );

    const unknown = communicationHarness({
      recipients: [{ ...RECIPIENT, locale: 'fr' }],
    });
    const english = await unknown.service.resolveDelivery(delivery());
    if (english.outcome !== 'send') throw new Error('expected a message');
    expect(english.message.html).toContain('<html lang="en" dir="ltr">');
    expect(english.message.text).toContain(
      'https://membership-proof.invalid/en/my/membership',
    );
  });

  it('says nothing is owed for anything it cannot re-check at send time', async () => {
    const cases: [string, Parameters<typeof communicationHarness>[0], DeliveryRecord][] =
      [
        ['another owner’s purpose', {}, delivery({ purpose: 'learning.class-reminder' })],
        ['a malformed source', {}, delivery({ sourceReference: `learning:${ID(50)}` })],
        [
          'a source with extra text',
          {},
          delivery({ sourceReference: `membership:${ID(50)}x` }),
        ],
        ['an intent that is gone', { source: null }, delivery()],
        [
          'an abandoned intent',
          { source: { owed: true, intent: intent({ state: 'abandoned' }) } },
          delivery(),
        ],
        [
          'a record no longer where the message says',
          { source: { owed: false } },
          delivery(),
        ],
        [
          'a purpose the intent does not carry',
          { source: { owed: true, intent: intent({ purpose: 'membership.closed' }) } },
          delivery(),
        ],
        ['an account no longer active', { recipients: [] }, delivery()],
      ];
    for (const [name, options, record] of cases) {
      const { service, order } = communicationHarness(options);
      expect(await service.resolveDelivery(record), name).toEqual({
        outcome: 'nothing-owed',
      });
      expect(order, name).not.toContain('markRelayed');
    }
    const { service, order } = communicationHarness();
    await service.resolveDelivery(delivery({ purpose: 'newsletter.confirmation' }));
    expect(order).toEqual([]);
  });
});
