import { describe, expect, it } from 'vitest';

import {
  createMigrationDecisionService,
  migrationFailure,
  MigrationRefusal,
  type MigrationRefusalReason,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import {
  MIGRATION_LIMITS,
  rightsBatchSchema,
  type MigrationDecisionPort,
} from '../../packages/contracts/src/migration/index.ts';
import { ADMIN, FakeAuthority, FakeStore, FakeTopics, NOBODY, READER } from './fakes.ts';

/**
 * Phase 30-R. ONE REVIEWER, A BOUNDED SELECTION OF ACQUISITIONS
 * (rightsBatchSchema): each cleared for release — owned or licensed,
 * `public-eligible` — with the evidence and holder the reviewer states,
 * decided on its own exactly as a single rights decision, refused for itself
 * alone, and an outage stops the batch.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

type RightsCall = Parameters<MigrationDecisionPort['decideRights']>[0];

function world(options: { readonly refuse?: ReadonlyMap<string, Error> } = {}) {
  const store = new FakeStore();
  const calls: RightsCall[] = [];
  const decisions = createMigrationDecisionService({
    decisions: {
      ...store.decisionPort,
      decideRights: async (input) => {
        calls.push(input);
        const failure = options.refuse?.get(input.provenanceId);
        if (failure !== undefined) throw failure;
      },
    },
    read: store.readPort,
    topics: new FakeTopics(),
    authority: new FakeAuthority(),
    clock: () => new Date('2026-10-30T10:00:00Z'),
  });
  return { decisions, calls };
}

const batch = (count: number, overrides: Record<string, unknown> = {}) => ({
  items: Array.from({ length: count }, (_, n) => ({
    provenanceId: ID(n + 1),
    expectedVersion: 1,
  })),
  licence: 'organisation-owned',
  licenceEvidence: 'Reviewed against the official source page and its notice.',
  rightsHolder: 'Minhaj-ul-Quran International',
  ...overrides,
});

describe('rightsBatchSchema', () => {
  it('admits one page of unique acquisitions, owned or licensed, with evidence', () => {
    expect(rightsBatchSchema.safeParse(batch(1)).success).toBe(true);
    expect(rightsBatchSchema.safeParse(batch(MIGRATION_LIMITS.page)).success).toBe(true);
    expect(rightsBatchSchema.safeParse(batch(2, { licence: 'licensed' })).success).toBe(
      true,
    );
  });

  it('refuses an empty, oversized or repeated selection', () => {
    expect(rightsBatchSchema.safeParse(batch(0)).success).toBe(false);
    expect(rightsBatchSchema.safeParse(batch(MIGRATION_LIMITS.page + 1)).success).toBe(
      false,
    );
    const twice = batch(1);
    expect(
      rightsBatchSchema.safeParse({ ...twice, items: [...twice.items, ...twice.items] })
        .success,
    ).toBe(false);
  });

  it('never clears unknown or third-party material, nor sets another visibility', () => {
    for (const licence of ['unknown', 'third-party'])
      expect(rightsBatchSchema.safeParse(batch(1, { licence })).success).toBe(false);
    expect(
      rightsBatchSchema.safeParse(batch(1, { visibility: 'public-eligible' })).success,
    ).toBe(false);
  });

  it('requires the reviewer to state evidence and a holder', () => {
    for (const licenceEvidence of ['', '   ', 'too short', 'x'.repeat(1001)])
      expect(rightsBatchSchema.safeParse(batch(1, { licenceEvidence })).success).toBe(
        false,
      );
    for (const rightsHolder of ['', '  ', 'x'.repeat(201)])
      expect(rightsBatchSchema.safeParse(batch(1, { rightsHolder })).success).toBe(false);
  });
});

describe('rightsBatch', () => {
  it('decides every named acquisition on its own, as public-eligible', async () => {
    const w = world();
    const result = await w.decisions.rightsBatch(ADMIN, batch(3));
    expect(result).toEqual({ decided: 3, refused: [] });
    expect(w.calls).toHaveLength(3);
    w.calls.forEach((call, n) =>
      expect(call).toEqual({
        provenanceId: ID(n + 1),
        expectedVersion: 1,
        licence: 'organisation-owned',
        visibility: 'public-eligible',
        licenceEvidence: 'Reviewed against the official source page and its notice.',
        rightsHolder: 'Minhaj-ul-Quran International',
        actorId: ADMIN.accountId,
        now: new Date('2026-10-30T10:00:00Z'),
      }),
    );
  });

  it('requires migration.administer before deciding anything', async () => {
    const w = world();
    for (const actor of [READER, NOBODY])
      expect(await refusedWith(w.decisions.rightsBatch(actor, batch(1)))).toBe('denied');
    expect(await refusedWith(w.decisions.rightsBatch(READER, {}))).toBe('denied');
    expect(w.calls).toEqual([]);
  });

  it('refuses a malformed batch before deciding any item', async () => {
    const w = world();
    expect(
      await refusedWith(w.decisions.rightsBatch(ADMIN, batch(1, { licence: 'unknown' }))),
    ).toBe('invalid');
    expect(w.calls).toEqual([]);
  });

  it('reports each refused item and keeps deciding the rest', async () => {
    const w = world({
      refuse: new Map([
        [ID(1), new MigrationRefusal('conflict')],
        [ID(3), new MigrationRefusal('not-found')],
      ]),
    });
    const result = await w.decisions.rightsBatch(ADMIN, batch(4));
    expect(result).toEqual({
      decided: 2,
      refused: [
        { provenanceId: ID(1), reason: 'conflict' },
        { provenanceId: ID(3), reason: 'not-found' },
      ],
    });
    expect(w.calls.map((call) => call.provenanceId)).toEqual([
      ID(1),
      ID(2),
      ID(3),
      ID(4),
    ]);
  });

  it('stops at an outage rather than reporting it as a verdict', async () => {
    const w = world({
      refuse: new Map([[ID(2), new Error('the store did not answer')]]),
    });
    expect(await refusedWith(w.decisions.rightsBatch(ADMIN, batch(3)))).toBe(
      'unavailable',
    );
    expect(w.calls.map((call) => call.provenanceId)).toEqual([ID(1), ID(2)]);
  });
});
