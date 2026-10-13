import { describe, expect, it } from 'vitest';

import type {
  AuthorizationReaderPort,
  PrivilegedActor,
  ResolvedSession,
  StepUpPurpose,
} from '../../packages/contracts/src/identity/index.ts';
import type {
  HadithCanonicalPort,
  HadithPersistencePort,
} from '../../packages/contracts/src/hadith/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  HADITH_REFUSAL_REASONS,
  HadithRefusal,
  createHadithCanonicalService,
  createHadithService,
  hadithFailure,
  isHadithRefusalReason,
  type HadithCanonicalLogDetail,
} from '../../apps/web/src/contexts/hadith/index.ts';

/**
 * Phase 19 — the Hadith services' rules, over fake ports.
 *
 * WHAT IS PROVED HERE, CHEAPLY: every read requires `hadith.read` and every
 * layered change `hadith.administer`, asked of the authority LIVE on every
 * call; no other key — `quran.*`, `content.*`, `library.*`, `media.*`, even
 * `hadith.editCanonical` — confers either; input is refused by strict schemas
 * before persistence is reached; publication is pre-checked in a fixed order;
 * and the canonical service accepts only an actor Identity minted for exactly
 * `hadith.editCanonical` with a live `hadith-canonical-edit` grant, passes the
 * verified authority ids to the port, and logs identifiers only.
 *
 * Every string is a synthetic sentinel. No Hadith text, chain, grading,
 * grader or collection name appears anywhere.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const actor = { accountId: ID(100) };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return hadithFailure(error);
  }
  return 'accepted';
}

function harness(
  options: {
    readonly permissions?: readonly string[];
    readonly records?: Partial<Record<string, unknown>>;
    readonly throws?: Partial<Record<string, unknown>>;
  } = {},
) {
  const calls: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  const permissions = new Set(
    options.permissions ?? ['hadith.read', 'hadith.administer'],
  );
  const asked: string[] = [];

  const persistence = new Proxy({} as HadithPersistencePort, {
    get(_target, method: string) {
      return async (...args: unknown[]) => {
        calls.push({ method, args });
        if (options.throws && method in options.throws) throw options.throws[method];
        if (options.records && method in options.records) return options.records[method];
        return { saved: method };
      };
    },
  });

  const service = createHadithService({
    persistence,
    authority: {
      async permits(accountId, permission) {
        asked.push(`${accountId}:${permission}`);
        return permissions.has(permission);
      },
      verifyCanonical: async () => true,
    },
  });

  return { service, calls, asked, permissions };
}

const translationValue = (overrides: Record<string, unknown> = {}) => ({
  languageCode: 'en',
  text: 'NON_HADITH_FIXTURE_TRANSLATION_1',
  attribution: null,
  sourceSystemId: ID(7),
  contributors: [],
  ...overrides,
});

const commentaryValue = (overrides: Record<string, unknown> = {}) => ({
  slug: 'fixture-commentary-a',
  name: 'NON_HADITH_FIXTURE_COMMENTARY_1',
  description: null,
  attribution: null,
  languageCode: 'en',
  sourceSystemId: null,
  contributors: [],
  ...overrides,
});

const scienceValue = (overrides: Record<string, unknown> = {}) => ({
  slug: 'fixture-science-a',
  position: 0,
  attribution: null,
  sourceSystemId: null,
  texts: [
    {
      languageCode: 'en',
      title: 'NON_HADITH_FIXTURE_SCIENCE_1',
      body: 'NON_HADITH_FIXTURE_SCIENCE_1',
    },
  ],
  ...overrides,
});

const layerRecord = (overrides: Record<string, unknown> = {}) => ({
  id: ID(1),
  version: 3,
  sourceSystemId: ID(7),
  sourceAuthority: 'fixture',
  text: 'NON_HADITH_FIXTURE_TRANSLATION_1',
  entryCount: 2,
  texts: [{ languageCode: 'en', title: 'NON_HADITH_FIXTURE_SCIENCE_1', body: 'x' }],
  ...overrides,
});

/** Every read, called with well-formed arguments. */
const READS = [
  ['sourceSystems'],
  ['collections', 0],
  ['collection', ID(2)],
  ['books', ID(2), 0],
  ['books', null, 0],
  ['book', ID(3)],
  ['chapters', ID(3), 0],
  ['chapters', null, 0],
  ['chapter', ID(4)],
  ['records', { collectionId: ID(2), view: 'all' }, 0],
  ['records', { collectionId: null, view: 'conflicted' }, 0],
  ['record', ID(5)],
  ['translations', ID(5)],
  ['commentaries', 0],
  ['commentary', ID(1)],
  ['commentaryEntries', ID(1), 0],
  ['sciences', 0],
  ['science', ID(1)],
] as const;

/** Every layered change, called with well-formed input. */
const WRITES = [
  [
    'saveCollectionNames',
    {
      id: ID(2),
      expectedVersion: 1,
      names: [{ locale: 'en', name: 'Fixture collection A', description: null }],
    },
  ],
  [
    'saveBookNames',
    { id: ID(3), expectedVersion: 1, names: [{ locale: 'ur', name: 'Fixture book A' }] },
  ],
  [
    'saveChapterNames',
    {
      id: ID(4),
      expectedVersion: 1,
      names: [{ locale: 'ar', name: 'Fixture chapter A' }],
    },
  ],
  ['createTranslation', { hadithId: ID(5), value: translationValue() }],
  ['updateTranslation', { id: ID(1), expectedVersion: 3, value: translationValue() }],
  ['setTranslationState', { id: ID(1), expectedVersion: 3, state: 'draft' }],
  ['createCommentary', commentaryValue()],
  ['updateCommentary', { id: ID(1), expectedVersion: 3, value: commentaryValue() }],
  ['setCommentaryState', { id: ID(1), expectedVersion: 3, state: 'archived' }],
  [
    'saveCommentaryEntry',
    {
      id: ID(1),
      expectedVersion: 3,
      value: { hadithId: ID(5), text: 'NON_HADITH_FIXTURE_COMMENTARY_1' },
    },
  ],
  [
    'saveCommentaryEntry',
    { id: ID(1), expectedVersion: 3, value: { hadithId: ID(5), text: null } },
  ],
  ['createScience', scienceValue()],
  ['updateScience', { id: ID(1), expectedVersion: 3, value: scienceValue() }],
  ['setScienceState', { id: ID(1), expectedVersion: 3, state: 'draft' }],
  ['addRecordTopic', { hadithId: ID(5), topicId: ID(9) }],
  ['removeRecordTopic', { hadithId: ID(5), topicId: ID(9) }],
] as const;

type AnyService = Record<string, (...args: unknown[]) => Promise<unknown>>;

const invoke = (service: unknown, method: string, args: readonly unknown[]) =>
  (service as AnyService)[method]!(actor, ...args);

describe('authority — the layered records and the reads', () => {
  it('refuses every read without hadith.read, asking live each time', async () => {
    const { service, calls, asked } = harness({ permissions: [] });
    for (const [method, ...args] of READS)
      expect(await failure(invoke(service, method, args)), method).toBe('denied');
    expect(calls).toEqual([]);
    expect(asked).toHaveLength(READS.length);
    expect(new Set(asked)).toEqual(new Set([`${actor.accountId}:hadith.read`]));
  });

  it('serves every read to a holder of hadith.read', async () => {
    const { service, calls } = harness({ permissions: ['hadith.read'] });
    for (const [method, ...args] of READS)
      expect(await failure(invoke(service, method, args)), method).toBe('accepted');
    expect(calls.map((call) => call.method)).toEqual(READS.map(([method]) => method));
  });

  it('keeps hadith.read read-only: it refuses every change', async () => {
    const { service, calls, asked } = harness({ permissions: ['hadith.read'] });
    for (const [method, input] of WRITES)
      expect(await failure(invoke(service, method, [input])), method).toBe('denied');
    expect(calls).toEqual([]);
    expect(new Set(asked)).toEqual(new Set([`${actor.accountId}:hadith.administer`]));
  });

  it('accepts every layered change from a holder of hadith.administer', async () => {
    const { service, calls } = harness({ permissions: ['hadith.administer'] });
    for (const [method, input] of WRITES)
      expect(await failure(invoke(service, method, [input])), method).toBe('accepted');
    expect(calls.map((call) => call.method)).toEqual(WRITES.map(([method]) => method));
  });

  it('exposes no canonical write on the administrative service', () => {
    const { service } = harness();
    for (const method of [
      'createCollection',
      'createBook',
      'createChapter',
      'createRecord',
      'correctRecord',
      'verifyRecord',
      'setCitation',
      'activate',
      'createSourceSystem',
      'createEdition',
    ])
      expect(method in service, method).toBe(false);
  });

  it('confers nothing through any other key, profile or canonical authority', async () => {
    const { service, calls } = harness({
      permissions: [
        'quran.read',
        'quran.administer',
        'quran.editCanonical',
        'content.read',
        'content.publish',
        'content.administer',
        'library.read',
        'library.administer',
        'media.read',
        'media.administer',
        'people.administer',
        'hadith.editCanonical',
      ],
    });
    for (const [method, ...args] of READS)
      expect(await failure(invoke(service, method, args)), method).toBe('denied');
    for (const [method, input] of WRITES)
      expect(await failure(invoke(service, method, [input])), method).toBe('denied');
    expect(calls).toEqual([]);
  });

  it('re-checks on every call, so a revocation refuses the next one', async () => {
    const { service, permissions } = harness();
    expect(await failure(service.commentaries(actor, 0))).toBe('accepted');
    permissions.delete('hadith.read');
    expect(await failure(service.commentaries(actor, 0))).toBe('denied');
  });

  it('refuses an actor without an account before asking anything', async () => {
    const { service, asked } = harness();
    for (const nobody of [{ accountId: '' }, {}, null, undefined])
      expect(await failure(service.sciences(nobody as unknown as typeof actor, 0))).toBe(
        'denied',
      );
    expect(asked).toEqual([]);
  });
});

describe('input is parsed strictly, before persistence', () => {
  it('refuses unknown fields in the value and in the envelope', async () => {
    const { service, calls } = harness();
    const refusals = [
      service.createTranslation(actor, {
        hadithId: ID(5),
        value: { ...translationValue(), generated: true },
      } as never),
      service.createTranslation(actor, {
        hadithId: ID(5),
        value: translationValue(),
        actorId: ID(99),
      } as never),
      service.updateCommentary(actor, {
        id: ID(1),
        expectedVersion: 3,
        value: commentaryValue(),
        state: 'published',
      } as never),
      service.addRecordTopic(actor, {
        hadithId: ID(5),
        topicId: ID(9),
        text: 'x',
      } as never),
      service.createScience(actor, { ...scienceValue(), html: '<p>' } as never),
    ];
    for (const refusal of refusals) {
      await expect(refusal).rejects.toBeInstanceOf(HadithRefusal);
      expect(await failure(refusal)).toBe('invalid');
    }
    expect(calls).toEqual([]);
  });

  it('refuses malformed identifiers, offsets, filters and versions', async () => {
    const { service, calls } = harness();
    expect(await failure(service.record(actor, 'not-a-uuid'))).toBe('invalid');
    expect(await failure(service.books(actor, 'fixture', 0))).toBe('invalid');
    expect(await failure(service.collections(actor, -1))).toBe('invalid');
    expect(await failure(service.collections(actor, 1.5))).toBe('invalid');
    expect(
      await failure(
        service.records(actor, { collectionId: null, view: 'everything' as never }, 0),
      ),
    ).toBe('invalid');
    expect(
      await failure(
        service.setTranslationState(actor, {
          id: ID(1),
          expectedVersion: 0,
          state: 'draft',
        }),
      ),
    ).toBe('invalid');
    expect(
      await failure(
        service.setTranslationState(actor, {
          id: ID(1),
          expectedVersion: 1,
          state: 'live' as never,
        }),
      ),
    ).toBe('invalid');
    expect(calls).toEqual([]);
  });

  it('refuses text that would need repairing, and never repairs it', async () => {
    const { service, calls } = harness();
    for (const text of [
      ' NON_HADITH_FIXTURE_TRANSLATION_1',
      'NON_HADITH_FIXTURE_TRANSLATION_1\n',
      'NON\u0000HADITH',
      '',
    ])
      expect(
        await failure(
          service.createTranslation(actor, {
            hadithId: ID(5),
            value: translationValue({ text }),
          }),
        ),
        JSON.stringify(text),
      ).toBe('invalid');
    expect(calls).toEqual([]);

    const exact = 'بَ یéé\nNON_HADITH_FIXTURE_TRANSLATION_2';
    await service.createTranslation(actor, {
      hadithId: ID(5),
      value: translationValue({ text: exact }),
    });
    expect(calls[0]?.args[0]).toMatchObject({ value: { text: exact } });
  });

  it('attributes every write to the actor, never to a value the caller sent', async () => {
    const { service, calls } = harness();
    await service.addRecordTopic(actor, { hadithId: ID(5), topicId: ID(9) });
    await service.createCommentary(actor, commentaryValue());
    expect(calls[0]?.args[0]).toEqual({
      actorId: actor.accountId,
      hadithId: ID(5),
      topicId: ID(9),
    });
    expect(calls[1]?.args[0]).toEqual({
      actorId: actor.accountId,
      value: commentaryValue(),
    });
  });
});

describe('publication is checked before the adapter checks it again', () => {
  const publish = { id: ID(1), expectedVersion: 3, state: 'published' } as const;

  it('refuses an absent work first', async () => {
    const { service, calls } = harness({ records: { translation: null } });
    expect(await failure(service.setTranslationState(actor, publish))).toBe('not-found');
    expect(calls.map((call) => call.method)).toEqual(['translation']);
  });

  it('refuses a stale version before anything else about the work', async () => {
    const { service } = harness({
      records: {
        commentary: layerRecord({
          version: 4,
          sourceSystemId: null,
          sourceAuthority: null,
          entryCount: 0,
        }),
      },
    });
    expect(await failure(service.setCommentaryState(actor, publish))).toBe('conflict');
  });

  it('then needs a registered source, before it asks for text', async () => {
    const { service, calls } = harness({
      records: {
        science: layerRecord({ sourceSystemId: null, sourceAuthority: null, texts: [] }),
      },
    });
    expect(await failure(service.setScienceState(actor, publish))).toBe(
      'source-required',
    );
    expect(calls.map((call) => call.method)).toEqual(['science']);
  });

  it('then needs text', async () => {
    const commentary = harness({
      records: { commentary: layerRecord({ entryCount: 0 }) },
    });
    expect(await failure(commentary.service.setCommentaryState(actor, publish))).toBe(
      'text-required',
    );
    const science = harness({ records: { science: layerRecord({ texts: [] }) } });
    expect(await failure(science.service.setScienceState(actor, publish))).toBe(
      'text-required',
    );
    const translation = harness({ records: { translation: layerRecord({ text: '' }) } });
    expect(await failure(translation.service.setTranslationState(actor, publish))).toBe(
      'text-required',
    );
  });

  it('hands a publishable work to the adapter, and checks nothing for a draft', async () => {
    const ready = harness({ records: { translation: layerRecord() } });
    expect(await failure(ready.service.setTranslationState(actor, publish))).toBe(
      'accepted',
    );
    expect(ready.calls.map((call) => call.method)).toEqual([
      'translation',
      'setTranslationState',
    ]);

    const draft = harness({ records: { translation: null } });
    expect(
      await failure(
        draft.service.setTranslationState(actor, { ...publish, state: 'draft' }),
      ),
    ).toBe('accepted');
    expect(draft.calls.map((call) => call.method)).toEqual(['setTranslationState']);
  });
});

describe('adapter refusals', () => {
  it('re-throws a data error as the refusal it names, and an outage unchanged', async () => {
    const named = harness({ throws: { createCommentary: { reason: 'duplicate-slug' } } });
    await expect(
      named.service.createCommentary(actor, commentaryValue()),
    ).rejects.toMatchObject({
      reason: 'duplicate-slug',
    });

    const outage = new Error('synthetic outage');
    const broken = harness({ throws: { sciences: outage } });
    await expect(broken.service.sciences(actor, 0)).rejects.toBe(outage);
    expect(await failure(broken.service.sciences(actor, 0))).toBe('unavailable');

    const unknown = harness({ throws: { sciences: { reason: 'secret-constraint' } } });
    expect(await failure(unknown.service.sciences(actor, 0))).toBe('unavailable');
  });

  it('names categories only', () => {
    expect(HADITH_REFUSAL_REASONS).toContain('citation-conflicted');
    expect(HADITH_REFUSAL_REASONS).toContain('not-verified');
    expect(HADITH_REFUSAL_REASONS).not.toContain('audio-required');
    expect(isHadithRefusalReason('unavailable')).toBe(true);
    expect(isHadithRefusalReason('HadithBook_slug_key')).toBe(false);
  });
});

/* ===========================================================================
 * Canonical — through the REAL Identity verification, over a fake reader
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
  const clock = { grantsExpireAt: Date.now() + 60_000 };
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
            expiresAt: new Date(clock.grantsExpireAt),
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
    clock,
    attempt(permission: string, stepUp: StepUpPurpose) {
      return authorization.requirePrivilegedAction({
        session,
        permission: permission as never,
        stepUp,
      });
    },
    async mint(permission: string, stepUp: StepUpPurpose): Promise<PrivilegedActor> {
      const outcome = await this.attempt(permission, stepUp);
      if (outcome.state !== 'allowed') throw new Error(`not minted: ${outcome.reason}`);
      return outcome.actor;
    },
  };
}

function canonicalHarness(options: {
  readonly identity: ReturnType<typeof identity>;
  readonly throws?: unknown;
}) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const logged: { readonly level: string; readonly detail: HadithCanonicalLogDetail }[] =
    [];
  const answer = async <T>(method: string, input: unknown, result: T): Promise<T> => {
    calls.push({ method, input });
    if (options.throws !== undefined) throw options.throws;
    return result;
  };

  const canonical: HadithCanonicalPort = {
    createCollection: (input) => answer('createCollection', input, { id: ID(501) }),
    createBook: (input) => answer('createBook', input, { id: ID(502) }),
    createChapter: (input) => answer('createChapter', input, { id: ID(503) }),
    createRecord: (input) =>
      answer('createRecord', input, { id: ID(504), version: 1, conflicts: 1 }),
    correctRecord: (input) =>
      answer('correctRecord', input, {
        version: input.value.expectedVersion + 1,
        conflicts: 0,
      }),
    verifyRecord: (input) => answer('verifyRecord', input, undefined),
    setCitation: (input) => answer('setCitation', input, { id: ID(505), version: 1 }),
  };

  const service = createHadithCanonicalService({
    canonical,
    authority: {
      permits: async () => false,
      verifyCanonical: (actor) =>
        options.identity.authorization.verifyPrivilegedActor({
          actor,
          permission: 'hadith.editCanonical',
          stepUp: 'hadith-canonical-edit',
        }),
    },
    log: {
      info: (detail) => logged.push({ level: 'info', detail }),
      warn: (detail) => logged.push({ level: 'warn', detail }),
    },
  });

  return { service, calls, logged };
}

const gradings = [
  {
    grader: 'NON_HADITH_FIXTURE_GRADER_1',
    label: 'NON_HADITH_FIXTURE_GRADING_1',
    labelLanguage: 'ar',
    reference: 'NON_HADITH_FIXTURE_REFERENCE_2',
  },
];

const recordFacts = {
  sourceReference: 'NON_HADITH_FIXTURE_REFERENCE_1',
  citationNumber: 7,
  bookId: ID(11),
  chapterId: ID(12),
  text: 'NON_HADITH_FIXTURE_TEXT_1',
  textLanguage: 'ar',
  chain: 'NON_HADITH_FIXTURE_CHAIN_1',
  chainLanguage: 'ar',
  gradings,
  evidence: 'NON_HADITH_FIXTURE_EVIDENCE_1',
};

/** Every canonical operation, called with well-formed input. */
const CANONICAL = [
  ['createCollection', { slug: 'fixture-collection-a', position: 0 }],
  [
    'createBook',
    {
      editionId: ID(10),
      slug: 'fixture-book-a',
      reference: 'NON_HADITH_FIXTURE_REFERENCE_3',
      position: 1,
      title: null,
      titleLanguage: null,
    },
  ],
  [
    'createChapter',
    {
      bookId: ID(11),
      slug: 'fixture-chapter-a',
      reference: 'NON_HADITH_FIXTURE_REFERENCE_4',
      position: 1,
      title: null,
      titleLanguage: null,
    },
  ],
  ['createRecord', { editionId: ID(10), ...recordFacts }],
  [
    'correctRecord',
    {
      id: ID(504),
      expectedVersion: 1,
      ...recordFacts,
      reason: 'NON_HADITH_FIXTURE_EVIDENCE_2',
    },
  ],
  [
    'verifyRecord',
    { id: ID(504), expectedVersion: 2, evidence: 'NON_HADITH_FIXTURE_EVIDENCE_3' },
  ],
  [
    'setCitation',
    {
      collectionId: ID(13),
      number: 7,
      hadithId: ID(504),
      state: 'mapped',
      expectedVersion: 0,
      evidence: 'NON_HADITH_FIXTURE_EVIDENCE_4',
      reason: null,
    },
  ],
] as const;

/** One canonical operation from the table, called as `who`. */
const perform = (
  service: unknown,
  entry: (typeof CANONICAL)[number],
  who: PrivilegedActor,
) => callCanonical(service, entry[0], who, entry[1]);

const callCanonical = (
  service: unknown,
  method: string,
  who: PrivilegedActor,
  input: unknown,
): Promise<unknown> => (service as AnyService)[method]!(who, input);

async function verifiedActor() {
  const id = identity({
    permissions: ['hadith.editCanonical'],
    grants: ['hadith-canonical-edit'],
  });
  return { id, actor: await id.mint('hadith.editCanonical', 'hadith-canonical-edit') };
}

describe('canonical — only a verified, purpose-bound actor', () => {
  it('hands every operation the verified authority ids and the parsed value', async () => {
    const { id, actor: privileged } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id });

    for (const [method, input] of CANONICAL)
      expect(
        await failure(callCanonical(service, method, privileged, input)),
        method,
      ).toBe('accepted');

    const authority = {
      actorId: privileged.accountId,
      sessionId: privileged.sessionId,
      stepUpGrantId: privileged.stepUpGrantId,
    };
    expect(calls).toEqual(
      CANONICAL.map(([method, value]) => ({ method, input: { authority, value } })),
    );
    expect(privileged.stepUpGrantId.endsWith('05')).toBe(true);
  });

  it('refuses a step-up earned for another purpose — the Quran canonical one included', async () => {
    const id = identity({
      permissions: ['hadith.editCanonical', 'quran.editCanonical', 'role.administer'],
      grants: ['quran-canonical-edit', 'privilege-administration', 'second-factor'],
    });
    const { service, calls, logged } = canonicalHarness({ identity: id });

    const wrong = [
      await id.mint('hadith.editCanonical', 'quran-canonical-edit'),
      await id.mint('hadith.editCanonical', 'privilege-administration'),
      await id.mint('hadith.editCanonical', 'second-factor'),
      await id.mint('quran.editCanonical', 'quran-canonical-edit'),
      await id.mint('role.administer', 'privilege-administration'),
    ];
    for (const who of wrong)
      for (const [method, input] of CANONICAL)
        expect(await failure(callCanonical(service, method, who, input)), method).toBe(
          'denied',
        );
    expect(calls).toEqual([]);
    expect(logged.every((entry) => entry.detail.outcome === 'denied')).toBe(true);
  });

  it('refuses the permission without the step-up', async () => {
    const id = identity({ permissions: ['hadith.editCanonical'], grants: [] });
    const outcome = await id.attempt('hadith.editCanonical', 'hadith-canonical-edit');
    expect(outcome).toMatchObject({ state: 'denied', reason: 'step-up-required' });

    // A hand-built actor claiming what Identity refused to mint is not one.
    const forged = Object.freeze({
      authorisation: 'verified',
      accountId: ID(200),
      sessionId: ID(400),
      permission: 'hadith.editCanonical',
      stepUp: 'hadith-canonical-edit',
      stepUpGrantId: ID(305),
    }) as unknown as PrivilegedActor;
    const { service, calls } = canonicalHarness({ identity: id });
    for (const [method, input] of CANONICAL)
      expect(await failure(callCanonical(service, method, forged, input)), method).toBe(
        'denied',
      );
    expect(calls).toEqual([]);
  });

  it('refuses the step-up without the permission', async () => {
    const id = identity({ permissions: [], grants: ['hadith-canonical-edit'] });
    const outcome = await id.attempt('hadith.editCanonical', 'hadith-canonical-edit');
    expect(outcome).toMatchObject({ state: 'denied', reason: 'no-permission' });

    // And a minted actor whose permission is revoked afterwards is refused too.
    const permissions = ['hadith.editCanonical'];
    const revocable = identity({ permissions, grants: ['hadith-canonical-edit'] });
    const minted = await revocable.mint('hadith.editCanonical', 'hadith-canonical-edit');
    permissions.length = 0;
    const { service, calls } = canonicalHarness({ identity: revocable });
    expect(await failure(perform(service, CANONICAL[3], minted))).toBe('denied');
    expect(calls).toEqual([]);
  });

  it('refuses once the step-up grant has expired', async () => {
    const { id, actor: privileged } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id });
    id.clock.grantsExpireAt = Date.now() - 1;
    for (const [method, input] of CANONICAL)
      expect(
        await failure(callCanonical(service, method, privileged, input)),
        method,
      ).toBe('denied');
    expect(calls).toEqual([]);
  });

  it('refuses a forged copy of a genuine actor, and anything that is not one', async () => {
    const { id, actor: genuine } = await verifiedActor();
    const forged = Object.freeze({ ...genuine }) as PrivilegedActor;
    const { service, calls } = canonicalHarness({ identity: id });
    for (const candidate of [forged, null, undefined, {}])
      for (const [method, input] of CANONICAL)
        expect(
          await failure(
            callCanonical(service, method, candidate as PrivilegedActor, input),
          ),
          method,
        ).toBe('denied');
    expect(calls).toEqual([]);
  });
});

describe('canonical — parsing and refusals', () => {
  it('verifies before it parses: an unverified caller learns nothing of the rules', async () => {
    const id = identity({ permissions: [], grants: [] });
    const { service } = canonicalHarness({ identity: id });
    const nobody = {} as PrivilegedActor;
    expect(await failure(service.createRecord(nobody, { text: '' } as never))).toBe(
      'denied',
    );
  });

  it('refuses malformed input from a verified actor without calling the port', async () => {
    const { id, actor: privileged } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id });
    const refusals = [
      service.createCollection(privileged, { slug: 'search', position: 0 }),
      service.createRecord(privileged, {
        editionId: ID(10),
        ...recordFacts,
        text: 'NON_HADITH_FIXTURE_TEXT_1 ',
      }),
      service.createRecord(privileged, {
        editionId: ID(10),
        ...recordFacts,
        gradings: [...gradings, ...gradings],
      }),
      service.createRecord(privileged, {
        editionId: ID(10),
        ...recordFacts,
        narrators: [],
      } as never),
      service.setCitation(privileged, {
        collectionId: ID(13),
        number: 7,
        hadithId: ID(504),
        state: 'withdrawn',
        expectedVersion: 3,
        evidence: 'NON_HADITH_FIXTURE_EVIDENCE_4',
        reason: null,
      }),
    ];
    for (const refusal of refusals) expect(await failure(refusal)).toBe('invalid');
    expect(calls).toEqual([]);
  });

  it("carries the database's refusal through as its own reason", async () => {
    const { id, actor: privileged } = await verifiedActor();
    for (const reason of [
      'citation-conflicted',
      'not-verified',
      'not-candidate',
      'citation-kept',
      'structure-mismatch',
      'fixture-over-approved',
      'conflict',
    ]) {
      const { service } = canonicalHarness({ identity: id, throws: { reason } });
      expect(await failure(perform(service, CANONICAL[6], privileged))).toBe(reason);
    }
    const outage = new Error('synthetic outage');
    const { service } = canonicalHarness({ identity: id, throws: outage });
    await expect(perform(service, CANONICAL[3], privileged)).rejects.toBe(outage);
  });
});

describe('canonical — the log carries identifiers only', () => {
  it('never logs a word of text, chain, grading, grader, reference, evidence or reason', async () => {
    const { id, actor: privileged } = await verifiedActor();
    const { service, logged } = canonicalHarness({ identity: id });
    for (const [method, input] of CANONICAL)
      await callCanonical(service, method, privileged, input);
    await failure(
      callCanonical(service, 'createRecord', {} as PrivilegedActor, CANONICAL[3][1]),
    );

    expect(logged.filter((entry) => entry.level === 'info')).toHaveLength(
      CANONICAL.length,
    );
    const serialised = JSON.stringify(logged);
    expect(serialised).not.toMatch(/NON_HADITH_FIXTURE/u);
    expect(serialised).not.toContain('fixture-collection-a');
    const allowed = new Set([
      'operation',
      'outcome',
      'actorId',
      'id',
      'collectionId',
      'number',
      'version',
      'conflicts',
    ]);
    for (const entry of logged)
      for (const [key, value] of Object.entries(entry.detail)) {
        expect(allowed.has(key), key).toBe(true);
        expect(['string', 'number'], key).toContain(typeof value);
      }
  });

  it('records the outcome of a record write as identifiers and counts', async () => {
    const { id, actor: privileged } = await verifiedActor();
    const { service, logged } = canonicalHarness({ identity: id });
    await service.createRecord(privileged, { editionId: ID(10), ...recordFacts });
    expect(logged).toEqual([
      {
        level: 'info',
        detail: {
          operation: 'hadith.record.create',
          outcome: 'passed',
          actorId: privileged.accountId,
          id: ID(504),
          version: 1,
          conflicts: 1,
        },
      },
    ]);
  });
});
