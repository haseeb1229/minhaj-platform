import { describe, expect, it } from 'vitest';

import type {
  LibraryPersistencePort,
  LibraryPublicReaderPort,
} from '../../packages/contracts/src/library/index.ts';
import {
  editionInputSchema,
  libraryCoverSchema,
  magazineIssueInputSchema,
} from '../../packages/contracts/src/library/index.ts';
import {
  createLibraryCoverPolicy,
  createLibraryService,
  libraryFailure,
} from '../../apps/web/src/contexts/library/index.ts';

/**
 * Phase 30-R — Library COVERS for an Edition and a MagazineIssue, over fake
 * ports.
 *
 * Proved here: a cover is ONE typed asset reference with a bounded box; an
 * omitted cover is absent from the parsed value (so an update keeps the stored
 * one) while `null` removes it; a cover is recorded only when Storage says the
 * asset is a servable still image right now, and a service built without that
 * answer refuses every cover; and the byte policy allows exactly the recorded
 * cover of a public record.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { accountId: ID(100) };
const cover = { assetId: ID(7), width: 600, height: 900 };

const edition = (overrides: Record<string, unknown> = {}) => ({
  workId: ID(1),
  label: 'Paperback',
  languageCode: 'en',
  state: 'published',
  publisher: null,
  publicationYear: null,
  isbn: null,
  pageCount: null,
  reading: 'unavailable',
  download: 'denied',
  readableAssetId: null,
  downloadAssetId: null,
  document: null,
  ...overrides,
});

const issue = (overrides: Record<string, unknown> = {}) => ({
  slug: 'synthetic-issue',
  primaryLocale: 'en',
  state: 'published',
  labels: [{ locale: 'en', title: 'Synthetic issue', summary: '' }],
  contributors: [],
  topicIds: [],
  languageCode: 'en',
  publicationYear: null,
  publishedOn: null,
  magazineId: ID(2),
  volume: null,
  issueNumber: null,
  document: null,
  ...overrides,
});

function harness(images?: ReadonlySet<string>) {
  const saved: string[] = [];
  const persistence = new Proxy({} as LibraryPersistencePort, {
    get(_target, method: string) {
      return async () => {
        saved.push(method);
        return { saved: method };
      };
    },
  });
  const service = createLibraryService({
    persistence,
    authority: { permits: async () => true },
    references: {
      validPeople: async () => true,
      validTopics: async () => true,
      validLanguage: async () => true,
    },
    ...(images === undefined
      ? {}
      : {
          images: {
            servableImages: async (ids: readonly string[]) =>
              new Set(ids.filter((id) => images.has(id))),
          },
        }),
  });
  return { service, saved };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return libraryFailure(error);
  }
  return 'none';
}

describe('a cover as input', () => {
  it('is optional on an Edition and an issue; omitted is absent, null removes', () => {
    expect('cover' in editionInputSchema.parse(edition())).toBe(false);
    expect(editionInputSchema.parse(edition({ cover: null })).cover).toBeNull();
    expect(editionInputSchema.parse(edition({ cover })).cover).toEqual(cover);
    expect('cover' in magazineIssueInputSchema.parse(issue())).toBe(false);
    expect(magazineIssueInputSchema.parse(issue({ cover })).cover).toEqual(cover);
  });

  it('refuses a malformed asset, an unbounded box and a remote URL', () => {
    for (const bad of [
      { ...cover, assetId: 'x' },
      { ...cover, width: 0 },
      { ...cover, height: 16_385 },
      { ...cover, url: 'https://www.minhajbooks.com/images-books/x.jpg' },
    ]) {
      expect(libraryCoverSchema.safeParse(bad).success).toBe(false);
      expect(editionInputSchema.safeParse(edition({ cover: bad })).success).toBe(false);
    }
  });
});

describe('recording a cover', () => {
  it('records an Edition cover Storage serves as an image', async () => {
    const { service, saved } = harness(new Set([cover.assetId]));
    await service.saveEdition(actor, null, null, edition({ cover }));
    expect(saved).toEqual(['saveEdition']);
  });

  it('refuses an unservable cover on an Edition and on an issue, saving nothing', async () => {
    const { service, saved } = harness(new Set());
    expect(
      await failure(service.saveEdition(actor, null, null, edition({ cover }))),
    ).toBe('invalid');
    expect(
      await failure(
        service.saveScholarly(actor, 'magazine-issue', null, null, issue({ cover })),
      ),
    ).toBe('invalid');
    expect(saved).toEqual([]);
  });

  it('fails closed without the image answer, and needs none for no cover', async () => {
    const { service, saved } = harness();
    expect(
      await failure(service.saveEdition(actor, null, null, edition({ cover }))),
    ).toBe('invalid');
    await service.saveEdition(actor, null, null, edition());
    await service.saveEdition(actor, null, null, edition({ cover: null }));
    expect(saved).toEqual(['saveEdition', 'saveEdition']);
  });
});

describe('the cover byte policy', () => {
  const asset = (assetId: string, mediaType = 'image/jpeg') => ({
    assetId,
    mediaType,
    byteSize: 1,
    checksum: '0'.repeat(64),
  });
  const reader = (state: {
    work?: string;
    edition?: string;
    issue?: string;
    magazine?: string;
    cover?: string | null;
  }): Pick<LibraryPublicReaderPort, 'assetRelation' | 'issueCoverRelation'> => ({
    assetRelation: async (id) =>
      id === ID(1)
        ? {
            workState: state.work ?? 'published',
            editionState: state.edition ?? 'published',
            reading: 'unavailable',
            download: 'denied',
            readableAssetId: null,
            downloadAssetId: null,
            coverAssetId: state.cover === undefined ? ID(7) : state.cover,
          }
        : null,
    issueCoverRelation: async (id) =>
      id === ID(1)
        ? {
            issueState: state.issue ?? 'published',
            magazineState: state.magazine ?? 'published',
            coverAssetId: state.cover === undefined ? ID(7) : state.cover,
          }
        : null,
  });
  const decide = (
    r: Pick<LibraryPublicReaderPort, 'assetRelation' | 'issueCoverRelation'>,
    owner: 'edition' | 'issue',
    ownerId = ID(1),
    resolved = asset(ID(7)),
  ) =>
    createLibraryCoverPolicy({
      reader: r,
      request: { owner, ownerId, assetId: ID(7) },
    }).decide(resolved);

  it('allows the recorded cover of a public Edition and of a public issue', async () => {
    expect(await decide(reader({}), 'edition')).toBe('allow');
    expect(await decide(reader({}), 'issue')).toBe('allow');
  });

  it('allows a still-WebP cover on the same terms, and no other picture type (Phase 30-RF)', async () => {
    const webp = asset(ID(7), 'image/webp');
    expect(await decide(reader({}), 'issue', ID(1), webp)).toBe('allow');
    expect(await decide(reader({ issue: 'draft' }), 'issue', ID(1), webp)).toBe('deny');
    for (const mediaType of ['image/gif', 'image/svg+xml'])
      expect(await decide(reader({}), 'issue', ID(1), asset(ID(7), mediaType))).toBe(
        'deny',
      );
  });

  it('denies a withdrawn record or parent, another asset, another record and a non-image', async () => {
    expect(await decide(reader({ work: 'draft' }), 'edition')).toBe('deny');
    expect(await decide(reader({ edition: 'archived' }), 'edition')).toBe('deny');
    expect(await decide(reader({ issue: 'draft' }), 'issue')).toBe('deny');
    expect(await decide(reader({ magazine: 'archived' }), 'issue')).toBe('deny');
    expect(await decide(reader({ cover: ID(8) }), 'edition')).toBe('deny');
    expect(await decide(reader({ cover: null }), 'issue')).toBe('deny');
    expect(await decide(reader({}), 'edition', ID(2))).toBe('deny');
    expect(
      await decide(reader({}), 'issue', ID(1), asset(ID(7), 'application/pdf')),
    ).toBe('deny');
    expect(await decide(reader({}), 'edition', ID(1), asset(ID(8)))).toBe('deny');
  });
});
