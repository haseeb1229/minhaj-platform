import { describe, expect, it } from 'vitest';

import {
  createMigrationDecisionService,
  createMigrationPipelineService,
  createMigrationSourceService,
  migrationFailure,
  type MigrationRefusalReason,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import {
  AUTHORISED_MAX_CONCURRENCY,
  AUTHORISED_MIN_INTERVAL_MS,
  MIGRATION_LIMITS,
  parseStagedPayload,
  type MigrationContentKind,
  type ParsedRecord,
  type SourceRecord,
} from '../../packages/contracts/src/migration/index.ts';
import {
  ADMIN,
  FakeAuthority,
  FakeStorage,
  FakeStore,
  FakeTopics,
  JsonAdapter,
  NOBODY,
  POLICY,
  READER,
  ScriptedFetcher,
  idFactory,
  indexPages,
  ok,
  pageUrl,
  recordBody,
} from './fakes.ts';

/**
 * AUTHORISED SOURCES (Phase 30, OPEN_DECISIONS.md §3.1.1): registration under
 * `migration.administer` with the written authorisation reference and date,
 * a real `https` scope of exact hosts and the politeness floor; and the
 * pipeline running such a source — and every new content kind — end to end.
 *
 * Nothing here contacts a network: every fetch is a scripted answer.
 */

async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

const TODAY = new Date('2026-10-20T12:00:00Z');
const REAL_BASE = 'https://www.example.org/';
const FLOOR_POLICY = Object.freeze({
  ...POLICY,
  minIntervalMs: AUTHORISED_MIN_INTERVAL_MS,
  maxConcurrency: AUTHORISED_MAX_CONCURRENCY,
});

/* ===========================================================================
 * Registration
 * ========================================================================= */

const REGISTRATION = Object.freeze({
  key: 'example-news',
  name: 'Example news',
  contentKind: 'editorial.news',
  accessMethod: 'http',
  baseUrl: REAL_BASE,
  hosts: ['www.example.org', 'example.org'],
  defaultLanguageCode: 'en',
  policy: FLOOR_POLICY,
  authorisationReference: 'Board letter MQI/2026/07 (item 4)',
  authorisedOn: '2026-10-01',
  licensingEvidence: 'Organisation-owned content',
  policyNotes: null,
});

function sourceWorld() {
  const store = new FakeStore();
  const service = createMigrationSourceService({
    sources: store.sourcePort,
    read: store.readPort,
    authority: new FakeAuthority(),
    ids: idFactory(6),
    clock: () => TODAY,
  });
  return { store, service };
}

describe('registerAuthorised', () => {
  it('records the authorisation, INACTIVE, under migration.administer', async () => {
    const { store, service } = sourceWorld();
    const source = await service.registerAuthorised(ADMIN, REGISTRATION);
    expect(source).toMatchObject({
      key: 'example-news',
      authorityKind: 'authorised',
      accessMethod: 'http',
      contentKind: 'editorial.news',
      baseUrl: REAL_BASE,
      hosts: ['www.example.org', 'example.org'],
      authorisationReference: 'Board letter MQI/2026/07 (item 4)',
      authorisedOn: '2026-10-01',
      licensingEvidence: 'Organisation-owned content',
      policy: FLOOR_POLICY,
      state: 'inactive',
      version: 1,
    });
    expect(store.audit).toEqual(['migration.source.registered']);
    // Registering today is allowed; a duplicate key is not.
    expect(
      await service.registerAuthorised(ADMIN, {
        ...REGISTRATION,
        key: 'example-today',
        authorisedOn: '2026-10-20',
      }),
    ).toMatchObject({ state: 'inactive' });
    expect(await refusedWith(service.registerAuthorised(ADMIN, REGISTRATION))).toBe(
      'duplicate',
    );
  });

  it('requires migration.administer before reading anything', async () => {
    const { store, service } = sourceWorld();
    for (const actor of [READER, NOBODY, { accountId: '' }])
      expect(await refusedWith(service.registerAuthorised(actor, REGISTRATION))).toBe(
        'denied',
      );
    // Even a malformed request learns nothing of the rules without the permission.
    expect(await refusedWith(service.registerAuthorised(READER, {}))).toBe('denied');
    expect(store.sources.size).toBe(0);
  });

  it('demands the written authorisation reference, well-formed', async () => {
    const { store, service } = sourceWorld();
    for (const authorisationReference of [
      undefined,
      null,
      '',
      '  ',
      'ab',
      ' -leading',
      'token=abc123',
      'letter; DROP',
      'user@host',
      'a?b',
      'r'.repeat(401),
    ]) {
      const input: Record<string, unknown> = { ...REGISTRATION, authorisationReference };
      if (authorisationReference === undefined) delete input['authorisationReference'];
      expect(await refusedWith(service.registerAuthorised(ADMIN, input))).toBe('invalid');
    }
    expect(store.sources.size).toBe(0);
  });

  it('demands the authorisation date, a real calendar date not in the future', async () => {
    const { store, service } = sourceWorld();
    for (const authorisedOn of [
      undefined,
      null,
      '',
      '2026-13-01',
      '2026-02-30',
      '01/10/2026',
      '2026-10-01T00:00:00Z',
      '2026-10-21',
      '2030-01-01',
    ]) {
      const input: Record<string, unknown> = { ...REGISTRATION, authorisedOn };
      if (authorisedOn === undefined) delete input['authorisedOn'];
      expect(await refusedWith(service.registerAuthorised(ADMIN, input))).toBe('invalid');
    }
    expect(store.sources.size).toBe(0);
  });

  it('accepts only a real https scope of exact hosts', async () => {
    const { store, service } = sourceWorld();
    const unsafe: [string, { baseUrl: string; hosts: string[] }][] = [
      ['plain http', { baseUrl: 'http://www.example.org/', hosts: ['www.example.org'] }],
      [
        'a *.invalid host',
        { baseUrl: 'https://legacy.example.invalid/', hosts: ['legacy.example.invalid'] },
      ],
      [
        'a *.invalid host beside a real one',
        { baseUrl: REAL_BASE, hosts: ['www.example.org', 'x.invalid'] },
      ],
      [
        'a fixture host',
        { baseUrl: 'https://videos.fixture.invalid/', hosts: ['videos.fixture.invalid'] },
      ],
      [
        'credentials in the URL',
        { baseUrl: 'https://user:pass@www.example.org/', hosts: ['www.example.org'] },
      ],
      [
        'a username alone',
        { baseUrl: 'https://user@www.example.org/', hosts: ['www.example.org'] },
      ],
      [
        'a literal IPv4 address',
        { baseUrl: 'https://93.184.216.34/', hosts: ['93.184.216.34'] },
      ],
      [
        'a literal IPv6 address',
        { baseUrl: 'https://[2606:2800:220:1::]/', hosts: ['[2606:2800:220:1::]'] },
      ],
      [
        'a base not on a named host',
        { baseUrl: 'https://other.example.org/', hosts: ['www.example.org'] },
      ],
      [
        'a suffix, not an exact host',
        { baseUrl: 'https://www.example.org/', hosts: ['example.org'] },
      ],
      [
        'an explicit port',
        { baseUrl: 'https://www.example.org:8443/', hosts: ['www.example.org'] },
      ],
      [
        'a base that is not a root path',
        { baseUrl: 'https://www.example.org/news', hosts: ['www.example.org'] },
      ],
      [
        'a base with a query',
        { baseUrl: 'https://www.example.org/?a=1', hosts: ['www.example.org'] },
      ],
      [
        'a non-web scheme',
        { baseUrl: 'ftp://www.example.org/', hosts: ['www.example.org'] },
      ],
      ['a malformed base', { baseUrl: 'not a url', hosts: ['www.example.org'] }],
    ];
    for (const [name, scope] of unsafe)
      expect([
        name,
        await refusedWith(
          service.registerAuthorised(ADMIN, { ...REGISTRATION, ...scope }),
        ),
      ]).toEqual([name, 'unsafe-scope']);
    // Shape errors are invalid, not a scope verdict.
    for (const hosts of [
      [],
      ['www.example.org', 'www.example.org'],
      Array.from({ length: 9 }, (_, n) => `h${n}.example.org`),
    ])
      expect(
        await refusedWith(service.registerAuthorised(ADMIN, { ...REGISTRATION, hosts })),
      ).toBe('invalid');
    expect(store.sources.size).toBe(0);
  });

  it('holds the politeness floor whatever the registration asks', async () => {
    const { service } = sourceWorld();
    for (const policy of [
      { ...FLOOR_POLICY, minIntervalMs: AUTHORISED_MIN_INTERVAL_MS - 1 },
      { ...FLOOR_POLICY, minIntervalMs: 0 },
      { ...FLOOR_POLICY, maxConcurrency: AUTHORISED_MAX_CONCURRENCY + 1 },
    ])
      expect(
        await refusedWith(service.registerAuthorised(ADMIN, { ...REGISTRATION, policy })),
      ).toBe('invalid');
    expect(
      await service.registerAuthorised(ADMIN, {
        ...REGISTRATION,
        policy: { ...FLOOR_POLICY, minIntervalMs: 5000 },
      }),
    ).toMatchObject({ policy: { minIntervalMs: 5000, maxConcurrency: 1 } });
  });

  it('is a door of its own: no authority, state or export field is accepted', async () => {
    const { service } = sourceWorld();
    for (const extra of [
      { authorityKind: 'fixture' },
      { authorityKind: 'authorised' },
      { state: 'active' },
      { accessMethod: 'export' },
      { id: '00000000-0000-4000-8000-000000000001' },
    ])
      expect(
        await refusedWith(
          service.registerAuthorised(ADMIN, { ...REGISTRATION, ...extra }),
        ),
      ).toBe('invalid');
    expect(
      await refusedWith(
        service.registerAuthorised(ADMIN, {
          ...REGISTRATION,
          contentKind: 'hadith.narration',
        }),
      ),
    ).toBe('invalid');
  });

  it('leaves the fixture door refusing every authority field', async () => {
    const { store, service } = sourceWorld();
    const fixture = {
      key: 'fixture-three',
      name: 'Fixture three',
      contentKind: 'library.work',
      accessMethod: 'http',
      baseUrl: 'https://books.fixture.invalid/',
      hosts: ['books.fixture.invalid'],
      defaultLanguageCode: 'ur',
      policy: POLICY,
      licensingEvidence: null,
      policyNotes: null,
    };
    for (const extra of [
      { authorityKind: 'authorised' },
      { authorisationReference: REGISTRATION.authorisationReference },
      { authorisedOn: REGISTRATION.authorisedOn },
    ])
      expect(
        await refusedWith(service.createFixture(ADMIN, { ...fixture, ...extra })),
      ).toBe('real-source-not-authorised');
    // A fixture of any kind is still a fixture, on a synthetic scope only.
    expect(await service.createFixture(ADMIN, fixture)).toMatchObject({
      authorityKind: 'fixture',
      authorisationReference: null,
      contentKind: 'library.work',
    });
    expect(
      await refusedWith(
        service.createFixture(ADMIN, {
          ...fixture,
          key: 'fixture-four',
          baseUrl: REAL_BASE,
          hosts: ['www.example.org'],
        }),
      ),
    ).toBe('unsafe-scope');
    expect([...store.sources.values()].every((s) => s.authorityKind === 'fixture')).toBe(
      true,
    );
  });
});

describe('updating a source', () => {
  const update = (source: SourceRecord, overrides: Record<string, unknown> = {}) => ({
    id: source.id,
    expectedVersion: source.version,
    name: source.name,
    state: source.state,
    defaultLanguageCode: source.defaultLanguageCode,
    policy: source.policy,
    licensingEvidence: source.licensingEvidence,
    policyNotes: source.policyNotes,
    ...overrides,
  });

  it('activates an authorised source carrying its recorded authorisation, audited', async () => {
    const { store, service } = sourceWorld();
    const source = await service.registerAuthorised(ADMIN, REGISTRATION);
    expect(
      await refusedWith(service.update(READER, update(source, { state: 'active' }))),
    ).toBe('denied');
    const active = await service.update(ADMIN, update(source, { state: 'active' }));
    expect(active).toMatchObject({
      state: 'active',
      version: 2,
      authorityKind: 'authorised',
      authorisationReference: REGISTRATION.authorisationReference,
      authorisedOn: REGISTRATION.authorisedOn,
      hosts: REGISTRATION.hosts,
    });
    expect(store.audit).toEqual([
      'migration.source.registered',
      'migration.source.activated',
    ]);
  });

  it('never activates an authorised source whose evidence is missing', async () => {
    const { store, service } = sourceWorld();
    for (const missing of [{ authorisationReference: null }, { authorisedOn: null }]) {
      const source = store.addSource({
        key: `real-${Object.keys(missing)[0]}`.toLowerCase(),
        authorityKind: 'authorised',
        baseUrl: REAL_BASE,
        hosts: ['www.example.org'],
        authorisationReference: 'Board letter',
        authorisedOn: '2026-10-01',
        policy: FLOOR_POLICY,
        state: 'inactive',
        ...missing,
      });
      expect(
        await refusedWith(service.update(ADMIN, update(source, { state: 'active' }))),
      ).toBe('real-source-not-authorised');
      expect(store.sources.get(source.id)?.state).toBe('inactive');
    }
  });

  it('never lowers an authorised source’s politeness below the floor', async () => {
    const { store, service } = sourceWorld();
    const source = await service.registerAuthorised(ADMIN, REGISTRATION);
    for (const policy of [
      { ...FLOOR_POLICY, minIntervalMs: AUTHORISED_MIN_INTERVAL_MS - 1 },
      { ...FLOOR_POLICY, maxConcurrency: AUTHORISED_MAX_CONCURRENCY + 1 },
    ]) {
      expect(await refusedWith(service.update(ADMIN, update(source, { policy })))).toBe(
        'invalid',
      );
      // Not even while deactivating it.
      expect(
        await refusedWith(
          service.update(ADMIN, update(source, { policy, state: 'inactive' })),
        ),
      ).toBe('invalid');
    }
    expect(store.sources.get(source.id)).toMatchObject({
      version: 1,
      policy: FLOOR_POLICY,
    });
    // Raising the interval is always allowed.
    expect(
      await service.update(
        ADMIN,
        update(source, { policy: { ...FLOOR_POLICY, minIntervalMs: 3000 } }),
      ),
    ).toMatchObject({ policy: { minIntervalMs: 3000 } });
  });

  it('never turns a fixture into a real source', async () => {
    const { store, service } = sourceWorld();
    const fixture = store.addSource();
    for (const extra of [
      { authorityKind: 'authorised' },
      { authorisationReference: 'Board letter' },
      { authorisedOn: '2026-10-01' },
      { hosts: ['www.example.org'] },
      { baseUrl: REAL_BASE },
      { contentKind: 'editorial.news' },
    ])
      expect(await refusedWith(service.update(ADMIN, update(fixture, extra)))).toBe(
        'invalid',
      );
    // A fixture may be re-activated under its own scope, and stays a fixture.
    const again = await service.update(ADMIN, update(fixture, { state: 'inactive' }));
    const active = await service.update(ADMIN, update(again, { state: 'active' }));
    expect(active).toMatchObject({
      authorityKind: 'fixture',
      authorisationReference: null,
      authorisedOn: null,
      hosts: ['videos.fixture.invalid'],
    });
  });
});

/* ===========================================================================
 * The pipeline over an authorised source
 * ========================================================================= */

const AUTHORISED: Partial<SourceRecord> = Object.freeze({
  key: 'example-source',
  authorityKind: 'authorised',
  baseUrl: REAL_BASE,
  hosts: ['www.example.org'],
  authorisationReference: 'Board letter MQI/2026/07',
  authorisedOn: '2026-10-01',
  policy: FLOOR_POLICY,
  state: 'active',
});

function authorisedWorld(
  records: readonly ParsedRecord[],
  overrides: Partial<SourceRecord> = {},
) {
  const kind = (records[0]?.kind ?? 'media.video') as MigrationContentKind;
  const store = new FakeStore();
  const source = store.addSource({ ...AUTHORISED, contentKind: kind, ...overrides });
  const base = source.baseUrl ?? REAL_BASE;
  const keys = records.map((_, n) => n + 1);
  const fetcher = new ScriptedFetcher();
  indexPages(fetcher, keys.length, 10, base);
  records.forEach((record, n) =>
    fetcher.set(pageUrl(n + 1, base), ok(pageUrl(n + 1, base), recordBody(record))),
  );
  const adapter = new JsonAdapter(keys, 10, base);
  adapter.contentKind = kind;
  const authority = new FakeAuthority();
  let time = TODAY.getTime();
  const sleeps: number[] = [];
  const now = () => new Date(time);
  const service = createMigrationPipelineService({
    pipeline: store.pipeline,
    sources: store.sourcePort,
    authority,
    ids: idFactory(7),
    clock: now,
  });
  const run = () =>
    service.run(ADMIN, {
      sourceId: source.id,
      adapter,
      fetcher,
      assets: new FakeStorage(),
      options: {
        now,
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
          time += ms;
        },
      },
    });
  const staged = (n: number) => {
    const record = [...store.records.values()].find(
      (row) => row.externalKey === pageUrl(n, base),
    )!;
    return store.stagedOf(record.id).at(-1)!;
  };
  return { store, source, fetcher, adapter, authority, sleeps, run, staged };
}

const COMMON = {
  primaryLocale: 'en',
  languageCode: 'en',
  publishedOn: null,
  legacyIdentifier: null,
  categories: [],
  links: [],
  assets: [],
} as const;

const SAMPLES: Readonly<Record<MigrationContentKind, ParsedRecord>> = Object.freeze({
  'media.video': {
    ...COMMON,
    kind: 'media.video',
    title: 'Lecture',
    provider: 'youtube',
    providerReference: 'https://youtu.be/dQw4w9WgXcQ',
    labels: [],
    descriptionHtml: '<p>Words</p>',
    durationSeconds: 60,
  },
  'library.work': {
    ...COMMON,
    kind: 'library.work',
    title: 'A Book',
    descriptionHtml: '<p>About it</p>',
    edition: {
      label: 'First edition',
      publisher: null,
      publicationYear: '2010',
      isbn: '0-306-40615-2',
      pageCount: '120',
      readableAssetUrl: null,
      downloadAssetUrl: null,
    },
  },
  'library.magazine': {
    ...COMMON,
    kind: 'library.magazine',
    title: 'A Magazine',
    descriptionHtml: '<p>Monthly</p>',
  },
  'library.magazine-issue': {
    ...COMMON,
    kind: 'library.magazine-issue',
    title: 'Issue One',
    bodyHtml: '<ul><li>Contents</li></ul>',
    volume: '1',
    issueNumber: '1',
    magazineUrl: 'https://www.example.org/magazines/m',
  },
  'editorial.news': {
    ...COMMON,
    kind: 'editorial.news',
    title: 'News item',
    excerptHtml: null,
    bodyHtml: '<p>Body</p>',
  },
  'editorial.article': {
    ...COMMON,
    kind: 'editorial.article',
    title: 'An article',
    excerptHtml: '<p>Summary</p>',
    bodyHtml: '<h2>Part</h2><p>Body</p>',
  },
  'fatwa.ruling': {
    ...COMMON,
    kind: 'fatwa.ruling',
    title: 'A ruling',
    questionHtml: '<p>Question?</p>',
    answerHtml: '<p>Answer.</p>',
    sourceReference: '42',
    attributedTo: null,
  },
  'quran.translation': {
    ...COMMON,
    kind: 'quran.translation',
    title: 'Surah',
    work: 'A translation',
    surah: 112,
    ayat: [
      { ayah: 1, text: 'One' },
      { ayah: 4, text: 'Four' },
    ],
  },
});

/** One invalid variant per kind, and the issue it must raise. */
const INVALID: Readonly<Record<MigrationContentKind, [ParsedRecord, string]>> =
  Object.freeze({
    'media.video': [
      { ...SAMPLES['media.video'], provider: 'dailymotion' } as ParsedRecord,
      'provider-invalid',
    ],
    'library.work': [
      {
        ...(SAMPLES['library.work'] as Extract<ParsedRecord, { kind: 'library.work' }>),
        edition: {
          ...(SAMPLES['library.work'] as Extract<ParsedRecord, { kind: 'library.work' }>)
            .edition,
          isbn: '0-306-40615-3',
        },
      },
      'isbn-invalid',
    ],
    'library.magazine': [
      { ...SAMPLES['library.magazine'], title: '' } as ParsedRecord,
      'title-missing',
    ],
    'library.magazine-issue': [
      {
        ...SAMPLES['library.magazine-issue'],
        magazineUrl: 'http://www.example.org/m',
      } as ParsedRecord,
      'reference-missing',
    ],
    'editorial.news': [
      { ...SAMPLES['editorial.news'], languageCode: 'fr' } as ParsedRecord,
      'language-unsupported',
    ],
    'editorial.article': [
      { ...SAMPLES['editorial.article'], bodyHtml: '' } as ParsedRecord,
      'body-missing',
    ],
    'fatwa.ruling': [
      { ...SAMPLES['fatwa.ruling'], answerHtml: '' } as ParsedRecord,
      'answer-missing',
    ],
    'quran.translation': [
      {
        ...SAMPLES['quran.translation'],
        ayat: [{ ayah: 5, text: 'none' }],
      } as ParsedRecord,
      'ayah-invalid',
    ],
  });

/** One personal-data variant per kind. */
const PERSONAL = (record: ParsedRecord): ParsedRecord => {
  const pii = '<p>Contact person@example.com</p>';
  switch (record.kind) {
    case 'media.video':
    case 'library.work':
    case 'library.magazine':
      return { ...record, descriptionHtml: pii };
    case 'library.magazine-issue':
      return { ...record, bodyHtml: pii };
    case 'editorial.news':
    case 'editorial.article':
      return { ...record, bodyHtml: pii };
    case 'fatwa.ruling':
      return { ...record, questionHtml: pii };
    case 'quran.translation':
      return { ...record, ayat: [{ ayah: 1, text: 'person@example.com' }] };
  }
};

describe('pipeline: an authorised source', () => {
  it('runs inside its recorded real scope, at the politeness floor', async () => {
    const world = authorisedWorld([SAMPLES['editorial.news'], SAMPLES['editorial.news']]);
    const summary = await world.run();
    expect(summary).toMatchObject({ state: 'completed', processed: 2 });
    expect(summary.reconciliation?.balanced).toBe(true);
    expect(world.fetcher.requests.every((url) => url.startsWith(REAL_BASE))).toBe(true);
    // Every wait between two requests is at least the floor.
    expect(world.sleeps.length).toBeGreaterThan(0);
    expect(world.sleeps.every((ms) => ms >= AUTHORISED_MIN_INTERVAL_MS)).toBe(true);
  });

  it('refuses to run an inactive authorised source', async () => {
    const world = authorisedWorld([SAMPLES['editorial.news']], { state: 'inactive' });
    expect(await refusedWith(world.run())).toBe('source-inactive');
    expect(world.fetcher.requests).toEqual([]);
  });

  it('refuses a scope that is not real before any fetch', async () => {
    for (const scope of [
      { baseUrl: 'http://www.example.org/', hosts: ['www.example.org'] },
      { baseUrl: 'https://legacy.example.invalid/', hosts: ['legacy.example.invalid'] },
      { baseUrl: REAL_BASE, hosts: ['www.example.org', 'videos.fixture.invalid'] },
      { baseUrl: 'https://other.example.org/', hosts: ['www.example.org'] },
      { baseUrl: null, hosts: ['www.example.org'] },
    ]) {
      const world = authorisedWorld([SAMPLES['editorial.news']], scope);
      expect(await refusedWith(world.run())).toBe('unsafe-scope');
      expect(world.fetcher.requests).toEqual([]);
      expect(world.store.runs.size).toBe(0);
    }
  });

  it('refuses an adapter of another kind or access method', async () => {
    const world = authorisedWorld([SAMPLES['editorial.news']]);
    world.adapter.contentKind = 'editorial.article';
    expect(await refusedWith(world.run())).toBe('adapter-mismatch');
    world.adapter.contentKind = 'editorial.news';
    world.adapter.accessMethod = 'export';
    expect(await refusedWith(world.run())).toBe('adapter-mismatch');
    expect(world.fetcher.requests).toEqual([]);
  });

  it('errors a parsed record of another kind, never staging it', async () => {
    const world = authorisedWorld([SAMPLES['editorial.news']]);
    world.fetcher.set(
      pageUrl(1, REAL_BASE),
      ok(pageUrl(1, REAL_BASE), recordBody(SAMPLES['editorial.article'])),
    );
    const summary = await world.run();
    expect(summary.counts).toMatchObject({ errored: 1, staged: 0 });
    expect(world.store.staged.size).toBe(0);
    expect([...world.store.errors.values()][0]).toMatchObject({
      stage: 'parse',
      classification: 'parse-failed',
      detail: 'parsed another content kind',
    });
  });
});

describe('pipeline: every content kind end to end', () => {
  const KINDS = Object.keys(SAMPLES) as MigrationContentKind[];

  it.each(KINDS)('stages a valid %s with its strict payload', async (kind) => {
    const world = authorisedWorld([SAMPLES[kind]]);
    const summary = await world.run();
    expect(summary.counts).toMatchObject({ staged: 1, rejected: 0, errored: 0 });
    const row = world.staged(1);
    expect(row).toMatchObject({
      contentKind: kind,
      validation: 'valid',
      issues: [],
      personalData: 'none',
      outcome: 'staged',
    });
    const payload = parseStagedPayload(kind, row.payload);
    expect(payload).not.toBeNull();
    expect(payload?.kind).toBe(kind);
  });

  it.each(KINDS)('rejects an invalid %s with its issue code', async (kind) => {
    const [record, issue] = INVALID[kind];
    const world = authorisedWorld([record]);
    const summary = await world.run();
    expect(summary.counts).toMatchObject({ staged: 0, rejected: 1 });
    expect(summary.reconciliation?.balanced).toBe(true);
    const row = world.staged(1);
    expect(row).toMatchObject({ validation: 'invalid', outcome: 'rejected' });
    expect(row.issues).toContain(issue);
    expect([...world.store.errors.values()][0]).toMatchObject({
      stage: 'validate',
      classification: 'validation-failed',
    });
  });

  it.each(KINDS)('flags personal data in a %s so it cannot be approved', async (kind) => {
    const world = authorisedWorld([PERSONAL(SAMPLES[kind])]);
    await world.run();
    const row = world.staged(1);
    expect(row.personalData).toBe('flagged');
    // Scripture is never altered; every other kind is redacted.
    if (kind === 'quran.translation') expect(row.payload).toContain('person@example.com');
    else expect(row.payload).not.toContain('person@example.com');
    const decisions = createMigrationDecisionService({
      decisions: world.store.decisionPort,
      read: world.store.readPort,
      topics: new FakeTopics(),
      authority: world.authority,
    });
    expect(
      await refusedWith(
        decisions.review(ADMIN, {
          stagedRecordId: row.id,
          expectedVersion: row.version,
          decision: 'approve',
          note: '',
        }),
      ),
    ).toBe('not-publishable');
    expect(row.review).toBe('pending');
  });

  it('an identifier (an ISBN) only ever asks a person — never collapses', async () => {
    const book = SAMPLES['library.work'];
    const world = authorisedWorld([book, { ...book, title: 'Same ISBN, other title' }]);
    await world.run();
    const candidates = [...world.store.duplicates.values()];
    expect(candidates).toEqual([
      expect.objectContaining({
        signal: 'identifier',
        state: 'open',
        crossLanguage: false,
      }),
    ]);
    expect(
      [...world.store.records.values()].every((record) => record.mergedInto === null),
    ).toBe(true);
  });

  it('a provider id still collapses a same-language video duplicate', async () => {
    const video = SAMPLES['media.video'];
    const world = authorisedWorld([video, { ...video, title: 'Re-upload' }]);
    await world.run();
    expect(
      [...world.store.duplicates.values()].map((candidate) => [
        candidate.signal,
        candidate.state,
      ]),
    ).toEqual([['provider-id', 'collapsed']]);
  });

  it('stores an oversize payload as a stub naming its kind, rejected as body-too-long', async () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, n) => `<p>${`paragraph ${n} `.repeat(600)}</p>`,
    ).join('');
    const world = authorisedWorld([
      { ...SAMPLES['editorial.article'], bodyHtml: paragraphs },
    ]);
    await world.run();
    const row = world.staged(1);
    expect(JSON.parse(row.payload)).toEqual({
      kind: 'editorial.article',
      oversize: true,
    });
    expect(row.payload.length).toBeLessThan(MIGRATION_LIMITS.payload);
    expect(row.issues).toContain('body-too-long');
    expect(row).toMatchObject({ validation: 'invalid', outcome: 'rejected' });
    // The stub is never mistaken for a payload.
    expect(parseStagedPayload('editorial.article', row.payload)).toBeNull();
  });
});
