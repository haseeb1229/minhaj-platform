import { describe, expect, it } from 'vitest';

import type {
  AuthorizationReaderPort,
  PrivilegedActor,
  ResolvedSession,
  StepUpPurpose,
} from '../../packages/contracts/src/identity/index.ts';
import {
  EXTERNALLY_GATED_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import {
  FATWA_PERMISSIONS,
  fatwaOwnerStatus,
  fatwaQuestionStage,
  type FatwaAuthorityPort,
  type FatwaOwnerPort,
  type FatwaPublicReaderPort,
  type FatwaStaffReaderPort,
  type FatwaWorkflowPort,
} from '../../packages/contracts/src/fatwa/index.ts';
import type { RateLimiterPort } from '../../packages/contracts/src/platform/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  FATWA_REFUSAL_REASONS,
  createFatwaAskService,
  createFatwaReadCounter,
  createFatwaReadService,
  createFatwaWorkflowService,
  fatwaFailure,
  isFatwaRefusalReason,
  type FatwaWorkflowLogDetail,
} from '../../apps/web/src/contexts/fatwa/index.ts';

/**
 * Phase 20 — the Fatwa services' rules, over fake ports.
 *
 * WHAT IS PROVED HERE, CHEAPLY: each workflow stage requires exactly its own
 * key, asked of Identity LIVE on every call and BEFORE anything is parsed;
 * no other key — the whole protected administrator bundle included — confers
 * any stage; publication and withdrawal accept only an actor Identity minted
 * for exactly `fatwa.publish` with a live `fatwa-publication` grant; asking is
 * refused while the service is inactive without spending the limiter or
 * reaching persistence; and a read is counted only for a public ruling, once
 * per limiter window. The real database re-checks are proved in
 * `persistence.integration.test.ts`.
 *
 * Every string is a synthetic `NON_FATWA_FIXTURE_*` sentinel.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: ID(100) };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return fatwaFailure(error);
  }
  return 'accepted';
}

/** Who asked — the account and question id, never the question's words. */
const ASKER = { accountId: 'proof-asker-1', questionId: ID(1) } as const;

const draft = (overrides: Record<string, unknown> = {}) => ({
  questionId: ID(1),
  expectedVersion: 0,
  slug: 'non-fatwa-fixture-ruling',
  title: 'NON_FATWA_FIXTURE_TITLE',
  publicQuestion: 'NON_FATWA_FIXTURE_PUBLIC_QUESTION_TEXT',
  ruling: 'NON_FATWA_FIXTURE_RULING_1 text body',
  language: 'en',
  categoryId: ID(2),
  topicIds: [],
  correctionReason: null,
  ...overrides,
});

function workflowHarness(
  options: {
    readonly permissions?: readonly string[];
    readonly verifyPublication?: (actor: PrivilegedActor) => Promise<boolean>;
    readonly throws?: Partial<Record<string, unknown>>;
  } = {},
) {
  const calls: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  const permitted: { permission: string }[] = [];
  const logged: FatwaWorkflowLogDetail[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      const thrown = options.throws?.[method];
      if (thrown !== undefined) throw thrown;
      if (method === 'assignedFatwa') return { id: ID(9) };
      // Phase 21: who to tell, read only after a decline or publication.
      if (method === 'askerOf') return ASKER;
      if (method.endsWith('Question') || method.endsWith('Fatwa')) return null;
      if (method === 'categories') return [];
      return { items: [], total: 0, offset: 0 };
    };
  const workflow = new Proxy(
    {},
    { get: (_t, method: string) => record(method) },
  ) as FatwaWorkflowPort;
  const staff = new Proxy(
    {},
    { get: (_t, method: string) => record(method) },
  ) as FatwaStaffReaderPort;
  const authority: FatwaAuthorityPort = {
    permits: async (_accountId, permission) => {
      permitted.push({ permission });
      return (options.permissions ?? []).includes(permission);
    },
    verifyPublication: options.verifyPublication ?? (async () => false),
    answerers: async () => [{ accountId: ID(5), name: 'NON_FATWA_FIXTURE_ANSWERER' }],
  };
  let n = 500;
  const service = createFatwaWorkflowService({
    workflow,
    staff,
    authority,
    log: { info: (detail) => logged.push(detail), warn: (detail) => logged.push(detail) },
    ids: () => ID((n += 1)),
  });
  return { service, calls, permitted, logged };
}

/* ===========================================================================
 * The permission catalogue — externally gated keys are not bundled
 * ========================================================================= */

describe('the Fatwa permission vocabulary', () => {
  it('catalogues exactly the three keys the accepted documents name', () => {
    const keys = PERMISSION_CATALOGUE.map((entry) => entry.key);
    for (const key of Object.values(FATWA_PERMISSIONS)) expect(keys).toContain(key);
    expect(
      keys
        .filter((key) => key.startsWith('fatwa.') || key.startsWith('question.'))
        .sort(),
    ).toEqual(['fatwa.answer', 'fatwa.publish', 'question.receive']);
  });

  it('keeps every externally gated key out of the protected administrator bundle', () => {
    expect([...EXTERNALLY_GATED_PERMISSIONS].sort()).toEqual([
      'fatwa.answer',
      'fatwa.publish',
      'question.receive',
    ]);
    for (const key of EXTERNALLY_GATED_PERMISSIONS)
      expect(PLATFORM_ADMINISTRATOR_PERMISSIONS).not.toContain(key);
    // Every other catalogued key is still bundled: nothing else changed.
    expect(PLATFORM_ADMINISTRATOR_PERMISSIONS.length).toBe(
      PERMISSION_CATALOGUE.length - EXTERNALLY_GATED_PERMISSIONS.length,
    );
  });

  it('has a dedicated publication step-up purpose', () => {
    expect(STEP_UP_PURPOSES).toContain('fatwa-publication');
  });
});

/* ===========================================================================
 * The workflow — one key per stage, asked first
 * ========================================================================= */

describe('the workflow service', () => {
  it('refuses every stage to an account holding the whole protected bundle and no Fatwa key', async () => {
    const admin = workflowHarness({ permissions: PLATFORM_ADMINISTRATOR_PERMISSIONS });
    const attempts = [
      admin.service.intake(actor, 0),
      admin.service.intakeQuestion(actor, ID(1)),
      admin.service.answerers(actor),
      admin.service.triage(actor, { id: ID(1), expectedVersion: 1, categoryId: ID(2) }),
      admin.service.assign(actor, { id: ID(1), expectedVersion: 1, assigneeId: ID(5) }),
      admin.service.decline(actor, { id: ID(1), expectedVersion: 1 }),
      admin.service.assigned(actor, 0),
      admin.service.assignedQuestion(actor, ID(1)),
      admin.service.saveDraft(actor, draft()),
      admin.service.submitForReview(actor, {
        fatwaId: ID(9),
        expectedVersion: 2,
        revisionId: ID(3),
      }),
      admin.service.reviewQueue(actor, 0),
      admin.service.reviewQuestion(actor, ID(9)),
      admin.service.returnForRevision(actor, {
        fatwaId: ID(9),
        expectedVersion: 3,
        revisionId: ID(3),
        note: 'NON_FATWA_FIXTURE_NOTE',
      }),
      admin.service.published(actor, 0),
      admin.service.categories(actor),
      admin.service.createCategory(actor, {
        slug: 'fixture',
        topicId: ID(7),
        position: 0,
        names: [{ locale: 'en', name: 'NON_FATWA_FIXTURE_CATEGORY' }],
      }),
    ];
    for (const attempt of attempts) expect(await failure(attempt)).toBe('denied');
    expect(admin.calls).toEqual([]);
  });

  it('names the asker of a declined question only after the decline has been written', async () => {
    const receiver = workflowHarness({ permissions: [FATWA_PERMISSIONS.receive] });
    expect(
      await receiver.service.decline(actor, { id: ID(1), expectedVersion: 1 }),
    ).toEqual(ASKER);
    expect(receiver.calls.map((call) => call.method)).toEqual(['decline', 'askerOf']);
    expect(receiver.calls[1]?.args).toEqual([{ questionId: ID(1) }]);

    // A refused decline asks nobody: there is nothing to tell.
    const refused = workflowHarness({
      permissions: [FATWA_PERMISSIONS.receive],
      throws: { decline: { reason: 'conflict' } },
    });
    expect(
      await failure(refused.service.decline(actor, { id: ID(1), expectedVersion: 1 })),
    ).toBe('conflict');
    expect(refused.calls.map((call) => call.method)).toEqual(['decline']);
  });

  it('gives each key exactly its own stage and nothing more', async () => {
    const receiver = workflowHarness({ permissions: [FATWA_PERMISSIONS.receive] });
    expect(
      await failure(
        receiver.service.triage(actor, {
          id: ID(1),
          expectedVersion: 1,
          categoryId: ID(2),
        }),
      ),
    ).toBe('accepted');
    expect(await failure(receiver.service.saveDraft(actor, draft()))).toBe('denied');
    expect(await failure(receiver.service.reviewQueue(actor, 0))).toBe('denied');

    const answerer = workflowHarness({ permissions: [FATWA_PERMISSIONS.answer] });
    expect(await failure(answerer.service.saveDraft(actor, draft()))).toBe('accepted');
    expect(await failure(answerer.service.intake(actor, 0))).toBe('denied');
    expect(await failure(answerer.service.reviewQuestion(actor, ID(9)))).toBe('denied');

    const publisher = workflowHarness({ permissions: [FATWA_PERMISSIONS.publish] });
    expect(await failure(publisher.service.reviewQueue(actor, 0))).toBe('accepted');
    expect(await failure(publisher.service.intakeQuestion(actor, ID(1)))).toBe('denied');
    expect(await failure(publisher.service.saveDraft(actor, draft()))).toBe('denied');
  });

  it('asks permission before parsing, so an unauthorised caller learns nothing of the rules', async () => {
    const outsider = workflowHarness();
    expect(
      await failure(outsider.service.saveDraft(actor, { nonsense: true } as never)),
    ).toBe('denied');
    const answerer = workflowHarness({ permissions: [FATWA_PERMISSIONS.answer] });
    expect(
      await failure(answerer.service.saveDraft(actor, { nonsense: true } as never)),
    ).toBe('invalid');
    expect(answerer.calls).toEqual([]);
  });

  it('refuses reserved slugs, a too-short public question and duplicate topics before persistence', async () => {
    const answerer = workflowHarness({ permissions: [FATWA_PERMISSIONS.answer] });
    for (const slug of ['latest', 'popular', 'search', 'ask', 'how-it-works', 'Bad Slug'])
      expect(await failure(answerer.service.saveDraft(actor, draft({ slug })))).toBe(
        'invalid',
      );
    expect(
      await failure(
        answerer.service.saveDraft(actor, draft({ publicQuestion: 'short' })),
      ),
    ).toBe('invalid');
    expect(
      await failure(
        answerer.service.saveDraft(actor, draft({ topicIds: [ID(7), ID(7)] })),
      ),
    ).toBe('invalid');
    expect(answerer.calls).toEqual([]);
  });

  it('creates a ruling on the first save and names the existing one on every later save', async () => {
    const answerer = workflowHarness({ permissions: [FATWA_PERMISSIONS.answer] });
    const first = await answerer.service.saveDraft(actor, draft());
    expect(first.fatwaId).not.toBe(ID(9));
    const later = await answerer.service.saveDraft(actor, draft({ expectedVersion: 2 }));
    expect(later.fatwaId).toBe(ID(9));
    const saves = answerer.calls.filter((call) => call.method === 'saveDraft');
    expect(saves).toHaveLength(2);
    expect(saves[1]?.args[0]).toMatchObject({ actorId: actor.accountId, fatwaId: ID(9) });
  });

  it('maps a database refusal to its reason and an outage to unavailable', async () => {
    const answerer = workflowHarness({
      permissions: [FATWA_PERMISSIONS.answer],
      throws: { saveDraft: { reason: 'slug-frozen' } },
    });
    expect(await failure(answerer.service.saveDraft(actor, draft()))).toBe('slug-frozen');
    const broken = workflowHarness({
      permissions: [FATWA_PERMISSIONS.receive],
      throws: { triage: new Error('synthetic outage') },
    });
    expect(
      await failure(
        broken.service.triage(actor, {
          id: ID(1),
          expectedVersion: 1,
          categoryId: ID(2),
        }),
      ),
    ).toBe('unavailable');
    const secret = workflowHarness({
      permissions: [FATWA_PERMISSIONS.receive],
      throws: { triage: { reason: 'Fatwa_slug_key' } },
    });
    expect(
      await failure(
        secret.service.triage(actor, {
          id: ID(1),
          expectedVersion: 1,
          categoryId: ID(2),
        }),
      ),
    ).toBe('unavailable');
  });

  it('names categories only', () => {
    expect(FATWA_REFUSAL_REASONS).toContain('self-publication');
    expect(isFatwaRefusalReason('unavailable')).toBe(true);
    expect(isFatwaRefusalReason('FatwaQuestion_body_ck')).toBe(false);
  });
});

/* ===========================================================================
 * Publication — through the REAL Identity verification, over a fake reader
 * ========================================================================= */

const STEP_UP_IDS: Record<StepUpPurpose, number> = {
  'privilege-administration': 1,
  'account-administration': 2,
  'second-factor': 3,
  'quran-canonical-edit': 4,
  'hadith-canonical-edit': 5,
  'fatwa-publication': 6,
};

function identity(options: {
  readonly permissions?: readonly string[];
  readonly grants?: readonly StepUpPurpose[];
}) {
  const accountId = ID(200);
  const reader: AuthorizationReaderPort = {
    effectivePermissions: async () => [...(options.permissions ?? [])],
    privilegedPosture: async () => ({
      secondFactorEnrolled: true,
      recoveryCodesIssued: true,
      recoveryCodesConfirmed: true,
      reenrolmentRequired: false,
    }),
    findStepUpGrant: async ({ purpose }) =>
      (options.grants ?? []).includes(purpose)
        ? {
            id: `${ID(300).slice(0, -2)}${String(STEP_UP_IDS[purpose]).padStart(2, '0')}`,
            purpose,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : null,
  };
  const authorization = createAuthorizationService({ reader });
  const session = {
    sessionId: ID(400),
    sessionCreatedAt: new Date(),
    sessionExpiresAt: new Date(Date.now() + 60_000),
    account: { id: accountId, status: 'active' },
  } as unknown as ResolvedSession;
  return {
    authorization,
    attempt: (permission: string, stepUp: StepUpPurpose) =>
      authorization.requirePrivilegedAction({
        session,
        permission: permission as never,
        stepUp,
      }),
  };
}

async function publicationHarness(options: {
  readonly permissions: readonly string[];
  readonly grants: readonly StepUpPurpose[];
  readonly mint: { readonly permission: string; readonly stepUp: StepUpPurpose };
}) {
  const id = identity(options);
  const outcome = await id.attempt(options.mint.permission, options.mint.stepUp);
  const harness = workflowHarness({
    permissions: options.permissions,
    verifyPublication: (actor) =>
      id.authorization.verifyPrivilegedActor({
        actor,
        permission: 'fatwa.publish',
        stepUp: 'fatwa-publication',
      }),
  });
  return { ...harness, outcome };
}

const decision = { fatwaId: ID(9), expectedVersion: 3, revisionId: ID(3) };

describe('the one publication operation', () => {
  it('publishes only with fatwa.publish AND a live fatwa-publication grant, passing the verified ids down', async () => {
    const h = await publicationHarness({
      permissions: ['fatwa.publish'],
      grants: ['fatwa-publication'],
      mint: { permission: 'fatwa.publish', stepUp: 'fatwa-publication' },
    });
    expect(h.outcome.state).toBe('allowed');
    if (h.outcome.state !== 'allowed') return;
    // Phase 21: the asker is named only once the publication has committed.
    expect(await h.service.publish(h.outcome.actor, decision)).toEqual(ASKER);
    const call = h.calls.find((entry) => entry.method === 'publish');
    expect(call?.args[0]).toMatchObject({
      authority: { actorId: ID(200), sessionId: ID(400) },
      value: decision,
    });
    const methods = h.calls.map((entry) => entry.method);
    expect(methods.indexOf('askerOf')).toBeGreaterThan(methods.indexOf('publish'));
    expect(h.calls.find((entry) => entry.method === 'askerOf')?.args).toEqual([
      { fatwaId: decision.fatwaId },
    ]);
    expect(h.logged).toContainEqual(
      expect.objectContaining({ operation: 'fatwa.publish', outcome: 'passed' }),
    );
  });

  it('refuses an actor minted for any other permission or purpose', async () => {
    for (const mint of [
      { permission: 'hadith.editCanonical', stepUp: 'hadith-canonical-edit' as const },
      { permission: 'quran.editCanonical', stepUp: 'quran-canonical-edit' as const },
      { permission: 'permissions.grant', stepUp: 'privilege-administration' as const },
      { permission: 'fatwa.publish', stepUp: 'privilege-administration' as const },
    ]) {
      const h = await publicationHarness({
        permissions: ['fatwa.publish', mint.permission],
        grants: ['fatwa-publication', mint.stepUp],
        mint,
      });
      if (h.outcome.state !== 'allowed') continue;
      expect(await failure(h.service.publish(h.outcome.actor, decision))).toBe('denied');
      expect(
        await failure(
          h.service.withdraw(h.outcome.actor, {
            fatwaId: ID(9),
            expectedVersion: 4,
            reason: 'NON_FATWA_FIXTURE_REASON',
          }),
        ),
      ).toBe('denied');
      expect(
        h.calls.some((call) => call.method === 'publish' || call.method === 'withdraw'),
      ).toBe(false);
    }
  });

  it('refuses a look-alike object that Identity did not mint', async () => {
    const h = await publicationHarness({
      permissions: ['fatwa.publish'],
      grants: ['fatwa-publication'],
      mint: { permission: 'fatwa.publish', stepUp: 'fatwa-publication' },
    });
    const forged = {
      authorisation: 'verified',
      accountId: ID(200),
      sessionId: ID(400),
      permission: 'fatwa.publish',
      stepUp: 'fatwa-publication',
      stepUpGrantId: ID(306),
    } as unknown as PrivilegedActor;
    expect(await failure(h.service.publish(forged, decision))).toBe('denied');
    expect(h.calls).toEqual([]);
  });

  it('refuses once the permission is no longer held, even with the minted actor', async () => {
    const id = identity({
      permissions: ['fatwa.publish'],
      grants: ['fatwa-publication'],
    });
    const outcome = await id.attempt('fatwa.publish', 'fatwa-publication');
    expect(outcome.state).toBe('allowed');
    if (outcome.state !== 'allowed') return;
    const revoked = identity({ permissions: [], grants: ['fatwa-publication'] });
    const h = workflowHarness({
      verifyPublication: (actor) =>
        revoked.authorization.verifyPrivilegedActor({
          actor,
          permission: 'fatwa.publish',
          stepUp: 'fatwa-publication',
        }),
    });
    expect(await failure(h.service.publish(outcome.actor, decision))).toBe('denied');
  });
});

/* ===========================================================================
 * Asking
 * ========================================================================= */

function askHarness(options: { readonly active: boolean; readonly allowed?: boolean }) {
  const submitted: unknown[] = [];
  const consumed: string[] = [];
  const owner: FatwaOwnerPort = {
    submit: async (input) => {
      submitted.push(input);
    },
    questions: async (askerId) => ({
      items: [],
      total: 0,
      offset: askerId === actor.accountId ? 0 : -1,
    }),
    question: async () => null,
  };
  const limiter: RateLimiterPort = {
    consume: async (key) => {
      consumed.push(key);
      return { allowed: options.allowed ?? true, retryAfter: 0 };
    },
    purgeExpired: async () => 0,
  };
  const service = createFatwaAskService({
    owner,
    reader: {
      availability: async () =>
        options.active
          ? { active: true, mode: 'fixture' as const }
          : { active: false as const },
    },
    limiter,
    key: (accountId) => `fatwa-question:${accountId}`,
    ids: () => ID(900),
  });
  return { service, submitted, consumed };
}

describe('asking a question', () => {
  const body = 'NON_FATWA_FIXTURE_QUESTION_BODY private words';

  it('captures nothing while the service is inactive — no limiter spend, no persistence', async () => {
    const h = askHarness({ active: false });
    expect(await failure(h.service.submit(actor, { body }))).toBe('inactive');
    expect(h.submitted).toEqual([]);
    expect(h.consumed).toEqual([]);
  });

  it('refuses invalid input before spending the limiter', async () => {
    const h = askHarness({ active: true });
    expect(await failure(h.service.submit(actor, { body: 'too short' }))).toBe('invalid');
    expect(await failure(h.service.submit(actor, { body, askerId: ID(999) }))).toBe(
      'invalid',
    );
    expect(h.consumed).toEqual([]);
  });

  it('keys the limiter by the account, never by the question, and the asker is the session', async () => {
    const h = askHarness({ active: true });
    await h.service.submit(actor, { body });
    expect(h.consumed).toEqual([`fatwa-question:${actor.accountId}`]);
    expect(h.consumed.join()).not.toContain('NON_FATWA_FIXTURE_QUESTION_BODY');
    expect(h.submitted).toEqual([
      { id: ID(900), askerId: actor.accountId, value: { body } },
    ]);
  });

  it('refuses beyond the rate limit', async () => {
    const h = askHarness({ active: true, allowed: false });
    expect(await failure(h.service.submit(actor, { body }))).toBe('rate-limited');
    expect(h.submitted).toEqual([]);
  });

  it('never looks up a malformed question id', async () => {
    const h = askHarness({ active: true });
    expect(await h.service.question(actor, "1' OR '1'='1")).toBeNull();
  });
});

/* ===========================================================================
 * Reading, and counting a read
 * ========================================================================= */

describe('public reads and the read tally', () => {
  const reader = {
    availability: async () => ({ active: true, mode: 'fixture' as const }),
    categories: async () => [],
    category: async () => null,
    browse: async () => ({ items: [], total: 7, offset: 0 }),
    fatwa: async () => null,
    publicId: async (slug: string) => (slug === 'public-ruling' ? ID(9) : null),
    sitemap: async () => [],
    searchRecord: async () => null,
    searchScopes: async () => [],
    publicTargets: async () => [],
    searchRecords: async () => [],
  } satisfies FatwaPublicReaderPort;

  it('never broadens a listing for an unknown sort or filter', async () => {
    const service = createFatwaReadService(reader);
    expect(
      (
        await service.browse({
          sort: 'latest',
          categoryId: null,
          topicId: null,
          offset: 0,
        })
      ).total,
    ).toBe(7);
    expect(
      (
        await service.browse({
          sort: 'random' as never,
          categoryId: null,
          topicId: null,
          offset: 0,
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await service.browse({
          sort: 'popular',
          categoryId: 'not-an-id',
          topicId: null,
          offset: 0,
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await service.browse({
          sort: 'popular',
          categoryId: null,
          topicId: null,
          offset: -1,
        })
      ).total,
    ).toBe(0);
  });

  it('counts a public ruling once per limiter window and never a non-public one', async () => {
    const recorded: string[] = [];
    const keys: string[] = [];
    let allowed = true;
    const counter = createFatwaReadCounter({
      reader,
      tally: { record: async (id) => void recorded.push(id) },
      limiter: {
        consume: async (key) => {
          keys.push(key);
          return { allowed, retryAfter: 0 };
        },
        purgeExpired: async () => 0,
      },
      key: (address, id) => `${address}|${id}`,
    });
    await counter.record('public-ruling', 'NON_FATWA_FIXTURE_ADDRESS');
    allowed = false;
    await counter.record('public-ruling', 'NON_FATWA_FIXTURE_ADDRESS');
    await counter.record('withdrawn-ruling', 'NON_FATWA_FIXTURE_ADDRESS');
    await counter.record('Not A Slug', 'NON_FATWA_FIXTURE_ADDRESS');
    expect(recorded).toEqual([ID(9)]);
    expect(keys).toEqual([
      `NON_FATWA_FIXTURE_ADDRESS|${ID(9)}`,
      `NON_FATWA_FIXTURE_ADDRESS|${ID(9)}`,
    ]);
  });
});

/* ===========================================================================
 * The derived lifecycle
 * ========================================================================= */

describe('the question lifecycle', () => {
  it('derives the canonical stages and tells the asker only coarse facts', () => {
    expect(fatwaQuestionStage('assigned', null)).toBe('assigned');
    expect(fatwaQuestionStage('assigned', 'drafting')).toBe('drafted');
    expect(fatwaQuestionStage('assigned', 'in_review')).toBe('in_review');
    expect(fatwaQuestionStage('assigned', 'returned')).toBe('returned');
    expect(fatwaQuestionStage('answered', 'drafting')).toBe('published');
    expect(fatwaQuestionStage('declined', null)).toBe('declined');
    expect(fatwaOwnerStatus('submitted')).toBe('received');
    expect(fatwaOwnerStatus('returned')).toBe('in_progress');
    expect(fatwaOwnerStatus('in_review')).toBe('in_progress');
    expect(fatwaOwnerStatus('published')).toBe('answered');
  });
});
