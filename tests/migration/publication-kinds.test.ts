import { describe, expect, it } from 'vitest';

import {
  createMigrationPublicationService,
  legacyUrlDigest,
  migrationFailure,
  type MigrationRefusalReason,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import {
  MIGRATION_PUBLISHABLE_KINDS,
  STAGED_PAYLOAD_SCHEMAS,
  type MigrationContentKind,
  type MigrationTargetRef,
} from '../../packages/contracts/src/migration/index.ts';
import {
  ADMIN,
  BASE,
  FakeAuthority,
  FakeStore,
  FakeTarget,
  PRIVILEGED,
  idFactory,
  sha256,
} from './fakes.ts';

/**
 * PUBLICATION OF EVERY PUBLISHABLE KIND (MIGRATION_STRATEGY.md §4.12, §6.3).
 *
 * Review-only religious material never reaches a manifest or a target; a
 * target sees only the record's rights-cleared assets; a reference resolves
 * only through an ACTIVE legacy mapping; what was made is recorded by its
 * typed target and stage, and reversed by that same reference.
 */

async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

const label = (title: string) => [{ locale: 'en', title, description: '' }];
const body = [{ type: 'paragraph', content: [{ text: 'Body' }] }];
const MAGAZINE_URL = `${BASE}magazines/mmq`;

const PAYLOADS = {
  'media.video': (slug: string) => ({
    kind: 'media.video',
    slug,
    primaryLocale: 'en',
    languageCode: 'en',
    provider: 'youtube',
    providerVideoId: 'dQw4w9WgXcQ',
    labels: label(slug),
    descriptionHtml: '',
    publishedOn: null,
    durationSeconds: null,
    legacyIdentifier: null,
  }),
  'library.work': (slug: string) => ({
    kind: 'library.work',
    slug,
    primaryLocale: 'en',
    languageCode: 'ur',
    labels: label(slug),
    legacyIdentifier: null,
    edition: {
      label: 'First edition',
      publisher: null,
      publicationYear: 2005,
      isbn: '9780306406157',
      pageCount: 320,
      readableAssetUrl: `${BASE}read/${slug}.pdf`,
      downloadAssetUrl: null,
    },
  }),
  'library.magazine': (slug: string) => ({
    kind: 'library.magazine',
    slug,
    primaryLocale: 'en',
    labels: label(slug),
    legacyIdentifier: null,
  }),
  'library.magazine-issue': (slug: string) => ({
    kind: 'library.magazine-issue',
    slug,
    primaryLocale: 'en',
    languageCode: 'ur',
    labels: label(slug),
    publishedOn: '2020-01-01',
    volume: '1',
    issueNumber: '1',
    magazine: { role: 'magazine', legacyUrl: MAGAZINE_URL },
    body,
    legacyIdentifier: null,
  }),
  'editorial.news': (slug: string) => ({
    kind: 'editorial.news',
    slug,
    languageCode: 'en',
    title: slug,
    excerpt: '',
    body,
    publishedOn: null,
    legacyIdentifier: null,
  }),
  'editorial.article': (slug: string) => ({
    kind: 'editorial.article',
    slug,
    languageCode: 'ar',
    title: slug,
    excerpt: 'Summary',
    body,
    publishedOn: null,
    legacyIdentifier: null,
  }),
  'fatwa.ruling': (slug: string) => ({
    kind: 'fatwa.ruling',
    slug,
    languageCode: 'ur',
    title: slug,
    question: body,
    answer: body,
    sourceReference: null,
    attributedTo: null,
    publishedOn: null,
    legacyIdentifier: null,
  }),
  'quran.translation': () => ({
    kind: 'quran.translation',
    work: 'A translation',
    languageCode: 'ur',
    surah: 1,
    ayat: [{ ayah: 1, text: 'One' }],
    legacyIdentifier: null,
  }),
} satisfies Record<MigrationContentKind, (slug: string) => object>;

/** A world of approved revisions, one per [kind, slug, legacy URL]. */
function world(
  items: readonly (readonly [MigrationContentKind, string, string?])[],
  kinds: readonly MigrationContentKind[] = MIGRATION_PUBLISHABLE_KINDS,
) {
  const store = new FakeStore();
  const source = store.addSource();
  const run = store.completedRun(source.id);
  const revisions = items.map(([kind, slug, url]) =>
    store.approvedRevision(
      source.id,
      run.id,
      PAYLOADS[kind](slug),
      url ?? `${BASE}items/${slug}`,
    ),
  );
  const target = new FakeTarget(new Set(kinds));
  const service = createMigrationPublicationService({
    publication: store.publicationPort,
    read: store.readPort,
    target,
    authority: new FakeAuthority(),
    ids: idFactory(8),
    clock: () => new Date(0),
  });
  const manifestOf = async (ids = revisions.map((row) => row.id)) =>
    service.createManifest(ADMIN, { runId: run.id, stagedRecordIds: ids });
  const version = (id: string) => store.manifests.get(id)!.version;
  const publish = async (manifestId: string) =>
    service.publish(PRIVILEGED, { manifestId, expectedVersion: version(manifestId) });
  return { store, source, run, revisions, target, service, manifestOf, version, publish };
}

describe('the sample payloads', () => {
  it('are each valid for their kind, so a refusal below is never a payload refusal', () => {
    for (const [kind, make] of Object.entries(PAYLOADS))
      expect(
        STAGED_PAYLOAD_SCHEMAS[kind as MigrationContentKind].safeParse(make('sample'))
          .success,
      ).toBe(true);
  });
});

describe('review-only kinds are never published', () => {
  it.each(['fatwa.ruling', 'quran.translation'] as const)(
    'a manifest refuses an approved %s, creating nothing',
    async (kind) => {
      const w = world([
        ['media.video', 'video-a'],
        [kind, 'religious'],
      ]);
      expect(await refusedWith(w.manifestOf())).toBe('review-only-kind');
      expect(w.store.manifests.size).toBe(0);
      expect(w.store.entries.size).toBe(0);
    },
  );

  it('publication refuses a review-only entry however it got there, never asking the target', async () => {
    // Even a target that claims to support it is never asked.
    const w = world(
      [
        ['media.video', 'video-a'],
        ['media.video', 'video-b'],
      ],
      [...MIGRATION_PUBLISHABLE_KINDS, 'fatwa.ruling'],
    );
    const manifest = await w.manifestOf();
    // Simulate a manifest entry whose revision is religious material.
    const smuggled = w.revisions[1]!;
    smuggled.contentKind = 'fatwa.ruling';
    smuggled.payload = JSON.stringify(PAYLOADS['fatwa.ruling']('video-b'));
    const summary = await w.publish(manifest.id);
    expect(summary).toMatchObject({ state: 'published', done: 1, refused: 1 });
    expect(
      w.store.entriesOf(manifest.id).map((entry) => [entry.state, entry.refusal]),
    ).toEqual([
      ['published', null],
      ['refused', 'review-only-kind'],
    ]);
    expect(w.target.inputs.map((input) => input.kind)).toEqual(['media.video']);
    expect(w.store.legacyMappings.size).toBe(1);
  });
});

describe('every publishable kind', () => {
  it.each(MIGRATION_PUBLISHABLE_KINDS)(
    'publishes a %s, recording its typed target, stage and mappings',
    async (kind) => {
      const w = world([[kind, 'item-one']]);
      const manifest = await w.manifestOf();
      const summary = await w.publish(manifest.id);
      expect(summary).toMatchObject({ state: 'published', done: 1, refused: 0 });
      const [input] = w.target.inputs;
      expect(input?.kind).toBe(kind);
      expect(input?.payload).toEqual(PAYLOADS[kind]('item-one'));
      const made = [...w.target.made.values()][0]!;
      const [entry] = w.store.entriesOf(manifest.id);
      expect(entry).toMatchObject({
        state: 'published',
        target: { kind, id: made.id },
        targetStage: 'public',
        targetVersion: 1,
      });
      const [mapping] = [...w.store.legacyMappings.values()];
      expect(mapping).toMatchObject({
        target: { kind, id: made.id },
        canonicalPath: entry?.canonicalPath,
        state: 'active',
      });
      expect(mapping?.digest).toBe(legacyUrlDigest(mapping!.legacyUrl));
    },
  );

  it('refuses a kind the target does not carry', async () => {
    const w = world([['editorial.news', 'news-n']], ['media.video']);
    const manifest = await w.manifestOf();
    expect(await w.publish(manifest.id)).toMatchObject({ done: 0, refused: 1 });
    expect(w.store.entriesOf(manifest.id)[0]?.refusal).toBe('no-target');
    expect(w.target.publishCalls).toBe(0);
  });

  it('refuses a payload that is not its kind’s strict payload', async () => {
    const w = world([
      ['library.work', 'work-w'],
      ['editorial.news', 'news-n'],
    ]);
    const manifest = await w.manifestOf();
    // A payload of another kind, and one with an unknown field.
    w.revisions[0]!.payload = JSON.stringify(PAYLOADS['editorial.news']('work-w'));
    w.revisions[1]!.payload = JSON.stringify({
      ...PAYLOADS['editorial.news']('news-n'),
      extra: 1,
    });
    expect(await w.publish(manifest.id)).toMatchObject({ done: 0, refused: 2 });
    expect(w.store.entriesOf(manifest.id).map((entry) => entry.refusal)).toEqual([
      'invalid-payload',
      'invalid-payload',
    ]);
    expect(w.target.publishCalls).toBe(0);
  });

  it('records a two-person domain’s in-review stage as such', async () => {
    const w = world([['editorial.article', 'article-a']]);
    w.target.stage = 'in-review';
    const manifest = await w.manifestOf();
    await w.publish(manifest.id);
    expect(w.store.entriesOf(manifest.id)[0]).toMatchObject({
      state: 'published',
      targetStage: 'in-review',
    });
  });

  it('treats a target answering with another kind as unavailable, recording nothing', async () => {
    const w = world([['library.work', 'work-w']]);
    w.target.answerKind = 'media.video';
    const manifest = await w.manifestOf();
    const summary = await w.publish(manifest.id);
    expect(summary).toMatchObject({
      state: 'publishing',
      done: 0,
      stopped: 'target-unavailable',
    });
    expect(w.store.entriesOf(manifest.id)[0]).toMatchObject({
      state: 'publishing',
      target: null,
      targetStage: null,
    });
    expect(w.store.legacyMappings.size).toBe(0);
    // A well-behaved target later adopts what it made, as a resumed entry.
    w.target.answerKind = null;
    const resumed = await w.publish(manifest.id);
    expect(resumed).toMatchObject({ state: 'published', done: 1 });
    expect(w.target.resumedFlags).toEqual([false, true]);
    expect(w.target.made.size).toBe(1);
  });
});

describe('assets handed to a target', () => {
  it('are only the record’s acquisitions a person decided public-eligible', async () => {
    const w = world([
      ['library.work', 'work-w'],
      ['library.work', 'other'],
    ]);
    const [own, other] = w.revisions.map((row) => row.recordId);
    const acquire = (
      recordId: string,
      n: number,
      visibility: 'restricted' | 'public-eligible',
    ) => {
      const key = `acq-${n}`;
      w.store.acquisitions.set(key, {
        id: key,
        sourceId: w.source.id,
        recordId,
        runId: w.run.id,
        originalUrl: `${BASE}read/${n}.pdf`,
        originalUrlDigest: sha256(`${n}`),
        assetId: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
        checksum: sha256(`bytes-${n}`),
        byteSize: 10,
        mediaType: 'application/pdf',
        licence: 'organisation-owned',
        licenceEvidence: 'owned',
        rightsHolder: 'Minhaj',
        acquiredAt: new Date(0),
        visibility,
      });
    };
    acquire(own!, 1, 'public-eligible');
    acquire(own!, 2, 'restricted');
    acquire(other!, 3, 'public-eligible');
    const manifest = await w.manifestOf();
    await w.publish(manifest.id);
    expect(w.target.inputs.map((input) => input.assets)).toEqual([
      [
        {
          originalUrl: `${BASE}read/1.pdf`,
          assetId: '00000000-0000-4000-9000-000000000001',
          mediaType: 'application/pdf',
          checksum: sha256('bytes-1'),
        },
      ],
      [
        {
          originalUrl: `${BASE}read/3.pdf`,
          assetId: '00000000-0000-4000-9000-000000000003',
          mediaType: 'application/pdf',
          checksum: sha256('bytes-3'),
        },
      ],
    ]);
  });
});

describe('references resolve only through an active mapping', () => {
  it('an issue resolves its magazine only once the magazine is published', async () => {
    const w = world([
      ['library.magazine', 'mmq', MAGAZINE_URL],
      ['library.magazine-issue', 'mmq-1'],
    ]);
    const resolved: (MigrationTargetRef | null)[] = [];
    w.target.beforePublish = async (input) => {
      if (input.payload.kind === 'library.magazine-issue')
        resolved.push(await input.resolve(input.payload.magazine.legacyUrl));
    };

    // The issue alone first: its magazine is not published, so nothing resolves.
    const issueOnly = await w.manifestOf([w.revisions[1]!.id]);
    await w.publish(issueOnly.id);
    expect(resolved).toEqual([null]);

    // A new run's manifest: the magazine first, then the issue.
    const magazineManifest = await w.manifestOf([w.revisions[0]!.id]);
    await w.publish(magazineManifest.id);
    const magazine = [...w.target.made.values()].find(
      (made) => made.kind === 'library.magazine',
    )!;
    const second = w.store.approvedRevision(
      w.source.id,
      w.run.id,
      PAYLOADS['library.magazine-issue']('mmq-2'),
      `${BASE}items/mmq-2`,
    );
    const issueManifest = await w.manifestOf([second.id]);
    await w.publish(issueManifest.id);
    expect(resolved).toEqual([null, { kind: 'library.magazine', id: magazine.id }]);
    // Resolution asks by the URL's digest — never by a guess.
    expect(w.store.calls.resolve).toBe(2);
  });

  it('a disabled or contradicted mapping resolves to nothing', async () => {
    const store = new FakeStore();
    const resolve = (url: string) =>
      store.publicationPort.resolveLegacyTarget(legacyUrlDigest(url));
    const mapping = (
      id: string,
      target: MigrationTargetRef,
      state: 'active' | 'disabled',
    ) =>
      store.legacyMappings.set(id, {
        id,
        sourceId: 's',
        recordId: 'r',
        legacyUrl: MAGAZINE_URL,
        digest: legacyUrlDigest(MAGAZINE_URL),
        target,
        canonicalPath: '/library/magazines/mmq',
        state,
        version: 1,
      });
    const one = {
      kind: 'library.magazine',
      id: '00000000-0000-4000-a000-000000000001',
    } as const;
    const two = {
      kind: 'library.magazine',
      id: '00000000-0000-4000-a000-000000000002',
    } as const;
    mapping('m1', one, 'disabled');
    expect(await resolve(MAGAZINE_URL)).toBeNull();
    mapping('m1', one, 'active');
    expect(await resolve(MAGAZINE_URL)).toEqual(one);
    mapping('m2', one, 'active');
    expect(await resolve(MAGAZINE_URL)).toEqual(one);
    mapping('m3', two, 'active');
    expect(await resolve(MAGAZINE_URL)).toBeNull();
    expect(await resolve(`${MAGAZINE_URL}/other`)).toBeNull();
  });
});

describe('rollback by typed target', () => {
  it('withdraws exactly the record each entry made', async () => {
    const w = world([
      ['library.work', 'work-w'],
      ['editorial.news', 'news-n'],
    ]);
    const manifest = await w.manifestOf();
    await w.publish(manifest.id);
    const summary = await w.service.rollback(PRIVILEGED, {
      manifestId: manifest.id,
      expectedVersion: w.version(manifest.id),
      reason: 'faulty parser',
    });
    expect(summary).toMatchObject({ state: 'rolled-back', done: 2, refused: 0 });
    expect([...w.target.made.values()].map((made) => [made.kind, made.state])).toEqual([
      ['library.work', 'archived'],
      ['editorial.news', 'archived'],
    ]);
    expect(
      [...w.store.legacyMappings.values()].every((m) => m.state === 'disabled'),
    ).toBe(true);
  });

  it('refuses — never withdraws — when the recorded target is not what the domain holds', async () => {
    const w = world([['library.work', 'work-w']]);
    const manifest = await w.manifestOf();
    await w.publish(manifest.id);
    const [entry] = w.store.entriesOf(manifest.id);
    // The same id under another kind names nothing the domain holds.
    w.store.entries.set(entry!.id, {
      ...entry!,
      target: { kind: 'media.video', id: entry!.target!.id },
    });
    const summary = await w.service.rollback(PRIVILEGED, {
      manifestId: manifest.id,
      expectedVersion: w.version(manifest.id),
      reason: 'r',
    });
    expect(summary).toMatchObject({ done: 0, refused: 1 });
    expect(w.target.withdrawCalls).toBe(0);
    expect(w.store.entriesOf(manifest.id)[0]?.state).toBe('rollback-refused');
    expect([...w.target.made.values()][0]?.state).toBe('published');
  });
});
