import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createMigrationDecisionService,
  createMigrationPublicationService,
  createMigrationReadService,
  migrationFailure,
  type MigrationRefusalReason,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import {
  MIGRATION_LIMITS,
  runApprovalSchema,
  runManifestSchema,
  runRightsSchema,
} from '../../packages/contracts/src/migration/index.ts';
import {
  ADMIN,
  CLEARER_ID,
  FakeAuthority,
  FakeStore,
  FakeTarget,
  FakeTopics,
  NOBODY,
  PRIVILEGED,
  READER,
  idFactory,
} from './fakes.ts';

/**
 * R2 RUN-WIDE ACTS — a person confirms the WHOLE candidate set they were shown
 * (its size and the fingerprint of every candidate's version), and the act
 * then decides its next bounded slice item by item, each through the single
 * decision's own path and audit. A set that moved since is refused
 * `conflict`; what is not a candidate is never reached.
 */

async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

const fingerprintOf = (keys: readonly { id: string; version: number }[]) =>
  createHash('sha256')
    .update(keys.map((key) => `${key.id}:${String(key.version)}`).join('\n'))
    .digest('hex');

const video = (slug: string) => ({
  kind: 'media.video',
  slug,
  primaryLocale: 'en',
  languageCode: 'en',
  provider: 'youtube',
  providerVideoId: 'dQw4w9WgXcQ',
  labels: [{ locale: 'en', title: `Title ${slug}`, description: '' }],
  descriptionHtml: '',
  publishedOn: null,
  durationSeconds: null,
  legacyIdentifier: null,
});

function world(options: { reconciliation?: 'balanced' | 'unbalanced' } = {}) {
  const store = new FakeStore();
  const source = store.addSource({
    hosts: ['www.minhaj.tv'],
    assetHosts: ['minhaj.net'],
  });
  const run = store.completedRun(source.id, options.reconciliation ?? 'balanced');
  let produced = 0;
  /** A PENDING revision of the run, produced after every earlier one. */
  const pending = (
    slug: string,
    overrides: Partial<{
      contentKind: string;
      validation: 'valid' | 'invalid';
      personalData: 'none' | 'flagged' | 'cleared';
    }> = {},
  ) => {
    const row = store.approvedRevision(
      source.id,
      run.id,
      video(slug),
      `https://www.minhaj.tv/english/video/${slug}`,
    );
    row.review = 'pending';
    row.version = 1;
    row.title = slug;
    row.producedAt = new Date((produced += 1000));
    Object.assign(row, overrides);
    return row;
  };
  const authority = new FakeAuthority();
  const decisions = createMigrationDecisionService({
    decisions: store.decisionPort,
    read: store.readPort,
    sources: store.sourcePort,
    topics: new FakeTopics(),
    authority,
  });
  const read = createMigrationReadService({
    read: store.readPort,
    publication: store.publicationPort,
    promotions: store.promotionPort,
    sources: store.sourcePort,
    authority,
  });
  const publication = createMigrationPublicationService({
    publication: store.publicationPort,
    read: store.readPort,
    target: new FakeTarget(),
    authority,
    ids: idFactory(9),
    clock: () => new Date(0),
  });
  return { store, source, run, pending, decisions, read, publication };
}

/* ===========================================================================
 * Contracts
 * ========================================================================= */

describe('the run-wide confirmations', () => {
  const runId = '00000000-0000-4000-8000-000000000001';
  const fingerprint = 'a'.repeat(64);

  it('name a run, a size within the ceiling and a SHA-256 fingerprint', () => {
    const base = { runId, expectedCount: 1, fingerprint };
    expect(runManifestSchema.safeParse(base).success).toBe(true);
    expect(runApprovalSchema.safeParse({ ...base, note: '' }).success).toBe(true);
    for (const bad of [
      { ...base, expectedCount: 0 },
      { ...base, expectedCount: MIGRATION_LIMITS.runCandidates + 1 },
      { ...base, fingerprint: 'A'.repeat(64) },
      { ...base, fingerprint: 'a'.repeat(63) },
      { ...base, runId: 'run' },
      { ...base, extra: true },
    ])
      expect(runManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('clears pictures only as owned or licensed, with evidence and a holder, on a plain host name', () => {
    const base = {
      runId,
      expectedCount: 1,
      fingerprint,
      host: 'minhaj.net',
      licence: 'organisation-owned',
      licenceEvidence: 'Reviewed against the official page notice.',
      rightsHolder: 'Minhaj-ul-Quran International',
    };
    expect(runRightsSchema.safeParse(base).success).toBe(true);
    for (const bad of [
      { ...base, licence: 'unknown' },
      { ...base, licenceEvidence: 'short' },
      { ...base, rightsHolder: ' ' },
      { ...base, host: 'https://minhaj.net' },
      { ...base, host: 'minhaj.net/' },
      { ...base, host: 'MINHAJ.NET' },
      { ...base, host: 'minhaj.net%2F' },
      { ...base, visibility: 'public-eligible' },
    ])
      expect(runRightsSchema.safeParse(bad).success).toBe(false);
  });
});

/* ===========================================================================
 * (a) Approving a run
 * ========================================================================= */

describe('approveRun', () => {
  function candidates() {
    const w = world();
    const offered = [w.pending('a'), w.pending('b'), w.pending('c')];
    const excluded = {
      invalid: w.pending('invalid', { validation: 'invalid' }),
      flagged: w.pending('flagged', { personalData: 'flagged' }),
      cleared: w.pending('cleared', { personalData: 'cleared' }),
      fatwa: w.pending('fatwa', { contentKind: 'fatwa.ruling' }),
      quran: w.pending('quran', { contentKind: 'quran.translation' }),
    };
    const approved = w.pending('approved');
    approved.review = 'approved';
    return { ...w, offered, excluded };
  }

  it('shows the person the whole candidate set, what it leaves and why, and its fingerprint', async () => {
    const w = candidates();
    const view = await w.read.runApproval(READER, { runId: w.run.id });
    expect(view?.counts).toEqual({
      pending: 8,
      candidates: 3,
      invalid: 1,
      flagged: 1,
      cleared: 1,
      reviewOnly: 2,
      awaitingDuplicate: 0,
    });
    expect(view?.page.rows.map((row) => row.title)).toEqual(['a', 'b', 'c']);
    expect(view?.confirmation).toEqual({
      count: 3,
      fingerprint: fingerprintOf(w.offered.map((row) => ({ id: row.id, version: 1 }))),
    });
    expect(await refusedWith(w.read.runApproval(NOBODY, { runId: w.run.id }))).toBe(
      'denied',
    );
  });

  it('approves exactly the confirmed candidates, each its own audited review in the person’s name', async () => {
    const w = candidates();
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    const outcome = await w.decisions.approveRun(ADMIN, {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
      note: 'Read in full.',
    });
    expect(outcome).toEqual({ decided: 3, refused: [], remaining: 0 });
    expect(
      w.store.audit.filter((entry) => entry === 'migration.staged.approved'),
    ).toHaveLength(3);
    for (const row of w.offered) {
      expect(row.review).toBe('approved');
      expect(row.note).toBe('Read in full.');
    }
    // Nothing that was not a candidate moved: flagged, cleared, invalid and
    // review-only religious material stay pending for a single decision.
    for (const row of Object.values(w.excluded)) expect(row.review).toBe('pending');
  });

  it('refuses a reader and nobody, before reading the set', async () => {
    const w = candidates();
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    const input = {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
      note: '',
    };
    expect(await refusedWith(w.decisions.approveRun(READER, input))).toBe('denied');
    expect(await refusedWith(w.decisions.approveRun(NOBODY, input))).toBe('denied');
    expect(w.offered.every((row) => row.review === 'pending')).toBe(true);
  });

  it('refuses a set that moved since it was shown — a size, a version or a new candidate — deciding nothing', async () => {
    const w = candidates();
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    const input = {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
      note: '',
    };
    expect(
      await refusedWith(
        w.decisions.approveRun(ADMIN, {
          ...input,
          expectedCount: input.expectedCount + 1,
        }),
      ),
    ).toBe('conflict');
    expect(
      await refusedWith(
        w.decisions.approveRun(ADMIN, { ...input, fingerprint: 'f'.repeat(64) }),
      ),
    ).toBe('conflict');
    // A candidate edited since: same size, another fingerprint.
    w.offered[1]!.version = 2;
    expect(await refusedWith(w.decisions.approveRun(ADMIN, input))).toBe('conflict');
    w.offered[1]!.version = 1;
    // A candidate added since.
    w.pending('late');
    expect(await refusedWith(w.decisions.approveRun(ADMIN, input))).toBe('conflict');
    expect(w.offered.every((row) => row.review === 'pending')).toBe(true);
    expect(w.store.audit).not.toContain('migration.staged.approved');
  });

  it('refuses an unreconciled or unknown run', async () => {
    const w = world({ reconciliation: 'unbalanced' });
    const row = w.pending('a');
    const input = {
      runId: w.run.id,
      expectedCount: 1,
      fingerprint: fingerprintOf([{ id: row.id, version: 1 }]),
      note: '',
    };
    expect(await refusedWith(w.decisions.approveRun(ADMIN, input))).toBe(
      'run-unreconciled',
    );
    expect(
      await refusedWith(
        w.decisions.approveRun(ADMIN, {
          ...input,
          runId: '00000000-0000-4000-8fff-000000000001',
        }),
      ),
    ).toBe('not-found');
    expect(row.review).toBe('pending');
  });

  it('decides at most one slice per confirmation, and the next confirmation names what remains', async () => {
    const w = world();
    const total = MIGRATION_LIMITS.runChunk + 5;
    const rows = Array.from({ length: total }, (_, n) => w.pending(`v${String(n)}`));
    const first = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    expect(first.confirmation.count).toBe(total);
    const outcome = await w.decisions.approveRun(ADMIN, {
      runId: w.run.id,
      expectedCount: first.confirmation.count,
      fingerprint: first.confirmation.fingerprint,
      note: '',
    });
    expect(outcome.decided).toBe(MIGRATION_LIMITS.runChunk);
    expect(outcome.remaining).toBe(5);
    // Oldest first: exactly the first slice in the run's order.
    expect(
      rows.slice(0, MIGRATION_LIMITS.runChunk).every((r) => r.review === 'approved'),
    ).toBe(true);
    expect(
      rows.slice(MIGRATION_LIMITS.runChunk).every((r) => r.review === 'pending'),
    ).toBe(true);
    // The old confirmation no longer names the set; the new one does.
    expect(
      await refusedWith(
        w.decisions.approveRun(ADMIN, {
          runId: w.run.id,
          expectedCount: first.confirmation.count,
          fingerprint: first.confirmation.fingerprint,
          note: '',
        }),
      ),
    ).toBe('conflict');
    const second = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    expect(second.confirmation.count).toBe(5);
    expect(
      await w.decisions.approveRun(ADMIN, {
        runId: w.run.id,
        expectedCount: second.confirmation.count,
        fingerprint: second.confirmation.fingerprint,
        note: '',
      }),
    ).toEqual({ decided: 5, refused: [], remaining: 0 });
  });

  it('reports an item the single review refuses, for itself alone, and stops on an outage', async () => {
    const w = candidates();
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    const input = {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
      note: '',
    };
    // Between the set read and its review, one revision is decided elsewhere.
    const review = w.store.decisionPort.review;
    const racing = createMigrationDecisionService({
      decisions: {
        ...w.store.decisionPort,
        review: async (decision) => {
          if (decision.stagedRecordId === w.offered[1]!.id) {
            const error = Object.assign(new Error('conflict'), { reason: 'conflict' });
            throw error;
          }
          return review(decision);
        },
      },
      read: w.store.readPort,
      sources: w.store.sourcePort,
      topics: new FakeTopics(),
      authority: new FakeAuthority(),
    });
    const outcome = await racing.approveRun(ADMIN, input);
    expect(outcome.decided).toBe(2);
    expect(outcome.refused).toEqual([
      { stagedRecordId: w.offered[1]!.id, reason: 'conflict' },
    ]);
    expect(w.offered[1]!.review).toBe('pending');

    const fresh = candidates();
    const freshView = (await fresh.read.runApproval(ADMIN, { runId: fresh.run.id }))!;
    const down = createMigrationDecisionService({
      decisions: {
        ...fresh.store.decisionPort,
        review: async () => {
          throw new Error('connection reset');
        },
      },
      read: fresh.store.readPort,
      sources: fresh.store.sourcePort,
      topics: new FakeTopics(),
      authority: new FakeAuthority(),
    });
    expect(
      await refusedWith(
        down.approveRun(ADMIN, {
          runId: fresh.run.id,
          expectedCount: freshView.confirmation.count,
          fingerprint: freshView.confirmation.fingerprint,
          note: '',
        }),
      ),
    ).toBe('unavailable');
  });

  it('never approves past an undecided duplicate, on either side of the pair, and counts it apart', async () => {
    const w = world();
    const [first, second, third, fourth] = ['a', 'b', 'c', 'd'].map((slug) =>
      w.pending(slug),
    );
    const other = w.pending('elsewhere');
    other.review = 'approved';
    const pair = (recordId: string, otherRecordId: string, state: string) =>
      w.store.duplicates.set(`${recordId}|${otherRecordId}`, {
        id: w.store.ids(),
        recordId,
        otherRecordId,
        signal: 'identifier',
        crossLanguage: false,
        state,
        version: 1,
      });
    // Open with the candidate as the later record, and as the earlier one.
    pair(first!.recordId, other.recordId, 'open');
    pair(other.recordId, second!.recordId, 'open');
    // A decided pair holds nothing back.
    pair(third!.recordId, other.recordId, 'distinct');
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    expect(view.counts).toMatchObject({ candidates: 2, awaitingDuplicate: 2 });
    expect(view.page.rows.map((row) => row.title)).toEqual(['c', 'd']);
    // The person's confirmation names only those; the approval reaches nothing else.
    const outcome = await w.decisions.approveRun(ADMIN, {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
      note: '',
    });
    expect(outcome).toEqual({ decided: 2, refused: [], remaining: 0 });
    expect([third!.review, fourth!.review]).toEqual(['approved', 'approved']);
    expect([first!.review, second!.review]).toEqual(['pending', 'pending']);
    // A confirmation that claims the held-back revisions is not this set.
    expect(
      await refusedWith(
        w.decisions.approveRun(ADMIN, {
          runId: w.run.id,
          expectedCount: 2,
          fingerprint: fingerprintOf(
            [first!, second!].map((row) => ({ id: row.id, version: 1 })),
          ),
          note: '',
        }),
      ),
    ).toBe('conflict');
  });

  it('refuses, for itself alone, a revision whose duplicate was opened after the set was read', async () => {
    const w = world();
    const rows = ['a', 'b', 'c'].map((slug) => w.pending(slug));
    const other = w.pending('elsewhere');
    other.review = 'approved';
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    expect(view.confirmation.count).toBe(3);
    // A pair opened while the act runs — after its own re-read of the set
    // matched the fingerprint (ids and versions), before the item is decided.
    const decisions = createMigrationDecisionService({
      decisions: w.store.decisionPort,
      read: {
        ...w.store.readPort,
        approvalCandidateKeys: async (runId, ceiling) => {
          const keys = await w.store.readPort.approvalCandidateKeys(runId, ceiling);
          w.store.duplicates.set('late', {
            id: w.store.ids(),
            recordId: other.recordId,
            otherRecordId: rows[1]!.recordId,
            signal: 'identifier',
            crossLanguage: false,
            state: 'open',
            version: 1,
          });
          return keys;
        },
      },
      sources: w.store.sourcePort,
      topics: new FakeTopics(),
      authority: new FakeAuthority(),
    });
    const outcome = await decisions.approveRun(ADMIN, {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
      note: '',
    });
    expect(outcome).toEqual({
      decided: 2,
      refused: [{ stagedRecordId: rows[1]!.id, reason: 'duplicate-open' }],
      remaining: 1,
    });
    expect(rows.map((row) => row.review)).toEqual(['approved', 'pending', 'approved']);
    // A single review is unchanged: it does not ask about duplicates.
    await w.decisions.review(ADMIN, {
      stagedRecordId: rows[1]!.id,
      expectedVersion: 1,
      decision: 'approve',
      note: '',
    });
    expect(rows[1]!.review).toBe('approved');
  });

  it('leaves the cleared-revision rule to the single review: someone who cleared a finding still may not approve it', async () => {
    const w = world();
    const cleared = w.pending('cleared', { personalData: 'cleared' });
    const flagged = w.pending('flagged', { personalData: 'flagged' });
    cleared.clearanceOfStagedRecordId = flagged.id;
    w.store.findings.set('finding', {
      id: 'finding',
      stagedRecordId: flagged.id,
      position: 0,
      findingCount: 1,
      type: 'phone',
      digest: 'd',
      context: '[redacted]',
      classification: 'public-organisational-contact',
      note: 'Office line.',
      decidedByUserId: CLEARER_ID,
      decidedAt: new Date(0),
      version: 2,
    });
    const view = (await w.read.runApproval(ADMIN, { runId: w.run.id }))!;
    expect(view.confirmation.count).toBe(0);
    const authority = new FakeAuthority();
    authority.grants.set(CLEARER_ID, new Set(['migration.read', 'migration.administer']));
    const asClearer = createMigrationDecisionService({
      decisions: w.store.decisionPort,
      read: w.store.readPort,
      sources: w.store.sourcePort,
      topics: new FakeTopics(),
      authority,
    });
    expect(
      await refusedWith(
        asClearer.review(
          { accountId: CLEARER_ID },
          {
            stagedRecordId: cleared.id,
            expectedVersion: 1,
            decision: 'approve',
            note: '',
          },
        ),
      ),
    ).toBe('same-person');
  });
});

/* ===========================================================================
 * (b) Pictures by registered host
 * ========================================================================= */

describe('rightsRun', () => {
  function pictures() {
    const w = world();
    let acquired = 0;
    const acquire = (
      url: string,
      overrides: Partial<{
        licence: 'organisation-owned' | 'unknown' | 'licensed';
        licenceEvidence: string | null;
        publicCopy: null;
        runId: string;
      }> = {},
    ) => {
      const id = w.store.ids();
      const row = {
        sourceId: w.source.id,
        recordId: null,
        runId: w.run.id,
        originalUrl: url,
        originalUrlDigest: url,
        assetId: w.store.ids(),
        checksum: 'c'.repeat(64),
        byteSize: 1000,
        mediaType: 'image/jpeg',
        licence: 'organisation-owned' as const,
        licenceEvidence: 'The page states "© 2026 Minhaj-ul-Quran International".',
        rightsHolder: 'Minhaj-ul-Quran International',
        acquiredAt: new Date((acquired += 1000)),
        publicCopy: {
          assetId: w.store.ids(),
          checksum: 'd'.repeat(64),
          width: 640,
          height: 480,
        },
        id,
        visibility: 'restricted' as const,
        ...overrides,
      };
      w.store.acquisitions.set(id, row);
      return row;
    };
    const onNet = [
      acquire('https://minhaj.net/images/1.jpg'),
      acquire('https://minhaj.net/images/2.jpg'),
    ];
    const left = {
      unknown: acquire('https://minhaj.net/images/unknown.jpg', {
        licence: 'unknown',
        licenceEvidence: null,
      }),
      noEvidence: acquire('https://minhaj.net/images/bare.jpg', { licenceEvidence: '' }),
      noCopy: acquire('https://minhaj.net/images/nocopy.jpg', { publicCopy: null }),
      lookalike: acquire('https://minhaj.net.example.org/images/3.jpg'),
      otherHost: acquire('https://www.minhaj.tv/images/4.jpg'),
      otherRun: acquire('https://minhaj.net/images/5.jpg', {
        runId: '00000000-0000-4000-8fff-000000000009',
      }),
    };
    return { ...w, acquire, onNet, left };
  }

  const stated = {
    licence: 'organisation-owned',
    licenceEvidence: 'Checked each picture against its official page and notice.',
    rightsHolder: 'Minhaj-ul-Quran International',
  };

  it('lists only the source’s registered hosts, each with its candidates', async () => {
    const w = pictures();
    const view = (await w.read.runRights(READER, { runId: w.run.id }))!;
    expect(view.hosts).toEqual([
      { host: 'www.minhaj.tv', role: 'page', candidates: 1 },
      { host: 'minhaj.net', role: 'asset', candidates: 2 },
    ]);
    expect(view.page).toBeNull();
    const chosen = (await w.read.runRights(READER, {
      runId: w.run.id,
      host: 'minhaj.net',
    }))!;
    expect(chosen.page?.rows.map((row) => row.originalUrl)).toEqual(
      w.onNet.map((row) => row.originalUrl),
    );
    // A host the source does not register is never queried.
    expect(
      await refusedWith(
        w.read.runRights(READER, { runId: w.run.id, host: 'minhaj.net.example.org' }),
      ),
    ).toBe('invalid');
  });

  it('clears exactly the confirmed pictures on that host, each decided and audited on its own', async () => {
    const w = pictures();
    const view = (await w.read.runRights(ADMIN, {
      runId: w.run.id,
      host: 'minhaj.net',
    }))!;
    const outcome = await w.decisions.rightsRun(ADMIN, {
      runId: w.run.id,
      host: 'minhaj.net',
      expectedCount: view.confirmation!.count,
      fingerprint: view.confirmation!.fingerprint,
      ...stated,
    });
    expect(outcome).toEqual({ decided: 2, refused: [], remaining: 0 });
    expect(w.onNet.every((row) => row.visibility === 'public-eligible')).toBe(true);
    expect(
      w.store.audit.filter((entry) => entry === 'migration.asset.rights-decided'),
    ).toHaveLength(2);
    // Unknown rights, no evidence, no public copy, a look-alike host, another
    // host and another run are never reached.
    for (const row of Object.values(w.left)) expect(row.visibility).toBe('restricted');
  });

  it('refuses a host the source does not register, a reader, and a moved set', async () => {
    const w = pictures();
    const view = (await w.read.runRights(ADMIN, {
      runId: w.run.id,
      host: 'minhaj.net',
    }))!;
    const input = {
      runId: w.run.id,
      host: 'minhaj.net',
      expectedCount: view.confirmation!.count,
      fingerprint: view.confirmation!.fingerprint,
      ...stated,
    };
    expect(
      await refusedWith(w.decisions.rightsRun(ADMIN, { ...input, host: 'example.org' })),
    ).toBe('invalid');
    expect(await refusedWith(w.decisions.rightsRun(READER, input))).toBe('denied');
    w.acquire('https://minhaj.net/images/late.jpg');
    expect(await refusedWith(w.decisions.rightsRun(ADMIN, input))).toBe('conflict');
    expect(
      await refusedWith(w.decisions.rightsRun(ADMIN, { ...input, licence: 'unknown' })),
    ).toBe('invalid');
    expect(w.onNet.every((row) => row.visibility === 'restricted')).toBe(true);
  });

  it('reports a picture decided elsewhere since, for itself alone', async () => {
    const w = pictures();
    const view = (await w.read.runRights(ADMIN, {
      runId: w.run.id,
      host: 'minhaj.net',
    }))!;
    const decide = w.store.decisionPort.decideRights;
    const racing = createMigrationDecisionService({
      decisions: {
        ...w.store.decisionPort,
        decideRights: async (input) => {
          if (input.provenanceId === w.onNet[0]!.id)
            throw Object.assign(new Error('conflict'), { reason: 'conflict' });
          return decide(input);
        },
      },
      read: w.store.readPort,
      sources: w.store.sourcePort,
      topics: new FakeTopics(),
      authority: new FakeAuthority(),
    });
    const outcome = await racing.rightsRun(ADMIN, {
      runId: w.run.id,
      host: 'minhaj.net',
      expectedCount: view.confirmation!.count,
      fingerprint: view.confirmation!.fingerprint,
      ...stated,
    });
    expect(outcome.decided).toBe(1);
    expect(outcome.refused).toEqual([
      { provenanceId: w.onNet[0]!.id, reason: 'conflict' },
    ]);
    expect(outcome.remaining).toBe(1);
  });
});

/* ===========================================================================
 * (c) Manifests from a whole run
 * ========================================================================= */

describe('createRunManifest', () => {
  function approved(count: number) {
    const w = world();
    const rows = Array.from({ length: count }, (_, n) => {
      const row = w.pending(`m${String(n)}`);
      row.review = 'approved';
      row.version = 2;
      return row;
    });
    const fatwa = w.pending('fatwa', { contentKind: 'fatwa.ruling' });
    fatwa.review = 'approved';
    return { ...w, rows, fatwa };
  }

  it('drafts a manifest over the next slice of approved, publishable, unmanifested revisions', async () => {
    const total = MIGRATION_LIMITS.runManifestEntries + 3;
    const w = approved(total);
    const view = await w.read.runManifest(ADMIN, { runId: w.run.id });
    expect(view.confirmation.count).toBe(total);
    expect(view.next).toBe(MIGRATION_LIMITS.runManifestEntries);
    const manifest = await w.publication.createRunManifest(ADMIN, {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
    });
    const entries = [...w.store.entries.values()].filter(
      (entry) => entry.manifestId === manifest.id,
    );
    expect(entries.map((entry) => entry.stagedRecordId)).toEqual(
      w.rows.slice(0, MIGRATION_LIMITS.runManifestEntries).map((row) => row.id),
    );
    expect(entries.some((entry) => entry.stagedRecordId === w.fatwa.id)).toBe(false);
    // The rest are what the next manifest is confirmed over.
    const next = await w.read.runManifest(ADMIN, { runId: w.run.id });
    expect(next.confirmation.count).toBe(3);
  });

  it('refuses a reader, a moved set and an unreconciled run', async () => {
    const w = approved(2);
    const view = await w.read.runManifest(ADMIN, { runId: w.run.id });
    const input = {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
    };
    expect(await refusedWith(w.publication.createRunManifest(READER, input))).toBe(
      'denied',
    );
    expect(
      await refusedWith(
        w.publication.createRunManifest(ADMIN, { ...input, expectedCount: 1 }),
      ),
    ).toBe('conflict');
    w.store.runs.get(w.run.id)!.reconciliation = 'unbalanced';
    expect(await refusedWith(w.publication.createRunManifest(ADMIN, input))).toBe(
      'run-unreconciled',
    );
    expect(w.store.manifests.size).toBe(0);
  });

  it('leaves publication to a verified publisher with a live step-up', async () => {
    const w = approved(2);
    const view = await w.read.runManifest(ADMIN, { runId: w.run.id });
    const manifest = await w.publication.createRunManifest(ADMIN, {
      runId: w.run.id,
      expectedCount: view.confirmation.count,
      fingerprint: view.confirmation.fingerprint,
    });
    const command = { manifestId: manifest.id, expectedVersion: manifest.version };
    expect(await refusedWith(w.publication.publish(ADMIN, command))).toBe('denied');
    expect(
      await refusedWith(w.publication.publish({ ...PRIVILEGED, live: false }, command)),
    ).toBe('denied');
    const summary = await w.publication.publish(PRIVILEGED, command);
    expect(summary).toMatchObject({ done: 2, refused: 0, stopped: null });
  });
});
