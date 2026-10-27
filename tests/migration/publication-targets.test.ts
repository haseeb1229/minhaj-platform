import { describe, expect, it } from 'vitest';

import type {
  ArticleDetail,
  EditorialSummary,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  readerDocumentSchema,
  type EditionRecord,
  type MagazineIssueRecord,
  type MagazineRecord,
  type ScholarlyListing,
  type WorkDetail,
} from '../../packages/contracts/src/library/index.ts';
import type {
  MigrationContentKind,
  MigrationPublicationTargetPort,
  MigrationTargetRef,
  PublishableAsset,
  StagedBlock,
  StagedEditorialPayload,
  StagedMagazineIssuePayload,
  StagedMagazinePayload,
  StagedPayload,
  StagedWorkPayload,
} from '../../packages/contracts/src/migration/index.ts';
import { renderEditorialDocument } from '../../apps/web/src/contexts/editorial/application/rich-text.ts';
import {
  editorialDocument,
  editorialTargetOver,
  migrationEditorialReferences,
  type EditorialOperations,
} from '../../apps/web/src/composition/migration-editorial-targets.ts';
import {
  libraryMagazineIssueTargetOver,
  libraryMagazineTargetOver,
  libraryWorkTargetOver,
  printedNumber,
  readerDocumentOf,
  type LibraryScholarlyOperations,
  type LibraryWorkOperations,
} from '../../apps/web/src/composition/migration-library-targets.ts';
import { routeMigrationTargets } from '../../apps/web/src/composition/migration-target-router.ts';

/**
 * Phase 30 — the Library and Editorial publication targets and the router,
 * over STATEFUL fakes of each domain's own operations (MIGRATION_STRATEGY.md
 * §4.12, §7).
 *
 * WHAT IS PROVED: a payload becomes exactly the domain's own input; a Work is
 * never public before its Edition; a domain refusal is final and an outage is
 * `unavailable`; a FRESH entry meeting an existing record is refused
 * `target-exists` and never adopted; a RESUMED entry adopts — and finishes —
 * only exactly this payload's record; an issue refuses an unresolved or
 * unpublished Magazine; Editorial records are created and submitted, reported
 * `in-review`, and never approved, scheduled or published; withdrawal archives
 * at the recorded version, refuses a record edited since, and reports who
 * holds what; the router is fail-closed. What only real domains and a real
 * database can prove is in the staging and integration suites.
 */

const ACTOR = { accountId: '00000000-0000-4000-8000-0000000000aa' };
const TOPIC = '00000000-0000-4000-8000-0000000000f1';
const ASSET_READ = '00000000-0000-4000-8000-0000000000a1';
const ASSET_DOWNLOAD = '00000000-0000-4000-8000-0000000000a2';

const refusalError = (reason: string) => Object.assign(new Error(reason), { reason });
const outage = () => new Error('socket hang up');

let sequence = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const NOW = new Date('2026-10-27T00:00:00Z');

const noResolve = async (): Promise<MigrationTargetRef | null> => null;

function publishInput(
  kind: MigrationContentKind,
  payload: StagedPayload,
  overrides: Partial<{
    topicIds: readonly string[];
    assets: readonly PublishableAsset[];
    resolve: (legacyUrl: string) => Promise<MigrationTargetRef | null>;
    resumed: boolean;
  }> = {},
) {
  return {
    kind: kind as never,
    payload,
    topicIds: overrides.topicIds ?? [TOPIC],
    assets: overrides.assets ?? [],
    resolve: overrides.resolve ?? noResolve,
    actor: ACTOR,
    resumed: overrides.resumed ?? false,
  };
}

/* ===========================================================================
 * A stateful fake Library
 * ========================================================================= */

type Failures = Partial<
  Record<
    | 'saveWork'
    | 'saveEdition'
    | 'work'
    | 'workBySlug'
    | 'saveScholarly'
    | 'scholarlyRecord'
    | 'scholarlyRecords',
    () => Error | null
  >
>;

function fakeLibrary(failures: Failures = {}) {
  const works = new Map<string, WorkDetail>();
  const magazines = new Map<string, MagazineRecord>();
  const issues = new Map<string, MagazineIssueRecord>();
  const calls: {
    op: string;
    id: string | null;
    expected: number | null;
    input: unknown;
  }[] = [];
  const fail = (op: keyof Failures) => {
    const failure = failures[op]?.();
    if (failure) throw failure;
  };

  const library = {
    async saveWork(
      _actor: unknown,
      id: string | null,
      expected: number | null,
      raw: unknown,
    ) {
      calls.push({ op: 'saveWork', id, expected, input: raw });
      fail('saveWork');
      const input = raw as Omit<
        WorkDetail,
        'id' | 'version' | 'updatedAt' | 'editions' | 'salePoints'
      >;
      if (id === null) {
        if ([...works.values()].some((work) => work.slug === input.slug))
          throw refusalError('duplicate-slug');
        const work: WorkDetail = {
          ...input,
          id: nextId(),
          version: 1,
          updatedAt: NOW,
          editions: [],
          salePoints: [],
        };
        works.set(work.id, work);
        return work;
      }
      const current = works.get(id);
      if (!current || current.version !== expected) throw refusalError('conflict');
      const saved = { ...current, ...input, version: current.version + 1 };
      works.set(id, saved);
      return saved;
    },
    async saveEdition(
      _actor: unknown,
      id: string | null,
      expected: number | null,
      raw: unknown,
    ) {
      calls.push({ op: 'saveEdition', id, expected, input: raw });
      fail('saveEdition');
      const input = raw as EditionRecord;
      const work = works.get(input.workId);
      if (!work) throw refusalError('invalid');
      const edition: EditionRecord = {
        ...input,
        id: nextId(),
        version: 1,
        contentVersion: null,
        updatedAt: NOW,
        translation: null,
      };
      // Library serialises an Edition's save at its Work, moving its version.
      works.set(work.id, {
        ...work,
        version: work.version + 1,
        editions: [...work.editions, edition],
      });
      return edition;
    },
    async work(_actor: unknown, id: string) {
      fail('work');
      return works.get(id) ?? null;
    },
    async workBySlug(_actor: unknown, slug: string) {
      calls.push({ op: 'workBySlug', id: null, expected: null, input: slug });
      fail('workBySlug');
      return [...works.values()].find((work) => work.slug === slug) ?? null;
    },
    async saveScholarly(
      _actor: unknown,
      kind: 'magazine' | 'magazine-issue',
      id: string | null,
      expected: number | null,
      raw: unknown,
    ) {
      calls.push({ op: `saveScholarly:${kind}`, id, expected, input: raw });
      fail('saveScholarly');
      if (kind === 'magazine') {
        const input = raw as MagazineRecord;
        if (id === null) {
          if ([...magazines.values()].some((m) => m.slug === input.slug))
            throw refusalError('duplicate-slug');
          const record: MagazineRecord = {
            ...input,
            kind: 'magazine',
            id: nextId(),
            version: 1,
            updatedAt: NOW,
          };
          magazines.set(record.id, record);
          return record;
        }
        const current = magazines.get(id);
        if (!current || current.version !== expected) throw refusalError('conflict');
        const saved = {
          ...current,
          ...input,
          kind: 'magazine' as const,
          version: current.version + 1,
        };
        magazines.set(id, saved);
        return saved;
      }
      const input = raw as MagazineIssueRecord;
      const magazine = magazines.get(input.magazineId);
      if (!magazine) throw refusalError('invalid');
      if (id === null) {
        const siblings = [...issues.values()].filter(
          (i) => i.magazineId === input.magazineId,
        );
        if (siblings.some((i) => i.slug === input.slug))
          throw refusalError('duplicate-slug');
        if (
          input.volume !== null &&
          input.issueNumber !== null &&
          siblings.some(
            (i) => i.volume === input.volume && i.issueNumber === input.issueNumber,
          )
        )
          throw refusalError('duplicate-number');
        const record: MagazineIssueRecord = {
          ...input,
          publicationYear:
            input.publishedOn === null
              ? input.publicationYear
              : Number(input.publishedOn.slice(0, 4)),
          kind: 'magazine-issue',
          id: nextId(),
          version: 1,
          updatedAt: NOW,
          magazine: {
            slug: magazine.slug,
            primaryLocale: magazine.primaryLocale,
            labels: magazine.labels,
          },
        };
        issues.set(record.id, record);
        return record;
      }
      const current = issues.get(id);
      if (!current || current.version !== expected) throw refusalError('conflict');
      const saved = {
        ...current,
        ...input,
        kind: 'magazine-issue' as const,
        version: current.version + 1,
      };
      issues.set(id, saved);
      return saved;
    },
    async scholarlyRecord(_actor: unknown, kind: string, id: string) {
      fail('scholarlyRecord');
      return (kind === 'magazine' ? magazines.get(id) : issues.get(id)) ?? null;
    },
    async scholarlyRecords(
      _actor: unknown,
      kind: string,
      query: { offset: number; magazineId: string | null },
    ) {
      calls.push({
        op: `scholarlyRecords:${kind}`,
        id: null,
        expected: null,
        input: query,
      });
      fail('scholarlyRecords');
      const all = [...(kind === 'magazine' ? magazines.values() : issues.values())]
        .filter(
          (record) =>
            query.magazineId === null ||
            (record as MagazineIssueRecord).magazineId === query.magazineId,
        )
        .reverse();
      const page = all.slice(query.offset, query.offset + 25);
      return {
        items: page.map(
          (record) => ({ id: record.id, slug: record.slug }) as ScholarlyListing,
        ),
        hasMore: all.length > query.offset + 25,
      };
    },
  };
  return {
    work: library as unknown as LibraryWorkOperations,
    scholarly: library as unknown as LibraryScholarlyOperations,
    works,
    magazines,
    issues,
    calls,
    ops: () => calls.map((call) => call.op),
  };
}

/* ===========================================================================
 * library.work
 * ========================================================================= */

const WORK: StagedWorkPayload = {
  kind: 'library.work',
  slug: 'fixture-w001-book',
  primaryLocale: 'ur',
  languageCode: 'ur',
  labels: [
    { locale: 'ur', title: 'FIXTURE کتاب', description: 'FIXTURE تعارف' },
    { locale: 'en', title: 'FIXTURE book', description: 'FIXTURE introduction' },
  ],
  legacyIdentifier: 'w001',
  edition: {
    label: 'First edition',
    publisher: 'FIXTURE Publications',
    publicationYear: 2005,
    isbn: '9780306406157',
    pageCount: 320,
    readableAssetUrl: 'https://fixture.invalid/books/w001.pdf',
    downloadAssetUrl: 'https://fixture.invalid/books/w001-download.pdf',
  },
};

const PDFS: PublishableAsset[] = [
  {
    originalUrl: 'https://fixture.invalid/books/w001.pdf',
    assetId: ASSET_READ,
    mediaType: 'application/pdf',
    checksum: 'c1',
  },
  {
    originalUrl: 'https://fixture.invalid/books/w001-download.pdf',
    assetId: ASSET_DOWNLOAD,
    mediaType: 'application/pdf',
    checksum: 'c2',
  },
];

const holdsNothing = { workHeld: async () => false };

describe('Phase 30 library.work publication target', () => {
  it('serves library.work only', () => {
    const target = libraryWorkTargetOver({
      library: fakeLibrary().work,
      holdings: holdsNothing,
    });
    expect(target.supports('library.work')).toBe(true);
    for (const other of ['media.video', 'library.magazine', 'editorial.article'] as const)
      expect(target.supports(other)).toBe(false);
  });

  it('makes a draft Work, its published Edition, then publishes the Work at its current version', async () => {
    const fake = fakeLibrary();
    const target = libraryWorkTargetOver({ library: fake.work, holdings: holdsNothing });
    const result = await target.publish(
      publishInput('library.work', WORK, { assets: PDFS }),
    );
    const [work] = fake.works.values();
    expect(result).toEqual({
      status: 'published',
      target: { kind: 'library.work', id: work!.id },
      stage: 'public',
      version: 3,
      canonicalPath: `/library/books/${WORK.slug}`,
    });
    expect(fake.ops()).toEqual(['saveWork', 'saveEdition', 'saveWork']);
    expect(fake.calls[0]).toEqual({
      op: 'saveWork',
      id: null,
      expected: null,
      input: {
        slug: WORK.slug,
        primaryLocale: 'ur',
        state: 'draft',
        isFeatured: false,
        labels: WORK.labels,
        contributors: [],
        topicIds: [TOPIC],
        salePointIds: [],
      },
    });
    expect(fake.calls[1]!.input).toEqual({
      workId: work!.id,
      label: 'First edition',
      languageCode: 'ur',
      state: 'published',
      publisher: 'FIXTURE Publications',
      publicationYear: 2005,
      isbn: '9780306406157',
      pageCount: 320,
      reading: 'allowed',
      download: 'allowed',
      readableAssetId: ASSET_READ,
      downloadAssetId: ASSET_DOWNLOAD,
      document: null,
    });
    // Published at the version the Edition's save left, nothing else changed.
    expect(fake.calls[2]).toMatchObject({ id: work!.id, expected: 2 });
    expect(fake.calls[2]!.input).toMatchObject({ state: 'published', slug: WORK.slug });
    expect(work!.state).toBe('published');
  });

  it('reads and downloads only an acquisition a person cleared as a PDF, by its exact source URL', async () => {
    const cases: [PublishableAsset[], string, string, string | null, string | null][] = [
      [[], 'unavailable', 'denied', null, null],
      [[{ ...PDFS[0]!, mediaType: 'image/png' }], 'unavailable', 'denied', null, null],
      [
        [{ ...PDFS[0]!, originalUrl: `${PDFS[0]!.originalUrl}?x` }],
        'unavailable',
        'denied',
        null,
        null,
      ],
      [[PDFS[0]!], 'allowed', 'denied', ASSET_READ, null],
      [[PDFS[1]!], 'unavailable', 'allowed', null, ASSET_DOWNLOAD],
    ];
    for (const [assets, reading, download, readable, downloadable] of cases) {
      const fake = fakeLibrary();
      const target = libraryWorkTargetOver({
        library: fake.work,
        holdings: holdsNothing,
      });
      await target.publish(publishInput('library.work', WORK, { assets }));
      expect(fake.calls[1]!.input).toMatchObject({
        reading,
        download,
        readableAssetId: readable,
        downloadAssetId: downloadable,
      });
    }
  });

  it('refuses an Edition Library would refuse BEFORE making any Work', async () => {
    const fake = fakeLibrary();
    const target = libraryWorkTargetOver({ library: fake.work, holdings: holdsNothing });
    const badIsbn = { ...WORK, edition: { ...WORK.edition, isbn: '9780306406158' } };
    expect(await target.publish(publishInput('library.work', badIsbn))).toEqual({
      status: 'refused',
      reason: 'invalid',
    });
    expect(fake.calls).toEqual([]);
  });

  it('keeps Library refusals final and outages unavailable', async () => {
    for (const reason of ['denied', 'invalid']) {
      const fake = fakeLibrary({ saveWork: () => refusalError(reason) });
      const target = libraryWorkTargetOver({
        library: fake.work,
        holdings: holdsNothing,
      });
      expect(await target.publish(publishInput('library.work', WORK))).toEqual({
        status: 'refused',
        reason,
      });
    }
    const lost = fakeLibrary({ saveEdition: () => outage() });
    const target = libraryWorkTargetOver({ library: lost.work, holdings: holdsNothing });
    expect(await target.publish(publishInput('library.work', WORK))).toEqual({
      status: 'unavailable',
    });
    // The interrupted Work is a DRAFT, never a public Work without an Edition.
    expect([...lost.works.values()].map((work) => work.state)).toEqual(['draft']);
  });

  it('refuses, without adopting, an existing Work met by a FRESH entry', async () => {
    const fake = fakeLibrary();
    const target = libraryWorkTargetOver({ library: fake.work, holdings: holdsNothing });
    await target.publish(publishInput('library.work', WORK));
    const before = fake.calls.length;
    expect(await target.publish(publishInput('library.work', WORK))).toEqual({
      status: 'refused',
      reason: 'target-exists',
    });
    expect(fake.ops().slice(before)).toEqual(['saveWork']);
  });

  it('on resume, adopts and FINISHES exactly this payload’s interrupted Work', async () => {
    // Interrupted after the draft Work: the Edition and publication are finished.
    const afterDraft = fakeLibrary({ saveEdition: () => outage() });
    const first = libraryWorkTargetOver({
      library: afterDraft.work,
      holdings: holdsNothing,
    });
    expect(await first.publish(publishInput('library.work', WORK))).toEqual({
      status: 'unavailable',
    });
    // The same stored Work, in a Library that no longer fails.
    const failuresCleared = fakeLibrary();
    for (const [id, work] of afterDraft.works) failuresCleared.works.set(id, work);
    const resumed = libraryWorkTargetOver({
      library: failuresCleared.work,
      holdings: holdsNothing,
    });
    const result = await resumed.publish(
      publishInput('library.work', WORK, { resumed: true, assets: PDFS }),
    );
    const [work] = failuresCleared.works.values();
    expect(result).toEqual({
      status: 'published',
      target: { kind: 'library.work', id: work!.id },
      stage: 'public',
      version: 3,
      canonicalPath: `/library/books/${WORK.slug}`,
    });
    expect(failuresCleared.ops()).toEqual([
      'saveWork',
      'workBySlug',
      'saveEdition',
      'saveWork',
    ]);
    expect(work!.editions).toHaveLength(1);

    // Interrupted after publication: adopted as it is, nothing saved again.
    const done = fakeLibrary();
    const target = libraryWorkTargetOver({ library: done.work, holdings: holdsNothing });
    await target.publish(publishInput('library.work', WORK, { assets: PDFS }));
    const again = await target.publish(
      publishInput('library.work', WORK, { resumed: true, assets: PDFS }),
    );
    expect(again).toMatchObject({ status: 'published', version: 3 });
    expect(done.ops()).toEqual([
      'saveWork',
      'saveEdition',
      'saveWork',
      'saveWork',
      'workBySlug',
    ]);
  });

  it('on resume, refuses to adopt a Work that is not exactly this payload’s', async () => {
    const variants: [string, (work: WorkDetail) => WorkDetail][] = [
      ['target-conflict', (work) => ({ ...work, labels: [work.labels[0]!] })],
      ['target-conflict', (work) => ({ ...work, primaryLocale: 'en' })],
      [
        'target-conflict',
        (work) => ({
          ...work,
          editions: work.editions.map((edition) => ({
            ...edition,
            label: 'Second edition',
          })),
        }),
      ],
      [
        'target-conflict',
        (work) => ({
          ...work,
          editions: work.editions.map((edition) => ({ ...edition, languageCode: 'en' })),
        }),
      ],
      [
        'target-conflict',
        (work) => ({ ...work, editions: [...work.editions, ...work.editions] }),
      ],
      ['target-not-published', (work) => ({ ...work, state: 'archived' })],
    ];
    for (const [reason, change] of variants) {
      const fake = fakeLibrary();
      const target = libraryWorkTargetOver({
        library: fake.work,
        holdings: holdsNothing,
      });
      await target.publish(publishInput('library.work', WORK));
      const [work] = fake.works.values();
      fake.works.set(work!.id, change(work!));
      const before = fake.calls.length;
      expect(
        await target.publish(publishInput('library.work', WORK, { resumed: true })),
      ).toEqual({ status: 'refused', reason });
      expect(fake.ops().slice(before)).toEqual(['saveWork', 'workBySlug']);
    }
    // A slug that is a FORMER slug of another Work finds nothing current.
    const former = fakeLibrary({ saveWork: () => refusalError('duplicate-slug') });
    expect(
      await libraryWorkTargetOver({
        library: former.work,
        holdings: holdsNothing,
      }).publish(publishInput('library.work', WORK, { resumed: true })),
    ).toEqual({ status: 'refused', reason: 'target-conflict' });
  });

  it('inspects existence, version and whether a person holds the Work', async () => {
    const fake = fakeLibrary();
    const asked: string[] = [];
    const target = libraryWorkTargetOver({
      library: fake.work,
      holdings: {
        workHeld: async (id) => {
          asked.push(id);
          return true;
        },
      },
    });
    const published = await target.publish(publishInput('library.work', WORK));
    const ref = (published as { target: MigrationTargetRef }).target;
    expect(await target.inspect({ target: ref, actor: ACTOR })).toEqual({
      exists: true,
      version: 3,
      referencedByPeople: true,
    });
    expect(asked).toEqual([ref.id]);
    expect(
      await target.inspect({
        target: { kind: 'library.work', id: nextId() },
        actor: ACTOR,
      }),
    ).toEqual({ exists: false, version: 0, referencedByPeople: false });
    expect(
      await target.inspect({ target: { kind: 'media.video', id: ref.id }, actor: ACTOR }),
    ).toBeNull();
  });

  it('withdraws by archiving the Work at the recorded version, keeping every other value', async () => {
    const fake = fakeLibrary();
    const target = libraryWorkTargetOver({ library: fake.work, holdings: holdsNothing });
    const published = await target.publish(publishInput('library.work', WORK));
    const ref = (published as { target: MigrationTargetRef }).target;
    // A person featured it and linked a sale point at the SAME version (a
    // hypothetical: what matters is that the archive carries them unchanged).
    const work = fake.works.get(ref.id)!;
    fake.works.set(ref.id, { ...work, isFeatured: true, salePointIds: [TOPIC] });
    const before = fake.calls.length;
    expect(
      await target.withdraw({ target: ref, expectedVersion: 3, actor: ACTOR }),
    ).toEqual({
      status: 'withdrawn',
      version: 4,
    });
    expect(fake.calls.slice(before)).toEqual([
      {
        op: 'saveWork',
        id: ref.id,
        expected: 3,
        input: {
          slug: WORK.slug,
          primaryLocale: 'ur',
          state: 'archived',
          isFeatured: true,
          labels: WORK.labels,
          contributors: [],
          topicIds: [TOPIC],
          salePointIds: [TOPIC],
        },
      },
    ]);
  });

  it('refuses to withdraw a Work edited since, or one that is gone; an outage is unavailable', async () => {
    const fake = fakeLibrary();
    const target = libraryWorkTargetOver({ library: fake.work, holdings: holdsNothing });
    const ref = (
      (await target.publish(publishInput('library.work', WORK))) as {
        target: MigrationTargetRef;
      }
    ).target;
    const before = fake.calls.length;
    expect(
      await target.withdraw({ target: ref, expectedVersion: 2, actor: ACTOR }),
    ).toEqual({
      status: 'refused',
      reason: 'conflict',
    });
    expect(
      await target.withdraw({
        target: { kind: 'library.work', id: nextId() },
        expectedVersion: 3,
        actor: ACTOR,
      }),
    ).toEqual({ status: 'refused', reason: 'not-found' });
    expect(fake.calls.slice(before)).toEqual([]);
    const lost = fakeLibrary({ work: () => outage() });
    expect(
      await libraryWorkTargetOver({
        library: lost.work,
        holdings: holdsNothing,
      }).withdraw({
        target: ref,
        expectedVersion: 3,
        actor: ACTOR,
      }),
    ).toEqual({ status: 'unavailable' });
  });
});

/* ===========================================================================
 * library.magazine and library.magazine-issue
 * ========================================================================= */

const MAGAZINE: StagedMagazinePayload = {
  kind: 'library.magazine',
  slug: 'fixture-m001-monthly',
  primaryLocale: 'ur',
  labels: [{ locale: 'ur', title: 'FIXTURE ماہنامہ', description: 'FIXTURE رسالہ' }],
  legacyIdentifier: 'm001',
};

const MAGAZINE_URL = 'https://fixture.invalid/magazines/m001';

const ISSUE: StagedMagazineIssuePayload = {
  kind: 'library.magazine-issue',
  slug: 'fixture-m001-2020-01',
  primaryLocale: 'ur',
  languageCode: 'ur',
  labels: [{ locale: 'ur', title: 'FIXTURE شمارہ جنوری', description: '' }],
  publishedOn: '2020-01-01',
  volume: '۳۴',
  issueNumber: '1',
  magazine: { role: 'magazine', legacyUrl: MAGAZINE_URL },
  body: [
    {
      type: 'paragraph',
      content: [{ text: 'FIXTURE ' }, { text: 'اداریہ', bold: true }],
    },
    { type: 'heading', level: 2, content: [{ text: 'FIXTURE فہرست' }] },
    {
      type: 'list',
      ordered: true,
      items: [
        [{ text: 'FIXTURE مضمون ایک' }],
        [{ text: 'FIXTURE مضمون دو', href: '/x' }],
      ],
    },
    { type: 'heading', level: 3, content: [{ text: 'FIXTURE empty heading' }] },
    { type: 'heading', level: 3, content: [{ text: 'FIXTURE line\nbreak' }] },
    { type: 'quote', content: [{ text: 'FIXTURE quoted\nwords' }] },
  ],
  legacyIdentifier: 'i001',
};

describe('Phase 30 library.magazine publication target', () => {
  it('publishes the Magazine as Library’s own input and adopts only on resume', async () => {
    const fake = fakeLibrary();
    const target = libraryMagazineTargetOver({ library: fake.scholarly });
    expect(target.supports('library.magazine')).toBe(true);
    expect(target.supports('library.magazine-issue')).toBe(false);
    const result = await target.publish(publishInput('library.magazine', MAGAZINE));
    const [magazine] = fake.magazines.values();
    expect(result).toEqual({
      status: 'published',
      target: { kind: 'library.magazine', id: magazine!.id },
      stage: 'public',
      version: 1,
      canonicalPath: `/library/magazines/${MAGAZINE.slug}`,
    });
    expect(fake.calls[0]!.input).toEqual({
      slug: MAGAZINE.slug,
      primaryLocale: 'ur',
      state: 'published',
      labels: [{ locale: 'ur', title: 'FIXTURE ماہنامہ', summary: 'FIXTURE رسالہ' }],
      contributors: [],
      topicIds: [TOPIC],
    });

    expect(await target.publish(publishInput('library.magazine', MAGAZINE))).toEqual({
      status: 'refused',
      reason: 'target-exists',
    });
    expect(
      await target.publish(publishInput('library.magazine', MAGAZINE, { resumed: true })),
    ).toEqual(result);
    // Another record's words under the slug is not adopted.
    fake.magazines.set(magazine!.id, {
      ...magazine!,
      labels: [{ locale: 'ur', title: 'OTHER', summary: '' }],
    });
    expect(
      await target.publish(publishInput('library.magazine', MAGAZINE, { resumed: true })),
    ).toEqual({ status: 'refused', reason: 'target-conflict' });
    fake.magazines.set(magazine!.id, { ...magazine!, state: 'archived' });
    expect(
      await target.publish(publishInput('library.magazine', MAGAZINE, { resumed: true })),
    ).toEqual({ status: 'refused', reason: 'target-not-published' });
  });

  it('withdraws at the recorded version, refuses an edited one, and is never held', async () => {
    const fake = fakeLibrary();
    const target = libraryMagazineTargetOver({ library: fake.scholarly });
    const ref = (
      (await target.publish(publishInput('library.magazine', MAGAZINE))) as {
        target: MigrationTargetRef;
      }
    ).target;
    expect(await target.inspect({ target: ref, actor: ACTOR })).toEqual({
      exists: true,
      version: 1,
      referencedByPeople: false,
    });
    expect(
      await target.withdraw({ target: ref, expectedVersion: 2, actor: ACTOR }),
    ).toEqual({
      status: 'refused',
      reason: 'conflict',
    });
    expect(
      await target.withdraw({ target: ref, expectedVersion: 1, actor: ACTOR }),
    ).toEqual({
      status: 'withdrawn',
      version: 2,
    });
    expect(fake.calls.at(-1)).toEqual({
      op: 'saveScholarly:magazine',
      id: ref.id,
      expected: 1,
      input: {
        slug: MAGAZINE.slug,
        primaryLocale: 'ur',
        state: 'archived',
        labels: [{ locale: 'ur', title: 'FIXTURE ماہنامہ', summary: 'FIXTURE رسالہ' }],
        contributors: [],
        topicIds: [TOPIC],
      },
    });
  });
});

describe('Phase 30 library.magazine-issue publication target', () => {
  async function withMagazine(failures: Failures = {}) {
    const fake = fakeLibrary(failures);
    const magazine: MagazineRecord = {
      kind: 'magazine',
      id: nextId(),
      slug: 'fixture-m001-renamed',
      primaryLocale: 'ur',
      state: 'published',
      labels: [{ locale: 'ur', title: 'FIXTURE ماہنامہ', summary: '' }],
      contributors: [],
      topicIds: [],
      version: 4,
      updatedAt: NOW,
    };
    fake.magazines.set(magazine.id, magazine);
    const resolve = async (url: string) =>
      url === MAGAZINE_URL
        ? { kind: 'library.magazine' as const, id: magazine.id }
        : null;
    return { fake, magazine, resolve };
  }

  it('publishes under the resolved Magazine, at its CURRENT slug, with Library’s own input', async () => {
    const { fake, magazine, resolve } = await withMagazine();
    const target = libraryMagazineIssueTargetOver({ library: fake.scholarly });
    const result = await target.publish(
      publishInput('library.magazine-issue', ISSUE, { resolve }),
    );
    const [issue] = fake.issues.values();
    expect(result).toEqual({
      status: 'published',
      target: { kind: 'library.magazine-issue', id: issue!.id },
      stage: 'public',
      version: 1,
      canonicalPath: `/library/magazines/${magazine.slug}/issues/${ISSUE.slug}`,
    });
    expect(fake.calls.at(-1)!.input).toEqual({
      slug: ISSUE.slug,
      primaryLocale: 'ur',
      state: 'published',
      labels: [{ locale: 'ur', title: 'FIXTURE شمارہ جنوری', summary: '' }],
      contributors: [],
      topicIds: [TOPIC],
      languageCode: 'ur',
      publicationYear: null,
      publishedOn: '2020-01-01',
      magazineId: magazine.id,
      volume: 34,
      issueNumber: 1,
      document: readerDocumentOf(ISSUE.body, 'FIXTURE شمارہ جنوری'),
    });
  });

  it('refuses an unresolved, foreign or unpublished Magazine before saving anything', async () => {
    const { fake, magazine, resolve } = await withMagazine();
    const target = libraryMagazineIssueTargetOver({ library: fake.scholarly });
    const resolvers = [
      noResolve,
      async () => ({ kind: 'library.work' as const, id: magazine.id }),
      async () => ({ kind: 'library.magazine' as const, id: nextId() }),
    ];
    for (const other of resolvers)
      expect(
        await target.publish(
          publishInput('library.magazine-issue', ISSUE, { resolve: other }),
        ),
      ).toEqual({ status: 'refused', reason: 'reference-unpublished' });
    fake.magazines.set(magazine.id, { ...magazine, state: 'archived' });
    expect(
      await target.publish(publishInput('library.magazine-issue', ISSUE, { resolve })),
    ).toEqual({ status: 'refused', reason: 'reference-unpublished' });
    expect(fake.ops().filter((op) => op.startsWith('saveScholarly'))).toEqual([]);
  });

  it('refuses a printed number Library cannot hold rather than dropping it', async () => {
    const { fake, resolve } = await withMagazine();
    const target = libraryMagazineIssueTargetOver({ library: fake.scholarly });
    for (const volume of ['XII', 'Special', '0', '100001', '1.5'])
      expect(
        await target.publish(
          publishInput('library.magazine-issue', { ...ISSUE, volume }, { resolve }),
        ),
      ).toEqual({ status: 'refused', reason: 'issue-number-unmappable' });
    expect(fake.calls).toEqual([]);
  });

  it('a fresh entry meeting the slug or number is refused; a resumed one adopts only an exact match', async () => {
    const { fake, magazine, resolve } = await withMagazine();
    const target = libraryMagazineIssueTargetOver({ library: fake.scholarly });
    const first = await target.publish(
      publishInput('library.magazine-issue', ISSUE, { resolve }),
    );
    expect(
      await target.publish(publishInput('library.magazine-issue', ISSUE, { resolve })),
    ).toEqual({ status: 'refused', reason: 'target-exists' });
    expect(
      await target.publish(
        publishInput('library.magazine-issue', ISSUE, { resolve, resumed: true }),
      ),
    ).toEqual(first);
    // The same number under ANOTHER slug is another issue: never adopted.
    expect(
      await target.publish(
        publishInput(
          'library.magazine-issue',
          { ...ISSUE, slug: 'fixture-m001-other' },
          { resolve, resumed: true },
        ),
      ),
    ).toEqual({ status: 'refused', reason: 'target-conflict' });
    const [issue] = fake.issues.values();
    fake.issues.set(issue!.id, { ...issue!, publishedOn: '2020-02-01' });
    expect(
      await target.publish(
        publishInput('library.magazine-issue', ISSUE, { resolve, resumed: true }),
      ),
    ).toEqual({ status: 'refused', reason: 'target-conflict' });
    expect(
      fake.calls.filter((c) => c.op.startsWith('scholarlyRecords')).map((c) => c.input),
    ).toContainEqual({
      offset: 0,
      state: null,
      magazineId: magazine.id,
    });
  });

  it('keeps refusals final and outages unavailable, and withdraws at the recorded version', async () => {
    const lost = await withMagazine({ saveScholarly: () => outage() });
    expect(
      await libraryMagazineIssueTargetOver({ library: lost.fake.scholarly }).publish(
        publishInput('library.magazine-issue', ISSUE, { resolve: lost.resolve }),
      ),
    ).toEqual({ status: 'unavailable' });
    const denied = await withMagazine({ saveScholarly: () => refusalError('denied') });
    expect(
      await libraryMagazineIssueTargetOver({ library: denied.fake.scholarly }).publish(
        publishInput('library.magazine-issue', ISSUE, { resolve: denied.resolve }),
      ),
    ).toEqual({ status: 'refused', reason: 'denied' });

    const { fake, magazine, resolve } = await withMagazine();
    const target = libraryMagazineIssueTargetOver({ library: fake.scholarly });
    const ref = (
      (await target.publish(
        publishInput('library.magazine-issue', ISSUE, { resolve }),
      )) as { target: MigrationTargetRef }
    ).target;
    expect(await target.inspect({ target: ref, actor: ACTOR })).toEqual({
      exists: true,
      version: 1,
      referencedByPeople: false,
    });
    expect(
      await target.withdraw({ target: ref, expectedVersion: 5, actor: ACTOR }),
    ).toEqual({
      status: 'refused',
      reason: 'conflict',
    });
    expect(
      await target.withdraw({ target: ref, expectedVersion: 1, actor: ACTOR }),
    ).toEqual({
      status: 'withdrawn',
      version: 2,
    });
    expect(fake.calls.at(-1)).toMatchObject({
      op: 'saveScholarly:magazine-issue',
      id: ref.id,
      expected: 1,
      input: {
        state: 'archived',
        magazineId: magazine.id,
        volume: 34,
        issueNumber: 1,
        publicationYear: 2020,
        publishedOn: '2020-01-01',
      },
    });
  });
});

describe('Phase 30 conversions into Library’s own values', () => {
  it('reads a printed number in any of the corpus’s digit systems, and nothing else', () => {
    expect(printedNumber(null)).toBeNull();
    expect(printedNumber('12')).toBe(12);
    expect(printedNumber(' 007 ')).toBe(7);
    expect(printedNumber('١٢')).toBe(12);
    expect(printedNumber('۳۴')).toBe(34);
    for (const bad of ['', 'XII', '12a', '-1', '0', '1e3', '100001'])
      expect(printedNumber(bad), bad).toBeUndefined();
  });

  it('turns a body into a ReaderDocument with every word and no invented one', () => {
    const document = readerDocumentOf(ISSUE.body, 'FIXTURE شمارہ جنوری');
    expect(document).toEqual({
      sections: [
        {
          key: 'fixture',
          title: 'FIXTURE شمارہ جنوری',
          paragraphs: ['FIXTURE اداریہ'],
        },
        {
          key: 'fixture-2',
          title: 'FIXTURE فہرست',
          paragraphs: ['FIXTURE مضمون ایک', 'FIXTURE مضمون دو'],
        },
        {
          key: 'fixture-line-break',
          title: 'FIXTURE line break',
          paragraphs: ['FIXTURE quoted\nwords'],
        },
      ],
    });
    expect(readerDocumentSchema.safeParse(document).success).toBe(true);
    expect(readerDocumentOf(null, 'x')).toBeNull();
    expect(
      readerDocumentOf(
        [{ type: 'heading', level: 2, content: [{ text: 'Alone' }] }],
        'x',
      ),
    ).toBeNull();
  });

  it('refuses a body Library cannot hold rather than truncating it', () => {
    const long: StagedBlock[] = [
      { type: 'paragraph', content: [{ text: 'x'.repeat(8001) }] },
    ];
    expect(readerDocumentOf(long, 'Title')).toBeUndefined();
    const crowded: StagedBlock[] = Array.from({ length: 101 }, (_, index) => ({
      type: 'paragraph' as const,
      content: [{ text: `p${index}` }],
    }));
    expect(readerDocumentOf(crowded, 'Title')).toBeUndefined();
  });
});

/* ===========================================================================
 * Editorial
 * ========================================================================= */

const NEWS: StagedEditorialPayload = {
  kind: 'editorial.news',
  slug: 'fixture-n001-news',
  languageCode: 'ur',
  title: 'FIXTURE خبر',
  excerpt: '',
  body: [
    { type: 'heading', level: 2, content: [{ text: 'FIXTURE عنوان' }] },
    {
      type: 'paragraph',
      content: [
        { text: 'FIXTURE line one\nline two ' },
        { text: 'bold', bold: true },
        { text: ' and ' },
        { text: 'a link', italic: true, href: 'https://www.minhaj.org/x' },
      ],
    },
    { type: 'quote', content: [{ text: 'FIXTURE quote' }] },
    { type: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] },
    { type: 'list', ordered: true, items: [[{ text: 'first' }]] },
  ],
  publishedOn: '2019-05-06',
  legacyIdentifier: 'n001',
};

const ARTICLE: StagedEditorialPayload = {
  ...NEWS,
  kind: 'editorial.article',
  slug: 'fixture-a001-article',
  excerpt: 'FIXTURE excerpt',
};

function fakeEditorial(
  failures: Partial<
    Record<'create' | 'transition' | 'directory' | 'detail', () => Error | null>
  > = {},
) {
  const records = new Map<string, ArticleDetail & { aggregate: string }>();
  const calls: { op: string; aggregate: string; input: unknown }[] = [];
  const fail = (op: 'create' | 'transition' | 'directory' | 'detail') => {
    const failure = failures[op]?.();
    if (failure) throw failure;
  };
  const editorial = {
    async create(actor: { accountId: string }, aggregate: string, raw: unknown) {
      calls.push({ op: 'create', aggregate, input: raw });
      fail('create');
      const content = raw as ArticleDetail['revision'];
      if (
        [...records.values()].some(
          (r) => r.aggregate === aggregate && r.slug === content.slug,
        )
      )
        throw refusalError('duplicate-slug');
      const record = {
        aggregate,
        id: nextId(),
        slug: content.slug,
        state: 'draft' as const,
        version: 1,
        currentRevision: 1,
        title: content.translations[0]!.title,
        updatedAt: NOW,
        scheduledAt: null,
        scheduleStatus: null,
        creatorId: actor.accountId,
        approvedRevision: null,
        approvedById: null,
        scheduledById: null,
        scheduledRevision: null,
        revision: {
          ...content,
          // Editorial stores the document its renderer re-serialised.
          translations: content.translations.map((t) => ({
            ...t,
            ...renderEditorialDocument(t.document),
          })),
          number: 1,
          editorId: actor.accountId,
          createdAt: NOW,
        },
      };
      records.set(record.id, record);
      return record;
    },
    async transition(_actor: unknown, aggregate: string, raw: unknown) {
      const command = raw as { id: string; expectedVersion: number; action: string };
      calls.push({ op: `transition:${command.action}`, aggregate, input: raw });
      fail('transition');
      const record = records.get(command.id);
      if (!record || record.aggregate !== aggregate) throw refusalError('not-found');
      if (record.version !== command.expectedVersion) throw refusalError('conflict');
      const state =
        command.action === 'submit' && record.state === 'draft'
          ? 'in-review'
          : command.action === 'archive' && record.state !== 'archived'
            ? 'archived'
            : null;
      if (state === null) throw refusalError('invalid-state');
      const moved = { ...record, state, version: record.version + 1 } as typeof record;
      records.set(record.id, moved);
      return moved;
    },
    async directory(_actor: unknown, aggregate: string, offset: number) {
      calls.push({ op: 'directory', aggregate, input: offset });
      fail('directory');
      const all = [...records.values()]
        .filter((r) => r.aggregate === aggregate)
        .reverse();
      return {
        items: all.slice(offset, offset + 25) as EditorialSummary[],
        more: all.length > offset + 25,
      };
    },
    async detail(_actor: unknown, aggregate: string, id: string) {
      fail('detail');
      const record = records.get(id);
      if (!record || record.aggregate !== aggregate) throw refusalError('not-found');
      return record;
    },
  };
  return {
    editorial: editorial as unknown as EditorialOperations,
    records,
    calls,
    ops: () => calls.map((call) => call.op),
  };
}

const holdsNoArticle = { articleHeld: async () => false };

describe('Phase 30 Editorial publication targets', () => {
  it('serve exactly their own family', () => {
    const { editorial } = fakeEditorial();
    const news = editorialTargetOver({
      kind: 'editorial.news',
      editorial,
      holdings: holdsNoArticle,
    });
    const article = editorialTargetOver({
      kind: 'editorial.article',
      editorial,
      holdings: holdsNoArticle,
    });
    expect(news.supports('editorial.news')).toBe(true);
    expect(news.supports('editorial.article')).toBe(false);
    expect(article.supports('editorial.article')).toBe(true);
    expect(article.supports('editorial.news')).toBe(false);
  });

  it('creates and SUBMITS, reporting in-review — never approving, scheduling or publishing', async () => {
    for (const [payload, aggregate, path] of [
      [NEWS, 'news-article', `/news/${NEWS.slug}`],
      [ARTICLE, 'article', `/library/articles/${ARTICLE.slug}`],
    ] as const) {
      const fake = fakeEditorial();
      const target = editorialTargetOver({
        kind: payload.kind,
        editorial: fake.editorial,
        holdings: holdsNoArticle,
      });
      const result = await target.publish(publishInput(payload.kind, payload));
      const [record] = fake.records.values();
      expect(result).toEqual({
        status: 'published',
        target: { kind: payload.kind, id: record!.id },
        stage: 'in-review',
        version: 2,
        canonicalPath: path,
      });
      expect(record!.state).toBe('in-review');
      expect(fake.ops()).toEqual(['create', 'transition:submit']);
      expect(fake.calls.every((call) => call.aggregate === aggregate)).toBe(true);
      expect(fake.calls[0]!.input).toEqual({
        slug: payload.slug,
        primaryLanguage: 'ur',
        translations: [
          {
            languageCode: 'ur',
            title: payload.title,
            excerpt: payload.excerpt,
            seoTitle: '',
            seoDescription: '',
            document: editorialDocument(payload.body),
          },
        ],
        topicIds: [TOPIC],
        contributors: [],
        ...(payload.kind === 'editorial.news' ? { centreId: null } : {}),
      });
      // The source's date goes nowhere Editorial does not own.
      expect(JSON.stringify(fake.calls)).not.toContain('2019-05-06');
      expect(fake.calls[1]!.input).toEqual({
        id: record!.id,
        expectedVersion: 1,
        action: 'submit',
        scheduledAt: null,
        timezone: null,
      });
    }
  });

  it('builds Editorial’s own document, which Editorial’s renderer accepts as it is', () => {
    const document = editorialDocument(NEWS.body);
    expect(JSON.parse(document)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'FIXTURE عنوان' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'FIXTURE line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'a link',
              marks: [
                { type: 'italic' },
                { type: 'link', attrs: { href: 'https://www.minhaj.org/x' } },
              ],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'FIXTURE quote' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
              ],
            },
          ],
        },
      ],
    });
    const { html } = renderEditorialDocument(document);
    expect(html).toContain('FIXTURE line one<br />line two');
    expect(html).toContain('<a href="https://www.minhaj.org/x"');
    expect(html).toContain('<ol>');
    // Markup in the words is text, never markup.
    const hostile = editorialDocument([
      { type: 'paragraph', content: [{ text: '<script>alert(1)</script>' }] },
    ]);
    expect(renderEditorialDocument(hostile).html).not.toContain('<script>');
  });

  it('keeps Editorial refusals final and outages unavailable', async () => {
    for (const reason of ['denied', 'invalid']) {
      const fake = fakeEditorial({ create: () => refusalError(reason) });
      expect(
        await editorialTargetOver({
          kind: 'editorial.news',
          editorial: fake.editorial,
          holdings: holdsNoArticle,
        }).publish(publishInput('editorial.news', NEWS)),
      ).toEqual({ status: 'refused', reason });
    }
    const lost = fakeEditorial({ transition: () => outage() });
    expect(
      await editorialTargetOver({
        kind: 'editorial.news',
        editorial: lost.editorial,
        holdings: holdsNoArticle,
      }).publish(publishInput('editorial.news', NEWS)),
    ).toEqual({ status: 'unavailable' });
  });

  it('a fresh entry meeting the slug is refused; a resumed one adopts only this payload’s record', async () => {
    const fake = fakeEditorial();
    const target = editorialTargetOver({
      kind: 'editorial.news',
      editorial: fake.editorial,
      holdings: holdsNoArticle,
    });
    const first = await target.publish(publishInput('editorial.news', NEWS));
    expect(await target.publish(publishInput('editorial.news', NEWS))).toEqual({
      status: 'refused',
      reason: 'target-exists',
    });
    expect(fake.ops().filter((op) => op === 'directory')).toEqual([]);
    // In review: adopted as it is, with no second submission.
    const before = fake.calls.length;
    expect(
      await target.publish(publishInput('editorial.news', NEWS, { resumed: true })),
    ).toEqual(first);
    expect(fake.ops().slice(before)).toEqual(['create', 'directory']);
    // Another record's words under the slug: never adopted.
    expect(
      await target.publish(
        publishInput('editorial.news', { ...NEWS, title: 'OTHER' }, { resumed: true }),
      ),
    ).toEqual({ status: 'refused', reason: 'target-conflict' });
  });

  it('a resumed entry submits only the UNTOUCHED draft its creation left', async () => {
    const lost = fakeEditorial({ transition: () => outage() });
    const target = editorialTargetOver({
      kind: 'editorial.article',
      editorial: lost.editorial,
      holdings: holdsNoArticle,
    });
    expect(await target.publish(publishInput('editorial.article', ARTICLE))).toEqual({
      status: 'unavailable',
    });
    const healed = fakeEditorial();
    for (const [id, record] of lost.records) healed.records.set(id, record);
    const resumed = editorialTargetOver({
      kind: 'editorial.article',
      editorial: healed.editorial,
      holdings: holdsNoArticle,
    });
    expect(
      await resumed.publish(
        publishInput('editorial.article', ARTICLE, { resumed: true }),
      ),
    ).toMatchObject({ status: 'published', stage: 'in-review', version: 2 });
    expect(healed.ops()).toEqual(['create', 'directory', 'transition:submit']);

    // A draft a reviewer sent back (a later version) is a person's to resubmit.
    const [record] = healed.records.values();
    healed.records.set(record!.id, { ...record!, state: 'draft', version: 3 });
    expect(
      await resumed.publish(
        publishInput('editorial.article', ARTICLE, { resumed: true }),
      ),
    ).toEqual({ status: 'refused', reason: 'target-not-in-review' });
    healed.records.set(record!.id, { ...record!, state: 'published', version: 4 });
    expect(
      await resumed.publish(
        publishInput('editorial.article', ARTICLE, { resumed: true }),
      ),
    ).toEqual({ status: 'refused', reason: 'target-not-in-review' });
  });

  it('inspects, reports an Article’s holder and never a NewsArticle’s, and withdraws by archive at the version', async () => {
    const fake = fakeEditorial();
    const asked: string[] = [];
    const holdings = {
      articleHeld: async (id: string) => {
        asked.push(id);
        return true;
      },
    };
    const article = editorialTargetOver({
      kind: 'editorial.article',
      editorial: fake.editorial,
      holdings,
    });
    const news = editorialTargetOver({
      kind: 'editorial.news',
      editorial: fake.editorial,
      holdings,
    });
    const articleRef = (
      (await article.publish(publishInput('editorial.article', ARTICLE))) as {
        target: MigrationTargetRef;
      }
    ).target;
    const newsRef = (
      (await news.publish(publishInput('editorial.news', NEWS))) as {
        target: MigrationTargetRef;
      }
    ).target;
    expect(await article.inspect({ target: articleRef, actor: ACTOR })).toEqual({
      exists: true,
      version: 2,
      referencedByPeople: true,
    });
    expect(await news.inspect({ target: newsRef, actor: ACTOR })).toEqual({
      exists: true,
      version: 2,
      referencedByPeople: false,
    });
    expect(asked).toEqual([articleRef.id]);
    expect(
      await news.inspect({
        target: { kind: 'editorial.news', id: nextId() },
        actor: ACTOR,
      }),
    ).toEqual({ exists: false, version: 0, referencedByPeople: false });

    expect(
      await news.withdraw({ target: newsRef, expectedVersion: 1, actor: ACTOR }),
    ).toEqual({
      status: 'refused',
      reason: 'conflict',
    });
    expect(
      await news.withdraw({ target: newsRef, expectedVersion: 2, actor: ACTOR }),
    ).toEqual({
      status: 'withdrawn',
      version: 3,
    });
    expect(fake.calls.at(-1)).toEqual({
      op: 'transition:archive',
      aggregate: 'news-article',
      input: {
        id: newsRef.id,
        expectedVersion: 2,
        action: 'archive',
        scheduledAt: null,
        timezone: null,
      },
    });
    const denied = fakeEditorial({ transition: () => refusalError('denied') });
    expect(
      await editorialTargetOver({
        kind: 'editorial.news',
        editorial: denied.editorial,
        holdings,
      }).withdraw({ target: newsRef, expectedVersion: 2, actor: ACTOR }),
    ).toEqual({ status: 'refused', reason: 'denied' });
    // Nothing here ever approved, scheduled or published.
    expect(
      fake.ops().filter((op) => /approve|publish|schedule|reject/u.test(op)),
    ).toEqual([]);
  });

  it('answers a migrated record’s references through the owners and refuses Centre, Gallery and members', async () => {
    const asked: string[] = [];
    const references = migrationEditorialReferences({
      validPeople: async (ids) => (asked.push(`people:${ids.length}`), true),
      validTopics: async (ids) => (asked.push(`topics:${ids.length}`), true),
      validLanguage: async (code) => (asked.push(`language:${code}`), code !== 'xx'),
    });
    expect(await references.validContributors([])).toBe(true);
    expect(await references.validTopics([TOPIC])).toBe(true);
    expect(await references.validLanguages(['ur'])).toBe(true);
    expect(await references.validLanguages(['ur', 'xx'])).toBe(false);
    expect(await references.selectableCentre(TOPIC)).toBe(false);
    expect(await references.selectableGallery(TOPIC)).toBe(false);
    expect(await references.selectableMembers([])).toBe(false);
    expect(asked).toEqual([
      'people:0',
      'topics:1',
      'language:ur',
      'language:ur',
      'language:xx',
    ]);
  });
});

/* ===========================================================================
 * The router
 * ========================================================================= */

function claiming(kinds: readonly MigrationContentKind[]) {
  const asked: string[] = [];
  const target: MigrationPublicationTargetPort = {
    supports: (kind) => kinds.includes(kind),
    async publish(input) {
      asked.push(`publish:${input.kind}`);
      return {
        status: 'published',
        target: { kind: input.kind, id: nextId() },
        stage: 'public',
        version: 1,
        canonicalPath: '/x',
      };
    },
    async inspect(input) {
      asked.push(`inspect:${input.target.kind}`);
      return { exists: true, version: 1, referencedByPeople: false };
    },
    async withdraw(input) {
      asked.push(`withdraw:${input.target.kind}`);
      return { status: 'withdrawn', version: 2 };
    },
  };
  return { target, asked };
}

describe('Phase 30 fail-closed target router', () => {
  it('supports a kind exactly when one target claims it, and never a review-only kind', () => {
    const greedy = claiming(['fatwa.ruling', 'quran.translation', 'library.work']);
    const router = routeMigrationTargets([greedy.target]);
    expect(router.supports('library.work')).toBe(true);
    expect(router.supports('fatwa.ruling')).toBe(false);
    expect(router.supports('quran.translation')).toBe(false);
    expect(router.supports('media.video')).toBe(false);
  });

  it('refuses composition when two targets claim one kind', () => {
    expect(() =>
      routeMigrationTargets([
        claiming(['library.work']).target,
        claiming(['library.work']).target,
      ]),
    ).toThrow(/library\.work has more than one target/u);
  });

  it('refuses an unsupported or mismatched call before any target is asked, and routes the rest', async () => {
    const work = claiming(['library.work']);
    const news = claiming(['editorial.news']);
    const router = routeMigrationTargets([work.target, news.target]);
    expect(await router.publish(publishInput('media.video', NEWS))).toEqual({
      status: 'refused',
      reason: 'unsupported-kind',
    });
    // The kind is served, but the payload is another kind's.
    expect(await router.publish(publishInput('library.work', NEWS))).toEqual({
      status: 'refused',
      reason: 'unsupported-kind',
    });
    expect(
      await router.withdraw({
        target: { kind: 'media.video', id: nextId() },
        expectedVersion: 1,
        actor: ACTOR,
      }),
    ).toEqual({ status: 'refused', reason: 'unsupported-kind' });
    expect(
      await router.inspect({
        target: { kind: 'media.video', id: nextId() },
        actor: ACTOR,
      }),
    ).toBeNull();
    expect([...work.asked, ...news.asked]).toEqual([]);

    await router.publish(publishInput('editorial.news', NEWS));
    await router.inspect({
      target: { kind: 'library.work', id: nextId() },
      actor: ACTOR,
    });
    expect(news.asked).toEqual(['publish:editorial.news']);
    expect(work.asked).toEqual(['inspect:library.work']);
  });
});
