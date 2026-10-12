import { describe, expect, it } from 'vitest';

import type {
  AuthorizationReaderPort,
  PrivilegedActor,
  ResolvedSession,
  StepUpPurpose,
} from '../../packages/contracts/src/identity/index.ts';
import type {
  AssetAccessRequest,
  StorageServicePort,
  StoredAsset,
} from '../../packages/contracts/src/platform/index.ts';
import type {
  CandidateAyah,
  QuranCanonicalPort,
  QuranPersistencePort,
  RecitationDetail,
} from '../../packages/contracts/src/quran/index.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  QuranRefusal,
  createQuranCanonicalService,
  createQuranService,
  createRecitationAssetPolicy,
  createRecitationPreviewPolicy,
  createRecitationUpload,
  quranFailure,
  type CanonicalLogDetail,
} from '../../apps/web/src/contexts/quran/index.ts';

/**
 * Phase 18 — the Quran services' rules, over fake ports.
 *
 * WHAT IS PROVED HERE, CHEAPLY: every read requires `quran.read` and every
 * change `quran.administer`, asked of the authority LIVE on every call; no
 * other key — `content.*`, `library.*`, `media.*`, even `quran.editCanonical` —
 * confers either; input is refused by strict schemas before persistence is
 * reached; the canonical service accepts only an actor Identity minted for
 * exactly `quran.editCanonical` and `quran-canonical-edit`, records a failed
 * verification without writing, and passes the verified authority ids on
 * success; and the recitation upload stores nothing it would not record.
 *
 * Every string is a synthetic sentinel. No scripture appears anywhere.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEUTRAL = 'نص اختبار غير قرآني';
const sentinel = (surah: number, ayah: number) =>
  `NON_QURAN_FIXTURE_CANONICAL_${surah}_${ayah} ${NEUTRAL}`;

const actor = { accountId: ID(100) };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return quranFailure(error);
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
  const permissions = new Set(options.permissions ?? ['quran.read', 'quran.administer']);
  const asked: string[] = [];

  const persistence = new Proxy({} as QuranPersistencePort, {
    get(_target, method: string) {
      return async (...args: unknown[]) => {
        calls.push({ method, args });
        if (options.throws && method in options.throws) throw options.throws[method];
        if (options.records && method in options.records) return options.records[method];
        return { saved: method };
      };
    },
  });

  const service = createQuranService({
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
  slug: 'non-quran-fixture-translation',
  name: 'NON_QURAN_FIXTURE translation',
  description: null,
  attribution: null,
  languageCode: 'en',
  sourceId: ID(7),
  contributors: [],
  ...overrides,
});

const layerRecord = (overrides: Record<string, unknown> = {}) => ({
  id: ID(1),
  version: 3,
  sourceId: ID(7),
  sourceAuthority: 'fixture',
  textCount: 2,
  ...overrides,
});

/** Every read, called with well-formed arguments. */
const READS = [
  ['corpusStatus'],
  ['source', ID(7)],
  ['sourceText', ID(7), { surah: 2, ayah: 3 }],
  ['surahs'],
  ['surahAyat', 2, 0],
  ['ayah', { surah: 2, ayah: 3 }],
  ['correctionPreview', { surah: 2, ayah: 3 }, ID(7)],
  ['translations', 0],
  ['translation', ID(1)],
  ['translationTexts', ID(1), 2],
  ['transliterations', 0],
  ['transliteration', ID(1)],
  ['transliterationTexts', ID(1), 2],
  ['tafsirs', 0],
  ['tafsir', ID(1)],
  ['tafsirEntries', ID(1), 2],
  ['recitations', 0],
  ['recitation', ID(1)],
  ['tajweedRules'],
  ['tajweedRule', ID(1)],
] as const;

/** Every change, called with well-formed input. */
const WRITES = [
  ['saveSurahNames', { expectedVersion: 1, value: { surah: 2, names: [] } }],
  ['addAyahTopic', { ref: { surah: 2, ayah: 3 }, topicId: ID(9) }],
  ['removeAyahTopic', { ref: { surah: 2, ayah: 3 }, topicId: ID(9) }],
  ['createTranslation', { value: translationValue() }],
  ['updateTranslation', { id: ID(1), expectedVersion: 3, value: translationValue() }],
  ['setTranslationState', { id: ID(1), expectedVersion: 3, state: 'draft' }],
  [
    'saveTranslationTexts',
    {
      id: ID(1),
      expectedVersion: 3,
      surah: 2,
      changes: [{ ayah: 3, text: 'NON_QURAN_FIXTURE translation text' }],
    },
  ],
  [
    'createTransliteration',
    {
      value: {
        slug: 'non-quran-fixture-transliteration',
        name: 'NON_QURAN_FIXTURE transliteration',
        description: null,
        attribution: null,
        languageCode: 'en',
        sourceId: null,
        scheme: null,
      },
    },
  ],
  ['setTransliterationState', { id: ID(1), expectedVersion: 3, state: 'archived' }],
  [
    'saveTransliterationTexts',
    { id: ID(1), expectedVersion: 3, surah: 2, changes: [{ ayah: 3, text: null }] },
  ],
  ['createTafsir', { value: translationValue() }],
  ['setTafsirState', { id: ID(1), expectedVersion: 3, state: 'draft' }],
  [
    'saveTafsirEntry',
    {
      id: ID(1),
      expectedVersion: 3,
      entryId: null,
      value: { surah: 2, startAyah: 1, endAyah: 3, text: 'NON_QURAN_FIXTURE tafsir' },
    },
  ],
  ['removeTafsirEntry', { id: ID(1), expectedVersion: 3, entryId: ID(2) }],
  [
    'createRecitation',
    {
      value: {
        slug: 'fixture-reciter-one',
        name: 'Fixture Reciter One',
        reciterId: ID(8),
        style: null,
        attribution: null,
        sourceId: null,
      },
    },
  ],
  ['setRecitationState', { id: ID(1), expectedVersion: 3, state: 'draft' }],
  [
    'addRecitationSegment',
    { id: ID(1), expectedVersion: 3, value: { surah: 2, startAyah: 1, endAyah: 2 } },
  ],
  ['removeRecitationSegment', { id: ID(1), expectedVersion: 3, segmentId: ID(2) }],
  [
    'createTajweedRule',
    {
      value: {
        slug: 'fixture-rule',
        position: 0,
        attribution: null,
        sourceId: null,
        texts: [{ languageCode: 'en', title: 'Fixture rule', body: 'NON_QURAN_FIXTURE' }],
      },
    },
  ],
  ['setTajweedRuleState', { id: ID(1), expectedVersion: 3, state: 'draft' }],
] as const;

type AnyService = Record<string, (...args: unknown[]) => Promise<unknown>>;

const invoke = (service: unknown, method: string, args: readonly unknown[]) =>
  (service as AnyService)[method]!(actor, ...args);

describe('authority — the layered works and the reads', () => {
  it('refuses every read without quran.read, asking live each time', async () => {
    const { service, calls, asked } = harness({ permissions: [] });
    for (const [method, ...args] of READS)
      expect(await failure(invoke(service, method, args)), method).toBe('denied');
    expect(calls).toEqual([]);
    expect(asked).toHaveLength(READS.length);
    expect(new Set(asked)).toEqual(new Set([`${actor.accountId}:quran.read`]));
  });

  it('serves every read to a holder of quran.read', async () => {
    const { service, calls } = harness({ permissions: ['quran.read'] });
    for (const [method, ...args] of READS)
      expect(await failure(invoke(service, method, args)), method).toBe('accepted');
    expect(calls.map((call) => call.method)).toEqual(READS.map(([method]) => method));
  });

  it('refuses every change to a holder of quran.read alone', async () => {
    const { service, calls, asked } = harness({ permissions: ['quran.read'] });
    for (const [method, input] of WRITES)
      expect(await failure(invoke(service, method, [input])), method).toBe('denied');
    expect(calls).toEqual([]);
    expect(new Set(asked)).toEqual(new Set([`${actor.accountId}:quran.administer`]));
  });

  it('accepts every change from a holder of quran.administer', async () => {
    const { service } = harness({ permissions: ['quran.administer'] });
    for (const [method, input] of WRITES)
      expect(await failure(invoke(service, method, [input])), method).toBe('accepted');
  });

  it('confers nothing through any other key, profile or canonical authority', async () => {
    const { service, calls } = harness({
      permissions: [
        'content.read',
        'content.publish',
        'content.administer',
        'library.read',
        'library.administer',
        'media.read',
        'media.administer',
        'people.administer',
        'quran.editCanonical',
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
    expect(await failure(service.translations(actor, 0))).toBe('accepted');
    permissions.delete('quran.read');
    expect(await failure(service.translations(actor, 0))).toBe('denied');
  });

  it('refuses an actor without an account before asking anything', async () => {
    const { service, asked } = harness();
    for (const nobody of [{ accountId: '' }, {}, null, undefined])
      expect(
        await failure(service.translations(nobody as unknown as typeof actor, 0)),
      ).toBe('denied');
    expect(asked).toEqual([]);
  });
});

describe('input is parsed strictly, before persistence', () => {
  it('refuses unknown fields in the value and in the envelope', async () => {
    const { service, calls } = harness();
    const refusals = [
      service.createTranslation(actor, {
        value: { ...translationValue(), isCanonical: true },
      } as never),
      service.createTranslation(actor, {
        value: translationValue(),
        actorId: ID(99),
      } as never),
      service.updateTranslation(actor, {
        id: ID(1),
        expectedVersion: 3,
        value: translationValue(),
        state: 'published',
      } as never),
      service.addAyahTopic(actor, {
        ref: { surah: 2, ayah: 3, text: 'x' },
        topicId: ID(9),
      } as never),
    ];
    for (const refusal of refusals) {
      await expect(refusal).rejects.toBeInstanceOf(QuranRefusal);
      expect(await failure(refusal)).toBe('invalid');
    }
    expect(calls).toEqual([]);
  });

  it('refuses malformed identifiers, numbers and versions', async () => {
    const { service, calls } = harness();
    expect(await failure(service.translation(actor, 'not-a-uuid'))).toBe('invalid');
    expect(await failure(service.surahAyat(actor, 0, 0))).toBe('invalid');
    expect(await failure(service.surahAyat(actor, 115, 0))).toBe('invalid');
    expect(await failure(service.ayah(actor, { surah: 2, ayah: 0 }))).toBe('invalid');
    expect(await failure(service.translations(actor, -1))).toBe('invalid');
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

  it('refuses religious text that would need repairing, and never repairs it', async () => {
    const { service, calls } = harness();
    for (const text of [
      ' NON_QURAN_FIXTURE',
      'NON_QURAN_FIXTURE\n',
      'NON\u0000QURAN',
      '',
    ]) {
      expect(
        await failure(
          service.saveTranslationTexts(actor, {
            id: ID(1),
            expectedVersion: 3,
            surah: 2,
            changes: [{ ayah: 3, text }],
          }),
        ),
        JSON.stringify(text),
      ).toBe('invalid');
    }
    expect(calls).toEqual([]);

    const exact = `بَ یéé`;
    await service.saveTranslationTexts(actor, {
      id: ID(1),
      expectedVersion: 3,
      surah: 2,
      changes: [{ ayah: 3, text: exact }],
    });
    expect(calls[0]?.args[0]).toMatchObject({ changes: [{ ayah: 3, text: exact }] });
  });

  it('attributes every write to the actor, never to a value the caller sent', async () => {
    const { service, calls } = harness();
    await service.addAyahTopic(actor, { ref: { surah: 2, ayah: 3 }, topicId: ID(9) });
    expect(calls[0]?.args[0]).toEqual({
      actorId: actor.accountId,
      ref: { surah: 2, ayah: 3 },
      topicId: ID(9),
    });
  });

  it('refuses an Ayah changed twice in one save', async () => {
    const { service } = harness();
    expect(
      await failure(
        service.saveTranslationTexts(actor, {
          id: ID(1),
          expectedVersion: 3,
          surah: 2,
          changes: [
            { ayah: 3, text: 'NON_QURAN_FIXTURE_A' },
            { ayah: 3, text: 'NON_QURAN_FIXTURE_B' },
          ],
        }),
      ),
    ).toBe('invalid');
  });
});

describe('publication is checked before the adapter checks it again', () => {
  const publish = { id: ID(1), expectedVersion: 3, state: 'published' } as const;

  it('needs a registered source', async () => {
    const { service, calls } = harness({
      records: { translation: layerRecord({ sourceId: null, sourceAuthority: null }) },
    });
    expect(await failure(service.setTranslationState(actor, publish))).toBe(
      'source-required',
    );
    expect(calls.map((call) => call.method)).toEqual(['translation']);
  });

  it('needs text', async () => {
    const { service } = harness({ records: { tafsir: layerRecord({ textCount: 0 }) } });
    expect(await failure(service.setTafsirState(actor, publish))).toBe('text-required');
  });

  it('needs audio on at least one segment of a recitation', async () => {
    const silent = harness({
      records: {
        recitation: layerRecord({ segments: [{ id: ID(2), assetId: null }] }),
      },
    });
    expect(await failure(silent.service.setRecitationState(actor, publish))).toBe(
      'audio-required',
    );
    const heard = harness({
      records: {
        recitation: layerRecord({ segments: [{ id: ID(2), assetId: ID(3) }] }),
      },
    });
    expect(await failure(heard.service.setRecitationState(actor, publish))).toBe(
      'accepted',
    );
  });

  it('refuses a stale version and an absent work', async () => {
    const stale = harness({ records: { translation: layerRecord({ version: 4 }) } });
    expect(await failure(stale.service.setTranslationState(actor, publish))).toBe(
      'conflict',
    );
    const absent = harness({ records: { transliteration: null } });
    expect(await failure(absent.service.setTransliterationState(actor, publish))).toBe(
      'not-found',
    );
  });
});

describe('adapter refusals', () => {
  it('re-throws a data error as the refusal it names, and an outage unchanged', async () => {
    const named = harness({
      throws: { createTranslation: { reason: 'duplicate-slug' } },
    });
    await expect(
      named.service.createTranslation(actor, { value: translationValue() }),
    ).rejects.toMatchObject({ reason: 'duplicate-slug' });

    const outage = new Error('synthetic outage');
    const broken = harness({ throws: { translations: outage } });
    await expect(broken.service.translations(actor, 0)).rejects.toBe(outage);
    expect(await failure(broken.service.translations(actor, 0))).toBe('unavailable');

    const unknown = harness({
      throws: { translations: { reason: 'secret-constraint' } },
    });
    expect(await failure(unknown.service.translations(actor, 0))).toBe('unavailable');
  });
});

/* ===========================================================================
 * Canonical — through the REAL Identity verification, over a fake reader
 * ========================================================================= */

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
    async mint(
      permission: 'quran.editCanonical' | 'role.administer',
      stepUp: StepUpPurpose,
    ) {
      const outcome = await authorization.requirePrivilegedAction({
        session,
        permission: permission as never,
        stepUp,
      });
      if (outcome.state !== 'allowed') throw new Error(`not minted: ${outcome.reason}`);
      return outcome.actor;
    },
  };
}

const STEP_UP_IDS: Record<StepUpPurpose, number> = {
  'privilege-administration': 1,
  'account-administration': 2,
  'second-factor': 3,
  'quran-canonical-edit': 4,
  'hadith-canonical-edit': 5,
};

function canonicalHarness(options: {
  readonly identity: ReturnType<typeof identity>;
  readonly reference?: readonly CandidateAyah[];
  readonly sourceText?: string | null;
  readonly source?: boolean;
  readonly acceptThrows?: unknown;
}) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const logged: { readonly level: string; readonly detail: CanonicalLogDetail }[] = [];

  const canonical: QuranCanonicalPort = {
    async sourceCorpus(sourceId) {
      calls.push({ method: 'sourceCorpus', input: sourceId });
      return options.reference ?? [];
    },
    async acceptCorpus(input) {
      calls.push({ method: 'acceptCorpus', input });
      if (options.acceptThrows !== undefined) throw options.acceptThrows;
      return { runId: ID(500), ayat: input.candidate.length };
    },
    async correctAyah(input) {
      calls.push({ method: 'correctAyah', input });
      return { runId: ID(501), version: input.expectedVersion + 1 };
    },
    async recordFailure(input) {
      calls.push({ method: 'recordFailure', input });
      return { runId: ID(502) };
    },
  };

  const persistence = {
    async source(id: string) {
      calls.push({ method: 'source', input: id });
      return options.source === false ? null : { id };
    },
    async sourceText(sourceId: string, ref: unknown) {
      calls.push({ method: 'sourceText', input: { sourceId, ref } });
      return options.sourceText === undefined ? sentinel(2, 3) : options.sourceText;
    },
  } as unknown as QuranPersistencePort;

  const service = createQuranCanonicalService({
    canonical,
    persistence,
    authority: {
      permits: async () => false,
      verifyCanonical: (actor) =>
        options.identity.authorization.verifyPrivilegedActor({
          actor,
          permission: 'quran.editCanonical',
          stepUp: 'quran-canonical-edit',
        }),
    },
    log: {
      info: (detail) => logged.push({ level: 'info', detail }),
      warn: (detail) => logged.push({ level: 'warn', detail }),
    },
  });

  return { service, calls, logged };
}

const corpus = [
  { surah: 1, ayah: 1, juz: 1, text: sentinel(1, 1) },
  { surah: 1, ayah: 2, juz: 1, text: sentinel(1, 2) },
] satisfies CandidateAyah[];

const correction = {
  surah: 2,
  ayah: 3,
  expectedVersion: 1,
  sourceId: ID(7),
  reviewedText: sentinel(2, 3),
  reason: 'NON_QURAN_FIXTURE correction reason',
};

describe('canonical — only a verified, purpose-bound actor', () => {
  it('accepts a minted quran.editCanonical actor with the canonical purpose', async () => {
    const id = identity({
      permissions: ['quran.editCanonical'],
      grants: ['quran-canonical-edit'],
    });
    const actor = await id.mint('quran.editCanonical', 'quran-canonical-edit');
    const { service, calls } = canonicalHarness({ identity: id, reference: corpus });

    const outcome = await service.acceptCorpus(actor, {
      sourceId: ID(7),
      candidate: corpus,
    });
    expect(outcome).toEqual({ ok: true, runId: ID(500), ayat: 2 });
    const accept = calls.find((call) => call.method === 'acceptCorpus');
    expect(accept?.input).toEqual({
      authority: {
        actorId: actor.accountId,
        sessionId: actor.sessionId,
        stepUpGrantId: actor.stepUpGrantId,
      },
      sourceId: ID(7),
      candidate: corpus,
    });
  });

  it('refuses a forged copy of a genuine actor', async () => {
    const id = identity({
      permissions: ['quran.editCanonical'],
      grants: ['quran-canonical-edit'],
    });
    const genuine = await id.mint('quran.editCanonical', 'quran-canonical-edit');
    const forged = Object.freeze({ ...genuine }) as PrivilegedActor;
    const { service, calls, logged } = canonicalHarness({
      identity: id,
      reference: corpus,
    });

    for (const candidate of [forged, null, undefined, {}]) {
      expect(
        await failure(
          service.acceptCorpus(candidate as PrivilegedActor, {
            sourceId: ID(7),
            candidate: corpus,
          }),
        ),
      ).toBe('denied');
      expect(
        await failure(service.correctAyah(candidate as PrivilegedActor, correction)),
      ).toBe('denied');
    }
    expect(calls).toEqual([]);
    expect(logged.every((entry) => entry.detail.outcome === 'denied')).toBe(true);
  });

  it('refuses an actor minted for another permission or purpose', async () => {
    const privilege = identity({
      permissions: ['role.administer', 'quran.editCanonical'],
      grants: ['privilege-administration', 'second-factor'],
    });
    const { service, calls } = canonicalHarness({
      identity: privilege,
      reference: corpus,
    });

    const wrongPermission = await privilege.mint(
      'role.administer',
      'privilege-administration',
    );
    const wrongPurpose = await privilege.mint('quran.editCanonical', 'second-factor');
    for (const actor of [wrongPermission, wrongPurpose]) {
      expect(
        await failure(
          service.acceptCorpus(actor, { sourceId: ID(7), candidate: corpus }),
        ),
      ).toBe('denied');
      expect(await failure(service.correctAyah(actor, correction))).toBe('denied');
    }
    expect(calls).toEqual([]);
  });

  it('refuses once the permission is revoked, even for a minted actor', async () => {
    const permissions = ['quran.editCanonical'];
    const id = identity({ permissions, grants: ['quran-canonical-edit'] });
    const actor = await id.mint('quran.editCanonical', 'quran-canonical-edit');
    permissions.length = 0;
    const { service, calls } = canonicalHarness({ identity: id, reference: corpus });
    expect(await failure(service.correctAyah(actor, correction))).toBe('denied');
    expect(calls).toEqual([]);
  });
});

describe('canonical — verification before any write', () => {
  async function verifiedActor() {
    const id = identity({
      permissions: ['quran.editCanonical'],
      grants: ['quran-canonical-edit'],
    });
    return { id, actor: await id.mint('quran.editCanonical', 'quran-canonical-edit') };
  }

  it('records a corpus mismatch and never calls acceptCorpus', async () => {
    const { id, actor } = await verifiedActor();
    const { service, calls, logged } = canonicalHarness({
      identity: id,
      reference: corpus,
    });
    const candidate = [corpus[0]!, { ...corpus[1]!, text: `${corpus[1]!.text}َ` }];

    const outcome = await service.acceptCorpus(actor, { sourceId: ID(7), candidate });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.runId).toBe(ID(502));
    expect(outcome.report.mismatches).toEqual([
      {
        reason: 'text-mismatch',
        ref: { surah: 1, ayah: 2 },
        offset: [...corpus[1]!.text].length,
      },
    ]);
    expect(calls.map((call) => call.method)).toEqual([
      'source',
      'sourceCorpus',
      'recordFailure',
    ]);
    expect(calls[2]?.input).toEqual({
      actorId: actor.accountId,
      kind: 'corpus-acceptance',
      sourceId: ID(7),
      checked: 2,
      mismatches: 1,
      first: outcome.report.mismatches[0],
    });

    const evidence = JSON.stringify([outcome, logged, calls[2]]);
    expect(evidence).not.toContain('NON_QURAN_FIXTURE');
    expect(evidence).not.toContain(NEUTRAL);
  });

  it('records a correction that differs from the source and never calls correctAyah', async () => {
    const { id, actor } = await verifiedActor();
    const { service, calls } = canonicalHarness({
      identity: id,
      sourceText: `${sentinel(2, 3)}ی`,
    });
    const outcome = await service.correctAyah(actor, correction);
    expect(outcome).toEqual({
      ok: false,
      runId: ID(502),
      report: {
        passed: false,
        checked: 1,
        mismatchCount: 1,
        mismatches: [
          {
            reason: 'text-mismatch',
            ref: { surah: 2, ayah: 3 },
            offset: [...sentinel(2, 3)].length,
          },
        ],
      },
    });
    expect(calls.some((call) => call.method === 'correctAyah')).toBe(false);
    expect(calls.find((call) => call.method === 'recordFailure')?.input).toMatchObject({
      kind: 'ayah-correction',
      checked: 1,
      mismatches: 1,
    });
  });

  it('records a correction against a source that lacks the Ayah', async () => {
    const { id, actor } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id, sourceText: null });
    const outcome = await service.correctAyah(actor, correction);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.report.mismatches[0]?.reason).toBe('unknown-reference');
    expect(calls.some((call) => call.method === 'correctAyah')).toBe(false);
  });

  it('passes the verified authority ids to a matching correction', async () => {
    const { id, actor } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id });
    expect(await service.correctAyah(actor, correction)).toEqual({
      ok: true,
      runId: ID(501),
      version: 2,
    });
    expect(calls.find((call) => call.method === 'correctAyah')?.input).toEqual({
      authority: {
        actorId: actor.accountId,
        sessionId: actor.sessionId,
        stepUpGrantId: actor.stepUpGrantId,
      },
      ref: { surah: 2, ayah: 3 },
      expectedVersion: 1,
      sourceId: ID(7),
      reviewedText: sentinel(2, 3),
      reason: correction.reason,
    });
    expect(calls.some((call) => call.method === 'recordFailure')).toBe(false);
  });

  it('refuses an unregistered source without recording or writing', async () => {
    const { id, actor } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id, source: false });
    expect(await failure(service.correctAyah(actor, correction))).toBe('not-found');
    expect(
      await failure(service.acceptCorpus(actor, { sourceId: ID(7), candidate: corpus })),
    ).toBe('not-found');
    expect(calls.map((call) => call.method)).toEqual(['source', 'source']);
  });

  it('refuses unknown fields after verifying the actor', async () => {
    const { id, actor } = await verifiedActor();
    const { service, calls } = canonicalHarness({ identity: id });
    expect(
      await failure(
        service.correctAyah(actor, { ...correction, normalise: true } as never),
      ),
    ).toBe('invalid');
    expect(
      await failure(
        service.acceptCorpus(actor, {
          sourceId: ID(7),
          candidate: [{ ...corpus[0]!, note: 'x' }],
        } as never),
      ),
    ).toBe('invalid');
    expect(calls).toEqual([]);
  });

  it('maps the procedure refusal to its reason', async () => {
    const { id, actor } = await verifiedActor();
    const { service } = canonicalHarness({
      identity: id,
      reference: corpus,
      acceptThrows: { reason: 'corpus-exists' },
    });
    await expect(
      service.acceptCorpus(actor, { sourceId: ID(7), candidate: corpus }),
    ).rejects.toMatchObject({ reason: 'corpus-exists' });
  });
});

/* ===========================================================================
 * Recitation upload and serving policies
 * ========================================================================= */

const recitation = (overrides: Partial<RecitationDetail> = {}) =>
  ({
    id: ID(1),
    version: 3,
    segments: [{ id: ID(2), surah: 2, startAyah: 1, endAyah: 3, assetId: null }],
    ...overrides,
  }) as RecitationDetail;

/** A synthetic body: one chunk of non-audio bytes. The fake Storage never reads it. */
async function* bytes(): AsyncIterable<Uint8Array> {
  yield new Uint8Array([0x4e, 0x51]);
}

function uploadHarness(options: {
  readonly permissions?: readonly string[];
  readonly current?: RecitationDetail | null;
  readonly stored?: Partial<StoredAsset>;
}) {
  const calls: string[] = [];
  const policies: unknown[] = [];
  const persistence = {
    async recitation() {
      calls.push('recitation');
      return options.current === undefined ? recitation() : options.current;
    },
    async attachSegmentAsset(input: unknown) {
      calls.push('attachSegmentAsset');
      policies.push(input);
      return recitation({ version: 4 });
    },
  } as unknown as QuranPersistencePort;
  const storage = {
    async store(_bytes: unknown, policy: unknown) {
      calls.push('store');
      policies.push(policy);
      return {
        id: ID(3),
        state: 'clean',
        rejection: null,
        mediaType: 'audio/mpeg',
        byteSize: 1,
        checksum: 'x',
        ...options.stored,
      };
    },
  } as unknown as StorageServicePort;
  const permissions = new Set(options.permissions ?? ['quran.administer']);
  const upload = createRecitationUpload({
    persistence,
    authority: {
      permits: async (_id, key) => permissions.has(key),
      verifyCanonical: async () => false,
    },
    storage: async () => storage,
  });
  const send = () =>
    upload.uploadSegmentAudio(actor, ID(1), ID(2), 3, bytes(), {
      declaredMediaType: 'audio/mpeg',
      displayName: 'fixture.mp3',
    });
  return { send, calls, policies };
}

describe('recitation upload', () => {
  it('refuses before reading or storing without a live quran.administer', async () => {
    for (const permissions of [[], ['quran.read'], ['media.administer']]) {
      const { send, calls } = uploadHarness({ permissions });
      expect(await failure(send())).toBe('denied');
      expect(calls).toEqual([]);
    }
  });

  it('checks the recitation, its version and the segment before storing a byte', async () => {
    expect(await failure(uploadHarness({ current: null }).send())).toBe('not-found');
    const stale = uploadHarness({ current: recitation({ version: 2 }) });
    expect(await failure(stale.send())).toBe('conflict');
    expect(stale.calls).toEqual(['recitation']);
    const other = uploadHarness({ current: recitation({ segments: [] }) });
    expect(await failure(other.send())).toBe('not-found');
    expect(other.calls).toEqual(['recitation']);
  });

  it("asks Storage with Quran's own audio policy and records only a clean asset", async () => {
    const { send, calls, policies } = uploadHarness({});
    expect(await failure(send())).toBe('accepted');
    expect(calls).toEqual(['recitation', 'store', 'attachSegmentAsset']);
    expect(policies[0]).toMatchObject({
      allowedMediaTypes: ['audio/mpeg'],
      maxBytes: 64 * 1024 * 1024,
    });
    expect(policies[1]).toEqual({
      actorId: actor.accountId,
      id: ID(1),
      expectedVersion: 3,
      segmentId: ID(2),
      assetId: ID(3),
    });
  });

  it('maps Storage refusals and never records an uncleared file', async () => {
    const cases = [
      [{ state: 'quarantined' }, 'not-cleared'],
      [{ state: 'rejected', rejection: 'infected' }, 'infected'],
      [{ state: 'rejected', rejection: 'unscannable' }, 'not-cleared'],
      [{ state: 'rejected', rejection: 'too-large' }, 'too-large'],
      [{ state: 'rejected', rejection: 'detected-type-not-allowed' }, 'type-not-allowed'],
    ] as const;
    for (const [stored, reason] of cases) {
      const { send, calls } = uploadHarness({ stored: stored as Partial<StoredAsset> });
      expect(await failure(send()), reason).toBe(reason);
      expect(calls).not.toContain('attachSegmentAsset');
    }
  });
});

describe('recitation serving policies', () => {
  const request = { recitationId: ID(1), segmentId: ID(2), assetId: ID(3) };
  const asset = (overrides: Partial<AssetAccessRequest> = {}): AssetAccessRequest => ({
    assetId: ID(3),
    mediaType: 'audio/mpeg',
    byteSize: 1,
    checksum: 'x',
    ...overrides,
  });

  it('serves publicly only the recorded asset of a publicly visible recitation', async () => {
    const policy = (relation: unknown, req = request) =>
      createRecitationAssetPolicy({
        reader: { segmentAsset: async () => relation as never },
        request: req,
      });
    const visible = {
      recitationState: 'published',
      publiclyVisible: true,
      assetId: ID(3),
    };
    expect(await policy(visible).decide(asset())).toBe('allow');
    expect(await policy({ ...visible, publiclyVisible: false }).decide(asset())).toBe(
      'deny',
    );
    expect(await policy({ ...visible, assetId: ID(4) }).decide(asset())).toBe('deny');
    expect(await policy(null).decide(asset())).toBe('deny');
    expect(await policy(visible).decide(asset({ assetId: ID(4) }))).toBe('deny');
    expect(await policy(visible).decide(asset({ mediaType: 'application/pdf' }))).toBe(
      'deny',
    );
    expect(
      await policy(visible, { ...request, segmentId: 'not-a-uuid' }).decide(asset()),
    ).toBe('deny');
  });

  it('previews only the recorded asset, to a live quran.read', async () => {
    const policy = (recorded: string | null, permissions: readonly string[]) =>
      createRecitationPreviewPolicy({
        persistence: { segmentAssetForPreview: async () => recorded },
        authority: {
          permits: async (_id, key) => permissions.includes(key),
          verifyCanonical: async () => false,
        },
        accountId: actor.accountId,
        request,
      });
    expect(await policy(ID(3), ['quran.read']).decide(asset())).toBe('allow');
    expect(await policy(ID(3), ['media.administer']).decide(asset())).toBe('deny');
    expect(await policy(ID(4), ['quran.read']).decide(asset())).toBe('deny');
    expect(await policy(null, ['quran.read']).decide(asset())).toBe('deny');
  });
});
