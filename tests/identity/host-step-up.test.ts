import { describe, expect, it } from 'vitest';

import type {
  AccountSummary,
  PrivilegedPosture,
  StepUpGrantSummary,
} from '../../packages/contracts/src/identity/index.ts';
import { STEP_UP_PURPOSES } from '../../packages/contracts/src/identity/index.ts';
import type { AuditEvent } from '../../packages/contracts/src/platform/index.ts';
import {
  createHostStepUpService,
  HOST_STEP_UP_DECISION,
  HOST_STEP_UP_DEFAULT_MINUTES,
  HOST_STEP_UP_MAX_MINUTES,
  HOST_STEP_UP_PERMISSIONS,
  type HostStepUpServiceDependencies,
} from '../../apps/web/src/contexts/identity-access/index.ts';
import * as lifecycle from '../../packages/database/src/lifecycle/staging-step-up.ts';

/**
 * The staging HOST-ISSUED step-up (OWNER-DECISION-2026-11-09-STAGING-HOST-
 * STEP-UP): Identity's service and the owner-side command's argument and
 * posture checks, with fakes. Every refusal is proven to WRITE NOTHING — a
 * check that refused after the grant was written would be no check.
 *
 * The same rules against a real SQL Server, through the operations tool as
 * the runtime principal: `host-step-up.integration.test.ts`.
 */

const ACCOUNT = 'host-step-up-admin-1';
const SESSION = 'session-0000000001';

const COMPLETE: PrivilegedPosture = {
  secondFactorEnrolled: true,
  recoveryCodesIssued: true,
  recoveryCodesConfirmed: true,
  reenrolmentRequired: false,
};

interface World {
  account: AccountSummary | null;
  permissions: string[];
  posture: PrivilegedPosture;
  session: { sessionId: string; expiresAt: Date } | null;
  grants: {
    accountId: string;
    sessionId: string;
    purpose: string;
    lifetimeSeconds: number;
  }[];
  audits: AuditEvent[];
}

function world(overrides: Partial<World> = {}): World {
  return {
    account: {
      id: ACCOUNT,
      email: 'admin@example.invalid',
      name: 'Proof Administrator',
      status: 'active',
      emailVerified: true,
      createdAt: new Date(0),
      roleKeys: ['platform-administrator'],
    },
    permissions: ['quran.editCanonical', 'roles.administer'],
    posture: COMPLETE,
    session: { sessionId: SESSION, expiresAt: new Date(Date.now() + 3_600_000) },
    grants: [],
    audits: [],
    ...overrides,
  };
}

const STAGING = { environment: 'staging', publicIndexing: 'false' };

function service(state: World, deployment = STAGING) {
  const dependencies: HostStepUpServiceDependencies = {
    deployment,
    authorization: {
      findAccountSummary: async (id) => (state.account?.id === id ? state.account : null),
      readPosture: async () => state.posture,
      createStepUpGrant: async (input) => {
        state.grants.push({ ...input });
        const grant: StepUpGrantSummary = {
          id: 'grant-1',
          purpose: input.purpose,
          expiresAt: new Date(Date.now() + input.lifetimeSeconds * 1000),
        };
        return grant;
      },
    },
    reader: { effectivePermissions: async () => state.permissions },
    sessions: { latestLiveSession: async () => state.session },
    audit: {
      record: async (event) => {
        state.audits.push(event);
      },
    },
  };
  return createHostStepUpService(dependencies);
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const candidate = error as { name?: string; reason?: string };
    expect(candidate.name).toBe('HostStepUpRefusal');
    return candidate.reason ?? '';
  }
  throw new Error('expected a refusal');
}

describe('the staging host-issued step-up — Identity’s service', () => {
  it('issues the browser’s grant, bound to the live session, and audits it as host-issued', async () => {
    const state = world();
    const issued = await service(state).issue({
      accountId: ACCOUNT,
      purpose: 'quran-canonical-edit',
      minutes: 15,
    });

    expect(issued.sessionId).toBe(SESSION);
    expect(state.grants).toEqual([
      {
        accountId: ACCOUNT,
        sessionId: SESSION,
        purpose: 'quran-canonical-edit',
        lifetimeSeconds: 900,
      },
    ]);
    expect(state.audits).toEqual([
      {
        action: 'identity.security.step-up-granted',
        actorType: 'operator',
        actorId: null,
        targetType: 'user',
        targetId: ACCOUNT,
        after: {
          purpose: 'quran-canonical-edit',
          issuance: 'staging-host',
          lifetimeSeconds: '900',
        },
        authorisingSource: HOST_STEP_UP_DECISION,
      },
    ]);
    // No secret or token travels in the audit payload.
    expect(JSON.stringify(state.audits)).not.toMatch(/token|password|secret/iu);
  });

  it('cannot even be constructed outside a declared, non-indexable staging deployment', () => {
    for (const deployment of [
      { environment: 'production', publicIndexing: 'false' },
      { environment: undefined, publicIndexing: 'false' },
      { environment: 'staging', publicIndexing: 'true' },
      { environment: 'staging', publicIndexing: undefined },
      { environment: 'Staging', publicIndexing: 'false' },
    ])
      expect(() => service(world(), deployment)).toThrow(/not-staging/u);
  });

  const refusals: readonly {
    readonly name: string;
    readonly state: Partial<World>;
    readonly input?: Partial<{ purpose: string; minutes: number; accountId: string }>;
    readonly reason: string;
  }[] = [
    {
      name: 'an unknown purpose',
      state: {},
      input: { purpose: 'everything' },
      reason: 'unknown-purpose',
    },
    {
      name: 'the second-factor purpose',
      state: {},
      input: { purpose: 'second-factor' },
      reason: 'purpose-not-host-issuable',
    },
    {
      name: 'a lifetime above the cap',
      state: {},
      input: { minutes: 16 },
      reason: 'invalid-lifetime',
    },
    {
      name: 'a zero lifetime',
      state: {},
      input: { minutes: 0 },
      reason: 'invalid-lifetime',
    },
    {
      name: 'a fractional lifetime',
      state: {},
      input: { minutes: 1.5 },
      reason: 'invalid-lifetime',
    },
    { name: 'an unknown account', state: { account: null }, reason: 'unknown-account' },
    {
      name: 'an inactive account',
      state: {
        account: { ...world().account!, status: 'suspended' },
      },
      reason: 'account-inactive',
    },
    {
      name: 'an account without the purpose’s permission',
      state: { permissions: ['roles.administer'] },
      reason: 'no-permission',
    },
    {
      name: 'an account with no enrolled factor',
      state: { posture: { ...COMPLETE, secondFactorEnrolled: false } },
      reason: 'second-factor-required',
    },
    {
      name: 'an account whose recovery codes are unconfirmed',
      state: { posture: { ...COMPLETE, recoveryCodesConfirmed: false } },
      reason: 'second-factor-required',
    },
    {
      name: 'an account that must re-enrol',
      state: { posture: { ...COMPLETE, reenrolmentRequired: true } },
      reason: 'second-factor-required',
    },
    {
      name: 'an account with no live session',
      state: { session: null },
      reason: 'no-live-session',
    },
    {
      name: 'a session that has just expired',
      state: { session: { sessionId: SESSION, expiresAt: new Date(Date.now() - 1) } },
      reason: 'no-live-session',
    },
  ];

  for (const { name, state: overrides, input, reason } of refusals)
    it(`refuses ${name}, writing nothing`, async () => {
      const state = world(overrides);
      expect(
        await refusal(
          service(state).issue({
            accountId: ACCOUNT,
            purpose: 'quran-canonical-edit',
            minutes: HOST_STEP_UP_DEFAULT_MINUTES,
            ...input,
          }),
        ),
      ).toBe(reason);
      expect(state.grants).toEqual([]);
      expect(state.audits).toEqual([]);
    });

  it('maps every purpose but second-factor to the permissions its gate demands', () => {
    expect(Object.keys(HOST_STEP_UP_PERMISSIONS).sort()).toEqual(
      [...STEP_UP_PURPOSES].sort(),
    );
    expect(HOST_STEP_UP_PERMISSIONS['second-factor']).toBeNull();
    expect(HOST_STEP_UP_PERMISSIONS['quran-canonical-edit']).toEqual([
      'quran.editCanonical',
    ]);
    expect(HOST_STEP_UP_PERMISSIONS['migration-publication']).toEqual([
      'migration.publish',
    ]);
    expect(HOST_STEP_UP_PERMISSIONS['privilege-administration']).toEqual([
      'roles.administer',
      'permissions.grant',
    ]);
  });

  it('accepts either permission a privilege-administration gate demands', async () => {
    const state = world({ permissions: ['permissions.grant'] });
    await service(state).issue({
      accountId: ACCOUNT,
      purpose: 'privilege-administration',
      minutes: 1,
    });
    expect(state.grants.map((grant) => grant.lifetimeSeconds)).toEqual([60]);
  });
});

describe('the staging host-issued step-up — the owner-side command’s checks', () => {
  it('agrees with Identity on the decision, the default and the cap', () => {
    expect(lifecycle.HOST_STEP_UP_DECISION).toBe(HOST_STEP_UP_DECISION);
    expect(lifecycle.HOST_STEP_UP_DEFAULT_MINUTES).toBe(HOST_STEP_UP_DEFAULT_MINUTES);
    expect(lifecycle.HOST_STEP_UP_MAX_MINUTES).toBe(HOST_STEP_UP_MAX_MINUTES);
  });

  it('refuses anything but the declared, non-indexable staging deployment', () => {
    expect(() =>
      lifecycle.assertHostStepUpPosture({
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
        PUBLIC_INDEXING_ENABLED: 'false',
      }),
    ).not.toThrow();
    for (const values of [
      {},
      { MINHAJ_DEPLOYMENT_ENVIRONMENT: 'production', PUBLIC_INDEXING_ENABLED: 'false' },
      { MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging' },
      { MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging', PUBLIC_INDEXING_ENABLED: 'true' },
    ])
      expect(() => lifecycle.assertHostStepUpPosture(values)).toThrow(
        /staging-only|non-indexable/u,
      );
  });

  it('reads the arguments strictly, defaulting the lifetime to five minutes', () => {
    expect(
      lifecycle.parseHostStepUpArguments([
        'grant',
        '--account',
        ACCOUNT,
        '--purpose',
        'migration-publication',
      ]),
    ).toEqual({ accountId: ACCOUNT, purpose: 'migration-publication', minutes: 5 });
    expect(
      lifecycle.hostStepUpToolArguments({
        accountId: ACCOUNT,
        purpose: 'quran-canonical-edit',
        minutes: 15,
      }),
    ).toEqual([
      'grant',
      '--account',
      ACCOUNT,
      '--purpose',
      'quran-canonical-edit',
      '--minutes',
      '15',
    ]);

    const base = ['grant', '--account', ACCOUNT, '--purpose', 'quran-canonical-edit'];
    for (const argv of [
      [],
      ['revoke', '--account', ACCOUNT, '--purpose', 'quran-canonical-edit'],
      [
        'grant',
        '--account',
        'admin@example.invalid',
        '--purpose',
        'quran-canonical-edit',
      ],
      ['grant', '--account', ACCOUNT, '--purpose', 'everything'],
      ['grant', '--account', ACCOUNT],
      [...base, '--minutes', '16'],
      [...base, '--minutes', '0'],
      [...base, '--minutes', '1.5'],
      [...base, '--minutes', '-1'],
      [...base, '--minutes'],
      [...base, '--account', 'another-account-1'],
      [...base, '--session', SESSION],
      ['grant', '--account', '--purpose', 'quran-canonical-edit'],
    ])
      expect(() => lifecycle.parseHostStepUpArguments(argv), argv.join(' ')).toThrow();
  });
});
