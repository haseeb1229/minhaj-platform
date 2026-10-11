import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLLECTION_LIMITS,
  COLLECTION_MAX_OFFSET,
  COLLECTION_MEMBER_CHOICES,
  COLLECTION_MEMBER_KINDS,
  COLLECTION_PAGE,
  COLLECTION_PREVIEW,
  NEWS_KINDS,
  collectionMemberPathOf,
  collectionMemberSchema,
  collectionMembersSchema,
  collectionPathOf,
  editorialContentSchemaFor,
  editorialKindSchema,
  isEditorialMemberKind,
  memberOfToken,
  memberToken,
  newsPathOf,
  type CollectionMember,
  type CollectionMemberKind,
  type EditorialMemberKind,
  type EditorialPublicReaderPort,
} from '../../packages/contracts/src/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';

/**
 * Phase 15 — a Collection's content contract, the public read service's own
 * rules and the Layer-4 member resolver, without a database: exactly which
 * types may be members, the one ordered bounded list, the form-field token, the
 * owners' canonical addresses, that a Collection's content is strict and no
 * other family accepts members, and that one owner failing degrades only its
 * own members. The same rules against real SQL Server are in
 * `collections.integration.test.ts`.
 */

/* ---- The Layer-4 resolver's three public read runtimes, replaced ---------- */

const owners = vi.hoisted(() => ({
  editorial: vi.fn(),
  editorialChoices: vi.fn(),
  works: vi.fn(),
  workChoices: vi.fn(),
  videos: vi.fn(),
  videoChoices: vi.fn(),
}));

vi.mock('../../apps/web/src/composition/editorial-read.ts', () => ({
  editorialReadRuntime: () => ({
    memberTargets: owners.editorial,
    memberChoices: owners.editorialChoices,
  }),
}));
vi.mock('../../apps/web/src/composition/library-read.ts', () => ({
  libraryReadRuntime: () => ({
    workReferences: owners.works,
    workChoices: owners.workChoices,
  }),
}));
vi.mock('../../apps/web/src/composition/media-read.ts', () => ({
  mediaReadRuntime: () => ({
    videoReferences: owners.videos,
    videoChoices: owners.videoChoices,
  }),
}));

const { resolveCollectionMembers, collectionMemberChoices } =
  await import('../../apps/web/src/composition/collection-members.ts');

/* ---- Content ---------------------------------------------------------------- */

const SEVEN = [
  'article',
  'news-article',
  'press-release',
  'statement',
  'media-coverage',
  'work',
  'video',
] as const;

const document = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
const member = (kind: CollectionMemberKind): CollectionMember => ({
  kind,
  id: randomUUID(),
});
const base = (members: readonly CollectionMember[] = [member('article')]) => ({
  slug: 'synthetic-collection',
  primaryLanguage: 'en',
  translations: [
    {
      languageCode: 'en',
      title: 'Synthetic collection',
      excerpt: '',
      seoTitle: '',
      seoDescription: '',
      document,
    },
  ],
  topicIds: [] as string[],
  contributors: [] as { personId: string; role: string }[],
  members: [...members],
});
const schema = editorialContentSchemaFor('collection');

describe('the Collection member inventory', () => {
  it('is exactly the seven types the prerequisites delivered, in editor order', () => {
    expect([...COLLECTION_MEMBER_KINDS]).toEqual([...SEVEN]);
    expect(Object.isFrozen(COLLECTION_MEMBER_KINDS)).toBe(true);
    // The four News families, and only them, sit between Article and Work.
    expect(COLLECTION_MEMBER_KINDS.slice(1, 5)).toEqual([...NEWS_KINDS]);
  });

  it('refuses every type no prerequisite delivered, and every malformed member', () => {
    for (const kind of [
      'event',
      'gallery',
      'photo',
      'page',
      'edition',
      'book-translation',
      'series',
      'playlist',
      'audio-track',
      'audio-series',
      'fatwa',
      'research',
      'research-paper',
      'publication',
      'magazine',
      'magazine-issue',
      'encyclopedia',
      'quran',
      'hadith',
      'course',
      'learning-path',
      'centre',
      'person',
      'collection',
      'private-collection',
      'Article',
      'ARTICLE',
      ' article',
      '',
    ])
      expect(
        collectionMemberSchema.safeParse({ kind, id: randomUUID() }).success,
        kind,
      ).toBe(false);
    for (const kind of SEVEN)
      expect(
        collectionMemberSchema.safeParse({ kind, id: randomUUID() }).success,
        kind,
      ).toBe(true);
    for (const value of [
      { kind: 'article', id: 'not-an-id' },
      { kind: 'article', id: '' },
      { kind: 'article' },
      { id: randomUUID() },
      { kind: 'article', id: randomUUID(), position: 0 },
      { kind: 'article', id: randomUUID(), title: 'Injected' },
      { kind: 'work', id: randomUUID(), targetType: 'Work' },
      null,
      'article',
    ])
      expect(collectionMemberSchema.safeParse(value).success, JSON.stringify(value)).toBe(
        false,
      );
  });

  it('tells Editorial’s own member types from Library’s and Media’s', () => {
    expect(SEVEN.filter((kind) => isEditorialMemberKind(kind))).toEqual([
      'article',
      ...NEWS_KINDS,
    ]);
    expect(isEditorialMemberKind('work')).toBe(false);
    expect(isEditorialMemberKind('video')).toBe(false);
  });
});

describe('one ordered, bounded list of members', () => {
  it('needs one member, takes at most one hundred and keeps the order given', () => {
    expect(COLLECTION_LIMITS.members).toBe(100);
    expect(collectionMembersSchema.safeParse([]).success).toBe(false);
    const hundred = Array.from({ length: 100 }, (_, index) =>
      member(SEVEN[index % SEVEN.length] ?? 'article'),
    );
    expect(collectionMembersSchema.parse(hundred)).toEqual(hundred);
    expect(collectionMembersSchema.safeParse([...hundred, member('video')]).success).toBe(
      false,
    );
    // ONE order across every type: mixed kinds stay exactly where they were put.
    const mixed = [
      member('video'),
      member('article'),
      member('work'),
      member('statement'),
    ];
    expect(collectionMembersSchema.parse(mixed)).toEqual(mixed);
    expect(collectionMembersSchema.parse([...mixed].reverse())).toEqual(
      [...mixed].reverse(),
    );
  });

  it('holds a record once — the same type and identifier twice is refused', () => {
    const one = member('work');
    expect(collectionMembersSchema.safeParse([one, { ...one }]).success).toBe(false);
    expect(
      collectionMembersSchema.safeParse([one, member('article'), { ...one }]).success,
    ).toBe(false);
    // The same identifier under another type names another record entirely.
    expect(
      collectionMembersSchema.safeParse([one, { kind: 'video', id: one.id }]).success,
    ).toBe(true);
  });
});

describe('the form-field token', () => {
  it('round-trips every member type exactly', () => {
    for (const kind of SEVEN) {
      const value = member(kind);
      const token = memberToken(value);
      expect(token).toBe(`${kind}:${value.id}`);
      expect(memberOfToken(token)).toEqual(value);
    }
  });

  it('names no member for a malformed or unsupported token', () => {
    const id = randomUUID();
    for (const token of [
      '',
      ':',
      'article',
      'article:',
      `:${id}`,
      `event:${id}`,
      `gallery:${id}`,
      `page:${id}`,
      `edition:${id}`,
      `playlist:${id}`,
      'article:not-an-id',
      `article:${id}:extra`,
      `article::${id}`,
      ` article:${id}`,
      `article:${id} `,
      `ARTICLE:${id}`,
      `article;${id}`,
      `article/${id}`,
      id,
    ])
      expect(memberOfToken(token), token).toBeNull();
  });
});

describe('addresses are the owners’, never a second one under the Collection', () => {
  it('links each member to its owner’s canonical path', () => {
    expect(collectionMemberPathOf('article', 'a-b')).toBe('/library/articles/a-b');
    expect(collectionMemberPathOf('work', 'a-b')).toBe('/library/books/a-b');
    expect(collectionMemberPathOf('video', 'a-b')).toBe('/watch/videos/a-b');
    for (const kind of NEWS_KINDS)
      expect(collectionMemberPathOf(kind, 'a-b'), kind).toBe(newsPathOf(kind, 'a-b'));
    for (const kind of SEVEN) {
      expect(collectionMemberPathOf(kind, 'a/b?c#d'), kind).toContain('a%2Fb%3Fc%23d');
      expect(collectionMemberPathOf(kind, 'x'), kind).not.toMatch(/collections/u);
    }
  });

  it('gives the Collection its own canonical address', () => {
    expect(collectionPathOf('a-b')).toBe('/collections/a-b');
    expect(collectionPathOf('مجموعہ')).toBe(
      `/collections/${encodeURIComponent('مجموعہ')}`,
    );
    expect(collectionPathOf('a/b?c#d')).toBe('/collections/a%2Fb%3Fc%23d');
  });

  it('keeps its public bounds coherent', () => {
    expect(COLLECTION_PREVIEW).toBeLessThanOrEqual(COLLECTION_PAGE);
    expect(COLLECTION_MAX_OFFSET % COLLECTION_PAGE).toBe(0);
    expect(COLLECTION_MEMBER_CHOICES).toBeGreaterThan(0);
  });
});

describe('a Collection’s content is strict', () => {
  it('is the eighth kind of the shared workflow', () => {
    expect(editorialKindSchema.options.at(-1)).toBe('collection');
    expect(editorialKindSchema.options).toHaveLength(8);
  });

  it('accepts the shared content with its ordered members', () => {
    const members = [member('video'), member('press-release'), member('work')];
    expect(schema.parse(base(members)).members).toEqual(members);
  });

  it('requires members and refuses every field it does not own', () => {
    const { members: _members, ...withoutMembers } = base();
    expect(schema.safeParse(withoutMembers).success).toBe(false);
    expect(schema.safeParse(base([])).success).toBe(false);
    for (const extra of [
      {
        schedule: {
          timezone: 'Asia/Karachi',
          occurrences: [{ start: '2031-11-14T19:00' }],
        },
      },
      { galleryIds: [randomUUID()] },
      { galleryIds: [] },
      { centreId: randomUUID() },
      { centreId: null },
      { coverage: { outlet: 'Injected', sourceUrl: null, sourceDate: null } },
      { isFeatured: true },
      { coverImage: 'https://images.example.invalid/a.jpg' },
      { isPrivate: true },
      { ownerAccountId: randomUUID() },
      { itemCount: 1 },
    ])
      expect(
        schema.safeParse({ ...base(), ...extra }).success,
        Object.keys(extra)[0],
      ).toBe(false);
    const issuer = {
      ...base(),
      translations: base().translations.map((t) => ({ ...t, issuer: 'Injected' })),
    };
    expect(schema.safeParse(issuer).success).toBe(false);
    // A member with a smuggled title or an unsupported type fails the whole content.
    expect(
      schema.safeParse({
        ...base(),
        members: [{ ...member('article'), title: 'Injected' }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...base(), members: [{ kind: 'event', id: randomUUID() }] })
        .success,
    ).toBe(false);
    const twice = member('article');
    expect(schema.safeParse(base([twice, twice])).success).toBe(false);
  });

  it('gives no other family a members field', () => {
    for (const kind of editorialKindSchema.options.filter(
      (entry) => entry !== 'collection',
    )) {
      const content =
        kind === 'event'
          ? {
              ...base(),
              schedule: {
                timezone: 'Asia/Karachi',
                occurrences: [{ start: '2031-11-14T19:00' }],
              },
            }
          : base();
      expect(editorialContentSchemaFor(kind).safeParse(content).success, kind).toBe(
        false,
      );
    }
    // The same Article content without `members` is an Article's.
    const { members: _members, ...article } = base();
    expect(editorialContentSchemaFor('article').safeParse(article).success).toBe(true);
  });
});

describe('the public read service', () => {
  function stubReader() {
    const reader = {
      collections: vi.fn(async () => ({ items: [], more: false })),
      collectionCanonicalSlug: vi.fn(async () => 'current'),
      publicCollection: vi.fn(async () => null),
      memberTargets: vi.fn(async (_kind: EditorialMemberKind, ids: readonly string[]) =>
        ids.map((id) => ({ id, slug: `slug-${id}`, titles: [] })),
      ),
      memberChoices: vi.fn(async () => []),
    };
    return {
      reader,
      reads: createEditorialReadService(reader as unknown as EditorialPublicReaderPort),
    };
  }

  it('lists the newest published page with a bounded, validated offset', async () => {
    const { reader, reads } = stubReader();
    await reads.collections(40);
    expect(reader.collections).toHaveBeenCalledWith({
      offset: 40,
      limit: COLLECTION_PAGE,
      topicId: null,
    });
    for (const offset of [-1, 1.5, COLLECTION_MAX_OFFSET + 1, Number.NaN])
      await expect(
        async () => reads.collections(offset),
        String(offset),
      ).rejects.toThrow();
    expect(reader.collections).toHaveBeenCalledTimes(1);
  });

  it('previews a topic’s Collections, and refuses a malformed topic', async () => {
    const { reader, reads } = stubReader();
    const topicId = randomUUID();
    await reads.collectionsOnTopic(topicId);
    expect(reader.collections).toHaveBeenCalledWith({
      offset: 0,
      limit: COLLECTION_PREVIEW,
      topicId,
    });
    await expect(async () => reads.collectionsOnTopic('not-an-id')).rejects.toThrow();
    expect(reader.collections).toHaveBeenCalledTimes(1);
  });

  it('answers a slug that cannot name a Collection without asking', async () => {
    const { reader, reads } = stubReader();
    expect(await reads.collection('')).toBeNull();
    expect(await reads.collectionCanonicalSlug('x'.repeat(121))).toBeNull();
    expect(reader.publicCollection).not.toHaveBeenCalled();
    expect(reader.collectionCanonicalSlug).not.toHaveBeenCalled();
  });

  it('resolves Editorial’s OWN members with one read per type, keyed kind:id, and never a Work or Video', async () => {
    const { reader, reads } = stubReader();
    const articles = [member('article'), member('article')];
    const statement = member('statement');
    const foreign = [member('work'), member('video')];
    const targets = await reads.memberTargets([
      articles[0] as CollectionMember,
      foreign[0] as CollectionMember,
      statement,
      articles[1] as CollectionMember,
      foreign[1] as CollectionMember,
    ]);
    expect(reader.memberTargets).toHaveBeenCalledTimes(2);
    expect(reader.memberTargets.mock.calls).toEqual(
      expect.arrayContaining([
        ['article', articles.map((entry) => entry.id)],
        ['statement', [statement.id]],
      ]),
    );
    expect([...targets.keys()].sort()).toEqual(
      [...articles, statement].map((entry) => memberToken(entry)).sort(),
    );
    for (const entry of foreign) expect(targets.has(memberToken(entry))).toBe(false);
    expect(await reads.memberTargets([member('work')])).toEqual(new Map());
    expect(reader.memberTargets).toHaveBeenCalledTimes(2);
  });

  it('refuses more members than one Collection holds, or a malformed one, before asking', async () => {
    const { reader, reads } = stubReader();
    const many = Array.from({ length: 101 }, () => member('article'));
    await expect(reads.memberTargets(many)).rejects.toThrow();
    await expect(
      reads.memberTargets([{ kind: 'event', id: randomUUID() } as never]),
    ).rejects.toThrow();
    await expect(
      reads.memberTargets([{ kind: 'article', id: 'not-an-id' }]),
    ).rejects.toThrow();
    expect(reader.memberTargets).not.toHaveBeenCalled();
  });

  it('offers bounded choices of Editorial’s own types only, with bounded text', async () => {
    const { reader, reads } = stubReader();
    expect(await reads.memberChoices('work' as never, 'x')).toEqual([]);
    expect(await reads.memberChoices('video' as never, 'x')).toEqual([]);
    await expect(reads.memberChoices('event' as never, 'x')).rejects.toThrow();
    expect(reader.memberChoices).not.toHaveBeenCalled();
    await reads.memberChoices('article', '  proof  ');
    await reads.memberChoices('press-release', '   ');
    await reads.memberChoices('statement', 'x'.repeat(121));
    expect(reader.memberChoices.mock.calls).toEqual([
      ['article', 'proof', COLLECTION_MEMBER_CHOICES],
      ['press-release', null, COLLECTION_MEMBER_CHOICES],
      ['statement', null, COLLECTION_MEMBER_CHOICES],
    ]);
  });
});

describe('the Layer-4 member resolver', () => {
  const reference = (id: string, title: string) => ({
    id,
    slug: `slug-${id}`,
    labels: [{ locale: 'en', title }],
  });
  const article = member('article');
  const news = member('news-article');
  const work = member('work');
  const video = member('video');
  const all = [video, article, work, news];

  beforeEach(() => {
    for (const fn of Object.values(owners)) fn.mockReset();
    owners.editorial.mockImplementation(async (members: readonly CollectionMember[]) => {
      return new Map(
        members.map((entry) => [
          memberToken(entry),
          { id: entry.id, slug: `slug-${entry.id}`, titles: [] },
        ]),
      );
    });
    owners.works.mockImplementation(async (ids: readonly string[]) =>
      ids.map((id) => reference(id, 'Synthetic work')),
    );
    owners.videos.mockImplementation(async (ids: readonly string[]) =>
      ids.map((id) => reference(id, 'Synthetic video')),
    );
  });

  it('asks each owner once, for its own members only, and keys every answer kind:id', async () => {
    const { targets, unavailable } = await resolveCollectionMembers(all);
    expect(owners.editorial).toHaveBeenCalledTimes(1);
    expect(owners.editorial).toHaveBeenCalledWith([article, news]);
    expect(owners.works).toHaveBeenCalledWith([work.id]);
    expect(owners.videos).toHaveBeenCalledWith([video.id]);
    expect([...targets.keys()].sort()).toEqual(all.map(memberToken).sort());
    expect(targets.get(memberToken(work))).toEqual({
      id: work.id,
      slug: `slug-${work.id}`,
      titles: [{ languageCode: 'en', title: 'Synthetic work' }],
    });
    expect(unavailable.size).toBe(0);
  });

  it('asks no owner that holds none of the members', async () => {
    await resolveCollectionMembers([work]);
    expect(owners.editorial).not.toHaveBeenCalled();
    expect(owners.videos).not.toHaveBeenCalled();
    expect(owners.works).toHaveBeenCalledTimes(1);
  });

  it('omits a member its owner does not describe now, inventing nothing', async () => {
    owners.works.mockResolvedValue([]);
    const { targets, unavailable } = await resolveCollectionMembers(all);
    expect(targets.has(memberToken(work))).toBe(false);
    expect(targets.size).toBe(3);
    // Absent is not unavailable: the owner answered.
    expect(unavailable.size).toBe(0);
  });

  it('degrades only the failing owner’s member types', async () => {
    owners.videos.mockRejectedValue(new Error('Media unavailable'));
    let resolved = await resolveCollectionMembers(all);
    expect([...resolved.unavailable]).toEqual(['video']);
    expect([...resolved.targets.keys()].sort()).toEqual(
      [article, news, work].map(memberToken).sort(),
    );

    owners.videos.mockImplementation(async (ids: readonly string[]) =>
      ids.map((id) => reference(id, 'Synthetic video')),
    );
    owners.editorial.mockRejectedValue(new Error('Editorial unavailable'));
    resolved = await resolveCollectionMembers(all);
    expect([...resolved.unavailable].sort()).toEqual(['article', 'news-article']);
    expect([...resolved.targets.keys()].sort()).toEqual(
      [work, video].map(memberToken).sort(),
    );

    owners.works.mockRejectedValue(new Error('Library unavailable'));
    resolved = await resolveCollectionMembers(all);
    expect([...resolved.unavailable].sort()).toEqual(['article', 'news-article', 'work']);
    expect([...resolved.targets.keys()]).toEqual([memberToken(video)]);
  });

  it('turns an owner failure into an error, never a “no”, when a write asks', async () => {
    owners.works.mockRejectedValue(new Error('Library unavailable'));
    await expect(resolveCollectionMembers(all, { strict: true })).rejects.toThrow(
      'Library unavailable',
    );
  });

  it('offers each owner’s bounded public choices, labelled by type', async () => {
    owners.editorialChoices.mockImplementation(async (kind: string) =>
      kind === 'statement' ? [{ id: 's', slug: 's', titles: [] }] : [],
    );
    owners.workChoices.mockResolvedValue([reference('w', 'Synthetic work')]);
    owners.videoChoices.mockResolvedValue([reference('v', 'Synthetic video')]);
    const choices = await collectionMemberChoices('  ');
    expect(choices.map((choice) => [choice.kind, choice.target.id])).toEqual([
      ['statement', 's'],
      ['work', 'w'],
      ['video', 'v'],
    ]);
    // A blank query asks for the newest, never for "  ".
    expect(owners.workChoices).toHaveBeenCalledWith(null);
    expect(owners.editorialChoices.mock.calls.map(([kind]) => kind).sort()).toEqual(
      ['article', ...NEWS_KINDS].sort(),
    );
  });
});
