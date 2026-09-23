import { describe, expect, it } from 'vitest';

import type {
  LibraryAssetRelation,
  LibraryAuthorityPort,
} from '../../packages/contracts/src/library/index.ts';
import type { AssetAccessRequest } from '../../packages/contracts/src/platform/storage.ts';
import { createLibraryAssetPolicy } from '../../apps/web/src/contexts/library/application/asset-policy.ts';

/**
 * Phase 8 — Library's BUSINESS decision over its own Edition assets (§28, §45).
 *
 * This is one half of a two-owner decision. Storage's technical half — clean
 * custody, a matching checksum, bytes actually present — is proven against the
 * real service in `library.integration.test.ts`, including that a quarantined
 * asset is refused whatever this policy says. Here, the matrix of the Library
 * decision itself, with nothing but the policy and a relation.
 */

const EDITION = '00000000-0000-4000-8000-000000000e01';
const READABLE = '00000000-0000-4000-8000-000000000a01';
const DOWNLOAD = '00000000-0000-4000-8000-000000000a02';
const UNRELATED = '00000000-0000-4000-8000-000000000a99';

const PUBLIC: LibraryAssetRelation = {
  workState: 'published',
  editionState: 'published',
  reading: 'allowed',
  download: 'allowed',
  readableAssetId: READABLE,
  downloadAssetId: DOWNLOAD,
};

function asset(assetId: string): AssetAccessRequest {
  return {
    assetId,
    mediaType: 'application/pdf',
    byteSize: 10,
    checksum: 'a'.repeat(64),
  };
}

function decide(
  relation: LibraryAssetRelation | null,
  request: {
    editionId?: string;
    assetId: string;
    purpose: 'read' | 'download' | 'preview';
  },
  served: string = request.assetId,
  previewAuthority?: { accountId: string; authority: LibraryAuthorityPort },
) {
  return createLibraryAssetPolicy({
    reader: { assetRelation: async () => relation },
    request: { editionId: request.editionId ?? EDITION, ...request },
    ...(previewAuthority === undefined ? {} : { previewAuthority }),
  }).decide(asset(served));
}

describe('public reading and downloading', () => {
  it('allows the recorded readable asset of a public Edition', async () => {
    expect(await decide(PUBLIC, { assetId: READABLE, purpose: 'read' })).toBe('allow');
  });

  it('allows the recorded download asset only when download is allowed', async () => {
    expect(await decide(PUBLIC, { assetId: DOWNLOAD, purpose: 'download' })).toBe(
      'allow',
    );
    expect(
      await decide(
        { ...PUBLIC, download: 'denied' },
        { assetId: DOWNLOAD, purpose: 'download' },
      ),
    ).toBe('deny');
  });

  it('keeps reading and downloading distinct', async () => {
    // The readable file is not a download, and the download is not the readable.
    expect(await decide(PUBLIC, { assetId: READABLE, purpose: 'download' })).toBe('deny');
    expect(await decide(PUBLIC, { assetId: DOWNLOAD, purpose: 'read' })).toBe('deny');
    expect(
      await decide(
        { ...PUBLIC, reading: 'unavailable' },
        { assetId: READABLE, purpose: 'read' },
      ),
    ).toBe('deny');
  });

  it('denies every asset of a non-public Work or Edition', async () => {
    for (const relation of [
      { ...PUBLIC, workState: 'draft' },
      { ...PUBLIC, workState: 'archived' },
      { ...PUBLIC, editionState: 'draft' },
      { ...PUBLIC, editionState: 'archived' },
    ]) {
      expect(await decide(relation, { assetId: READABLE, purpose: 'read' })).toBe('deny');
      expect(await decide(relation, { assetId: DOWNLOAD, purpose: 'download' })).toBe(
        'deny',
      );
    }
  });

  it('denies a clean but UNRELATED asset — file presence grants nothing', async () => {
    expect(await decide(PUBLIC, { assetId: UNRELATED, purpose: 'read' })).toBe('deny');
    expect(await decide(PUBLIC, { assetId: UNRELATED, purpose: 'download' })).toBe(
      'deny',
    );
  });

  it('denies a stale or deleted relation', async () => {
    expect(await decide(null, { assetId: READABLE, purpose: 'read' })).toBe('deny');
    expect(
      await decide(
        { ...PUBLIC, readableAssetId: null },
        { assetId: READABLE, purpose: 'read' },
      ),
    ).toBe('deny');
  });

  it('denies when the bytes Storage is about to serve are not the requested asset', async () => {
    // A request naming the readable asset cannot be used to authorise a
    // different asset's bytes.
    expect(await decide(PUBLIC, { assetId: READABLE, purpose: 'read' }, UNRELATED)).toBe(
      'deny',
    );
  });

  it('denies malformed identifiers before any lookup', async () => {
    expect(
      await decide(PUBLIC, { editionId: '../etc', assetId: READABLE, purpose: 'read' }),
    ).toBe('deny');
    expect(
      await decide(PUBLIC, { assetId: 'not-a-uuid', purpose: 'read' }, 'not-a-uuid'),
    ).toBe('deny');
  });
});

describe('administrative preview is a distinct, live authority', () => {
  const draft = { ...PUBLIC, workState: 'draft', editionState: 'draft' };
  const holder = (granted: boolean) => ({
    accountId: 'proof-account',
    authority: { permits: async () => granted },
  });

  it('allows a recorded asset of a DRAFT Edition to a live holder of library.administer', async () => {
    expect(
      await decide(
        draft,
        { assetId: READABLE, purpose: 'preview' },
        READABLE,
        holder(true),
      ),
    ).toBe('allow');
  });

  it('denies once the permission is revoked', async () => {
    expect(
      await decide(
        draft,
        { assetId: READABLE, purpose: 'preview' },
        READABLE,
        holder(false),
      ),
    ).toBe('deny');
  });

  it('denies preview without any authority — anonymous cannot preview', async () => {
    expect(await decide(draft, { assetId: READABLE, purpose: 'preview' })).toBe('deny');
  });

  it('is not "an administrator may read anything": an unrelated asset is denied', async () => {
    expect(
      await decide(
        draft,
        { assetId: UNRELATED, purpose: 'preview' },
        UNRELATED,
        holder(true),
      ),
    ).toBe('deny');
  });

  it('asks for exactly library.administer, live, on every decision', async () => {
    const asked: string[] = [];
    await decide(draft, { assetId: READABLE, purpose: 'preview' }, READABLE, {
      accountId: 'proof-account',
      authority: {
        permits: async (_id, permission) => {
          asked.push(permission);
          return true;
        },
      },
    });
    expect(asked).toEqual(['library.administer']);
  });
});
