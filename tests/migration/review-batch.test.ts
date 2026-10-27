import { describe, expect, it } from 'vitest';

import {
  createMigrationDecisionService,
  migrationFailure,
  type MigrationRefusalReason,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import { MIGRATION_LIMITS } from '../../packages/contracts/src/migration/index.ts';
import {
  ADMIN,
  BASE,
  FakeAuthority,
  FakeStore,
  FakeTopics,
  NOBODY,
  READER,
} from './fakes.ts';

/**
 * ONE REVIEWER, A BOUNDED SELECTION (reviewBatchSchema): each named revision
 * decided, checked and audited exactly as a single review is — refused for
 * itself alone, never forced — and an outage stops the batch.
 */

async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

const payload = (slug: string) => ({
  kind: 'editorial.news',
  slug,
  languageCode: 'en',
  title: slug,
  excerpt: '',
  body: [{ type: 'paragraph', content: [{ text: 'Body' }] }],
  publishedOn: null,
  legacyIdentifier: null,
});

function world(count: number) {
  const store = new FakeStore();
  const source = store.addSource({ contentKind: 'editorial.news' });
  const run = store.completedRun(source.id);
  const rows = Array.from({ length: count }, (_, n) => {
    const row = store.approvedRevision(
      source.id,
      run.id,
      payload(`news-${n}`),
      `${BASE}news/${n}`,
    );
    row.review = 'pending';
    row.version = 1;
    return row;
  });
  const decisions = createMigrationDecisionService({
    decisions: store.decisionPort,
    read: store.readPort,
    topics: new FakeTopics(),
    authority: new FakeAuthority(),
  });
  const item = (index: number, expectedVersion = 1) => ({
    stagedRecordId: rows[index]!.id,
    expectedVersion,
  });
  return { store, rows, decisions, item };
}

describe('reviewMany', () => {
  it('approves every named revision, each audited as a single review', async () => {
    const w = world(3);
    const result = await w.decisions.reviewMany(ADMIN, {
      decision: 'approve',
      note: 'checked as a page',
      items: [w.item(0), w.item(2)],
    });
    expect(result).toEqual({ decided: 2, refused: [] });
    expect(w.rows.map((row) => row.review)).toEqual(['approved', 'pending', 'approved']);
    expect(w.rows[0]?.note).toBe('checked as a page');
    expect(w.store.audit).toEqual([
      'migration.staged.approved',
      'migration.staged.approved',
    ]);
  });

  it('requires migration.administer before reading anything', async () => {
    const w = world(1);
    for (const actor of [READER, NOBODY])
      expect(
        await refusedWith(
          w.decisions.reviewMany(actor, {
            decision: 'approve',
            note: '',
            items: [w.item(0)],
          }),
        ),
      ).toBe('denied');
    expect(await refusedWith(w.decisions.reviewMany(READER, {}))).toBe('denied');
    expect(w.rows[0]?.review).toBe('pending');
    expect(w.store.audit).toEqual([]);
  });

  it('is bounded to one operator page of unique revisions', async () => {
    const w = world(MIGRATION_LIMITS.page + 1);
    const all = w.rows.map((_, n) => w.item(n));
    for (const input of [
      { decision: 'approve', note: '', items: [] },
      { decision: 'approve', note: '', items: all },
      { decision: 'approve', note: '', items: [w.item(0), w.item(0)] },
      {
        decision: 'approve',
        note: '',
        items: [w.item(0), { ...w.item(0), expectedVersion: 2 }],
      },
      // Withdrawal is a single, deliberate act — never a batch.
      { decision: 'withdraw-approval', note: '', items: [w.item(0)] },
      { decision: 'approve', note: '', items: [w.item(0)], extra: true },
      { decision: 'approve', note: '', items: [{ ...w.item(0), extra: true }] },
      {
        decision: 'approve',
        note: 'n'.repeat(MIGRATION_LIMITS.note + 1),
        items: [w.item(0)],
      },
    ])
      expect(await refusedWith(w.decisions.reviewMany(ADMIN, input))).toBe('invalid');
    expect(w.store.audit).toEqual([]);
    // Exactly one page is accepted.
    const page = await w.decisions.reviewMany(ADMIN, {
      decision: 'approve',
      note: '',
      items: all.slice(0, MIGRATION_LIMITS.page),
    });
    expect(page).toEqual({ decided: MIGRATION_LIMITS.page, refused: [] });
  });

  it('checks each item on its own, refusing only that item with its reason', async () => {
    const w = world(6);
    w.rows[1]!.validation = 'invalid';
    w.rows[2]!.personalData = 'flagged';
    w.rows[4]!.review = 'approved';
    w.rows[4]!.version = 2;
    const result = await w.decisions.reviewMany(ADMIN, {
      decision: 'approve',
      note: '',
      items: [
        w.item(0),
        w.item(1),
        w.item(2),
        w.item(3, 7),
        w.item(4, 2),
        { stagedRecordId: '00000000-0000-4000-8fff-0000000000aa', expectedVersion: 1 },
        w.item(5),
      ],
    });
    expect(result).toEqual({
      decided: 2,
      refused: [
        { stagedRecordId: w.rows[1]!.id, reason: 'not-publishable' },
        { stagedRecordId: w.rows[2]!.id, reason: 'not-publishable' },
        { stagedRecordId: w.rows[3]!.id, reason: 'conflict' },
        { stagedRecordId: w.rows[4]!.id, reason: 'invalid-state' },
        { stagedRecordId: '00000000-0000-4000-8fff-0000000000aa', reason: 'not-found' },
      ],
    });
    expect(w.rows.map((row) => row.review)).toEqual([
      'approved',
      'pending',
      'pending',
      'pending',
      'approved',
      'approved',
    ]);
    expect(w.store.audit).toEqual([
      'migration.staged.approved',
      'migration.staged.approved',
    ]);
  });

  it('rejects pending revisions — invalid ones too — but never an approved one', async () => {
    const w = world(3);
    w.rows[1]!.validation = 'invalid';
    w.rows[2]!.review = 'approved';
    w.rows[2]!.version = 2;
    const result = await w.decisions.reviewMany(ADMIN, {
      decision: 'reject',
      note: 'not ours',
      items: [w.item(0), w.item(1), w.item(2, 2)],
    });
    expect(result).toEqual({
      decided: 2,
      refused: [{ stagedRecordId: w.rows[2]!.id, reason: 'invalid-state' }],
    });
    expect(w.rows.map((row) => row.review)).toEqual(['rejected', 'rejected', 'approved']);
  });

  it('a revision decided twice in one page is impossible, and twice across pages is refused', async () => {
    const w = world(1);
    await w.decisions.reviewMany(ADMIN, {
      decision: 'approve',
      note: '',
      items: [w.item(0)],
    });
    const again = await w.decisions.reviewMany(ADMIN, {
      decision: 'approve',
      note: '',
      items: [w.item(0, 2)],
    });
    expect(again).toEqual({
      decided: 0,
      refused: [{ stagedRecordId: w.rows[0]!.id, reason: 'invalid-state' }],
    });
    expect(w.store.audit).toEqual(['migration.staged.approved']);
  });

  it('stops at an outage, keeping what was decided and deciding nothing after it', async () => {
    const w = world(3);
    const review = w.store.decisionPort.review;
    let calls = 0;
    w.store.decisionPort.review = async (input) => {
      calls += 1;
      if (calls === 2) throw new Error('connection reset');
      return review(input);
    };
    expect(
      await refusedWith(
        w.decisions.reviewMany(ADMIN, {
          decision: 'approve',
          note: '',
          items: [w.item(0), w.item(1), w.item(2)],
        }),
      ),
    ).toBe('unavailable');
    expect(calls).toBe(2);
    expect(w.rows.map((row) => row.review)).toEqual(['approved', 'pending', 'pending']);

    // A read outage stops it the same way.
    const read = createMigrationDecisionService({
      decisions: w.store.decisionPort,
      read: {
        ...w.store.readPort,
        stagedDetail: async () => {
          throw new Error('timeout');
        },
      },
      topics: new FakeTopics(),
      authority: new FakeAuthority(),
    });
    expect(
      await refusedWith(
        read.reviewMany(ADMIN, { decision: 'reject', note: '', items: [w.item(2)] }),
      ),
    ).toBe('unavailable');
    expect(w.rows[2]?.review).toBe('pending');
  });
});
