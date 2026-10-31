import { describe, expect, it } from 'vitest';

import {
  createMigrationDecisionService,
  createMigrationPipelineService,
  createMigrationReadService,
  migrationFailure,
  type MigrationRefusalReason,
  type PipelineRunOptions,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import {
  PersonalDataScanner,
  detectPersonalData,
  personalDataKey,
} from '../../apps/web/src/contexts/migration-provenance/domain/normalize.ts';
import type { ParsedPage } from '../../packages/contracts/src/migration/index.ts';
import {
  ADMIN,
  CLEARER,
  CLEARER_ID,
  FakeAuthority,
  FakeStorage,
  FakeStore,
  FakeTopics,
  JsonAdapter,
  PRIVILEGED,
  ScriptedFetcher,
  idFactory,
  indexPages,
  ok,
  pageUrl,
} from './fakes.ts';

/**
 * Phase 30-RD — a person may clear a FALSE POSITIVE of the personal-data
 * detector, and only that (OPEN_DECISIONS.md §3.8; MIGRATION_STRATEGY.md §17).
 */

async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

const OFFICE_MAIL = 'secretariat@office.fixture.invalid';
const OFFICE_PHONE = '+92 42 111 140 140';

/** An organisational page whose body states the office's own contact details. */
function officePage(extra = ''): ParsedPage {
  return {
    kind: 'editorial.page',
    binding: '/explore/about/introduction',
    title: 'Introduction',
    primaryLocale: 'en',
    languageCode: 'en',
    publishedOn: null,
    legacyIdentifier: 'tid-1799',
    categories: [],
    links: [],
    assets: [],
    excerptHtml: null,
    bodyHtml: `<p>Central Secretariat, 365-M Model Town, Lahore. Tel: ${OFFICE_PHONE}. Email: ${OFFICE_MAIL}.</p>${extra}`,
    leadImage: null,
  };
}

function privacyWorld() {
  const store = new FakeStore();
  const source = store.addSource({ contentKind: 'editorial.page' });
  const authority = new FakeAuthority();
  const fetcher = new ScriptedFetcher();
  indexPages(fetcher, 1);
  const setPage = (page: ParsedPage) =>
    fetcher.set(pageUrl(1), ok(pageUrl(1), JSON.stringify(page)));
  setPage(officePage());
  const adapter = new JsonAdapter([1]);
  adapter.contentKind = 'editorial.page';
  let time = Date.parse('2026-10-31T00:00:00Z');
  const now = () => new Date(time);
  const pipeline = createMigrationPipelineService({
    pipeline: store.pipeline,
    sources: store.sourcePort,
    authority,
    ids: idFactory(2),
    clock: now,
  });
  const decisions = createMigrationDecisionService({
    decisions: store.decisionPort,
    read: store.readPort,
    topics: new FakeTopics(),
    authority,
    clock: now,
  });
  const read = createMigrationReadService({
    read: store.readPort,
    publication: store.publicationPort,
    promotions: store.promotionPort,
    authority,
  });
  const run = (options: PipelineRunOptions = {}) =>
    pipeline.run(ADMIN, {
      sourceId: source.id,
      adapter,
      fetcher,
      assets: new FakeStorage(),
      options: {
        now,
        random: () => 0,
        sleep: async (ms) => {
          time += ms;
        },
        ...options,
      },
    });
  const revisions = () => store.stagedOf([...store.records.values()][0]!.id);
  const current = () => revisions().at(-1)!;
  const classifyAll = async (
    classification: string,
    actor: unknown = CLEARER,
    staged = current(),
  ) => {
    for (const finding of await read.personalDataFindings(ADMIN, staged.id))
      await decisions.classifyFinding(actor, {
        findingId: finding.id,
        expectedVersion: finding.version,
        classification,
        note: 'The Central Secretariat’s published office contact.',
      });
  };
  return {
    store,
    authority,
    fetcher,
    adapter,
    run,
    setPage,
    revisions,
    current,
    classifyAll,
    decisions,
    read,
  };
}

describe('the detector stays the default', () => {
  it('still flags and redacts every email and phone-like run', () => {
    const found = detectPersonalData(`Write to ${OFFICE_MAIL} or call ${OFFICE_PHONE}.`);
    expect(found.flagged).toBe(true);
    expect(found.redacted).toBe('Write to [redacted] or call [redacted].');
    // A date is a date, not a telephone.
    expect(detectPersonalData('On 2026-10-31 at noon').flagged).toBe(false);
  });

  it('clears only the exact matches it was given — never a type, a host or a pattern', () => {
    const scanner = new PersonalDataScanner(
      new Set([personalDataKey('email', OFFICE_MAIL)]),
    );
    const text = scanner.redact(
      `${OFFICE_MAIL}, private.person@office.fixture.invalid, ${OFFICE_PHONE}`,
    );
    expect(text).toBe(`${OFFICE_MAIL}, [redacted], [redacted]`);
    expect(scanner.uncleared).toBe(true);
    expect([...scanner.matches.values()].map((match) => match.type)).toEqual([
      'email',
      'email',
      'phone',
    ]);
  });

  it('records each distinct match once, with words around it that carry no contact value', () => {
    const scanner = new PersonalDataScanner();
    scanner.redact(`Office: ${OFFICE_PHONE}; fax ${OFFICE_PHONE}; mail ${OFFICE_MAIL}.`);
    const matches = [...scanner.matches.values()];
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(match.context).not.toContain(OFFICE_MAIL);
      expect(match.context).not.toContain('140 140');
      expect(match.context).toContain(`«${match.type}»`);
    }
  });
});

describe('a flagged revision', () => {
  it('records every finding with its digest and redacted context, and can never be approved', async () => {
    const world = privacyWorld();
    await world.run();
    const flagged = world.current();
    expect(flagged.personalData).toBe('flagged');
    expect(flagged.payload).toContain('[redacted]');
    expect(flagged.payload).not.toContain(OFFICE_MAIL);
    const findings = world.store.findingsOf(flagged.id);
    expect(findings.map((finding) => [finding.position, finding.type])).toEqual([
      [0, 'phone'],
      [1, 'email'],
    ]);
    for (const finding of findings) {
      expect(finding.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(finding.context).not.toContain(OFFICE_MAIL);
      expect(finding.classification).toBe('unresolved');
    }
    expect(
      await refusedWith(
        world.decisions.review(ADMIN, {
          stagedRecordId: flagged.id,
          expectedVersion: flagged.version,
          decision: 'approve',
          note: '',
        }),
      ),
    ).toBe('not-publishable');
  });

  it('a replay of the same bytes leaves an undecided revision as it is', async () => {
    const world = privacyWorld();
    await world.run();
    const again = await world.run({ replay: true });
    expect(again.counts).toMatchObject({ unchanged: 1, staged: 0 });
    expect(world.revisions()).toHaveLength(1);
  });
});

describe('classifying a finding', () => {
  it('needs the clearance actor: a plain or publication actor is denied', async () => {
    const world = privacyWorld();
    await world.run();
    for (const actor of [ADMIN, PRIVILEGED, { ...CLEARER, live: false }])
      expect(
        await refusedWith(world.classifyAll('public-organisational-contact', actor)),
      ).toBe('denied');
  });

  it('refuses a stale version, an unknown classification and a missing reason', async () => {
    const world = privacyWorld();
    await world.run();
    const [finding] = await world.read.personalDataFindings(ADMIN, world.current().id);
    const decide = (input: object) =>
      world.decisions.classifyFinding(CLEARER, {
        findingId: finding!.id,
        expectedVersion: finding!.version,
        classification: 'public-organisational-contact',
        note: 'Office contact.',
        ...input,
      });
    expect(await refusedWith(decide({ expectedVersion: 9 }))).toBe('conflict');
    expect(await refusedWith(decide({ classification: 'looks-fine' }))).toBe('invalid');
    expect(await refusedWith(decide({ note: '   ' }))).toBe('invalid');
    await decide({});
    expect(world.store.audit).toContain('migration.personal-data.classified');
    // The audit trail names the act, never the matched text.
    expect(world.store.audit.join(' ')).not.toContain(OFFICE_MAIL);
  });
});

describe('the cleared replay', () => {
  it('re-reads the retained bytes unredacted, as a NEW revision, leaving the flagged one intact', async () => {
    const world = privacyWorld();
    await world.run();
    const flagged = world.current();
    const flaggedPayload = flagged.payload;
    await world.classifyAll('public-organisational-contact');
    const replay = await world.run({ replay: true });
    expect(replay.counts).toMatchObject({ staged: 1 });
    expect(world.fetcher.count(pageUrl(1))).toBe(1);
    const cleared = world.current();
    expect(cleared.id).not.toBe(flagged.id);
    expect(cleared.personalData).toBe('cleared');
    expect(cleared.clearanceOfStagedRecordId).toBe(flagged.id);
    expect(cleared.inputChecksum).toBe(flagged.inputChecksum);
    expect(cleared.payload).toContain(OFFICE_MAIL);
    expect(cleared.payload).toContain(OFFICE_PHONE);
    expect(cleared.payload).not.toContain('[redacted]');
    expect(cleared.findings).toEqual([]);
    // The flagged revision is evidence: never rewritten.
    expect(world.store.staged.get(flagged.id)?.payload).toBe(flaggedPayload);
    expect(world.store.staged.get(flagged.id)?.personalData).toBe('flagged');
  });

  it('keeps the record held while any finding is personal, private or unresolved', async () => {
    for (const classification of ['personal-or-private', 'unresolved']) {
      const world = privacyWorld();
      await world.run();
      const [first, second] = await world.read.personalDataFindings(
        ADMIN,
        world.current().id,
      );
      await world.decisions.classifyFinding(CLEARER, {
        findingId: first!.id,
        expectedVersion: first!.version,
        classification: 'public-organisational-contact',
        note: 'Office line.',
      });
      await world.decisions.classifyFinding(CLEARER, {
        findingId: second!.id,
        expectedVersion: second!.version,
        classification,
        note: 'Not shown to be organisational.',
      });
      const replay = await world.run({ replay: true });
      expect(replay.counts).toMatchObject({ unchanged: 1, staged: 0 });
      expect(world.current().personalData).toBe('flagged');
    }
  });

  it('matches no clearance once the source bytes change: the new revision is flagged afresh', async () => {
    const world = privacyWorld();
    await world.run();
    await world.classifyAll('public-organisational-contact');
    world.setPage(
      officePage('<p>Also write to someone.else@private.fixture.invalid.</p>'),
    );
    await world.run();
    const fresh = world.current();
    expect(fresh.personalData).toBe('flagged');
    expect(fresh.payload).not.toContain(OFFICE_MAIL);
    expect(world.store.findingsOf(fresh.id)).toHaveLength(3);
    expect(
      world.store.findingsOf(fresh.id).every((f) => f.classification === 'unresolved'),
    ).toBe(true);
  });

  it('is approved only by somebody who cleared none of its findings', async () => {
    const world = privacyWorld();
    world.authority.grants.set(
      CLEARER_ID,
      new Set(['migration.read', 'migration.administer']),
    );
    await world.run();
    await world.classifyAll('public-organisational-contact');
    await world.run({ replay: true });
    const cleared = world.current();
    expect(
      await refusedWith(
        world.decisions.review(
          { accountId: CLEARER_ID },
          {
            stagedRecordId: cleared.id,
            expectedVersion: cleared.version,
            decision: 'approve',
            note: '',
          },
        ),
      ),
    ).toBe('same-person');
    await world.decisions.review(ADMIN, {
      stagedRecordId: cleared.id,
      expectedVersion: cleared.version,
      decision: 'approve',
      note: 'Second person: organisational office details only.',
    });
    expect(world.current().review).toBe('approved');
  });

  it('records the findings of a flagged revision staged before findings existed, then waits', async () => {
    const world = privacyWorld();
    await world.run();
    const first = world.current();
    // As a revision staged before Phase 30-RD: flagged, with nothing recorded.
    for (const finding of world.store.findingsOf(first.id))
      world.store.findings.delete(finding.id);
    const replay = await world.run({ replay: true });
    expect(replay.counts).toMatchObject({ staged: 1 });
    const second = world.current();
    expect(second.personalData).toBe('flagged');
    expect(world.store.findingsOf(second.id)).toHaveLength(2);
    expect((await world.run({ replay: true })).counts).toMatchObject({ unchanged: 1 });
  });
});
