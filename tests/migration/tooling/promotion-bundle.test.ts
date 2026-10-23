import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PromotionItem } from '@minhaj/contracts/migration';

import { canonicalJson } from '../../../scripts/migration/canonical-json.ts';
import {
  BUNDLE_ENTRY_FIELDS,
  BUNDLE_ITEM_FIELDS,
  BUNDLE_PROVENANCE_FIELDS,
  createBundleDestination,
} from '../../../scripts/migration/promotion-bundle.ts';

/**
 * The Phase-29 promotion destination: a checksummed bundle directory that is
 * idempotent per entry, refuses conflicting content, and has no field that
 * could carry an account, session, credential or configuration.
 */

const ENTRY_ID = '00000000-0000-4000-8000-0000000000e1';

function item(overrides: Partial<PromotionItem> = {}): PromotionItem {
  const payload = JSON.stringify({
    kind: 'media.video',
    slug: 'fixture-sample-lecture-1',
  });
  return {
    promotionEntryId: ENTRY_ID,
    manifestEntryId: '00000000-0000-4000-8000-0000000000f1',
    contentKind: 'media.video',
    payload,
    payloadChecksum: createHash('sha256').update(payload).digest('hex'),
    inputChecksum: 'a'.repeat(64),
    provenance: {
      adapterKey: 'fixture-video',
      adapterVersion: '1',
      parserKey: 'cheerio-fixture-video',
      parserVersion: '1',
      normalizerVersion: '1',
      codeRevision: 'local',
    },
    sourceKey: 'fixture-videos',
    externalKey: 'http://videos.fixture.invalid/videos/v001.html',
    canonicalPath: '/watch/videos/fixture-sample-lecture-1',
    legacyUrls: ['http://videos.fixture.invalid/videos/v001.html'],
    reviewedAt: '2026-10-20T10:00:00.000Z',
    publishedAt: '2026-10-21T10:00:00.000Z',
    ...overrides,
  };
}

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'minhaj-bundle-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const entriesDirectory = () => path.join(directory, 'entries');
const entryPath = (id = ENTRY_ID) => path.join(entriesDirectory(), `${id}.json`);

describe('the bundle schema carries content only', () => {
  it('has exactly the PromotionItem fields plus a checksum', () => {
    expect([...BUNDLE_ITEM_FIELDS].sort()).toEqual(Object.keys(item()).sort());
    expect([...BUNDLE_ENTRY_FIELDS].sort()).toEqual(
      [...Object.keys(item()), 'sha256'].sort(),
    );
  });

  it('names no account, session, credential or configuration field', () => {
    const forbidden =
      /account|session|credential|password|secret|token|cookie|config|setting|email|user|login|key$/i;
    // `sourceKey` / `externalKey` / `adapterKey` / `parserKey` are content
    // identifiers, not secrets; everything else must not look like state.
    const allowedKeys = new Set(['sourceKey', 'externalKey', 'adapterKey', 'parserKey']);
    for (const field of [...BUNDLE_ENTRY_FIELDS, ...BUNDLE_PROVENANCE_FIELDS]) {
      if (allowedKeys.has(field)) continue;
      expect(field).not.toMatch(forbidden);
    }
  });

  it('refuses an item carrying any extra field', async () => {
    const bundle = createBundleDestination(directory);
    const smuggled = {
      ...item(),
      accountId: 'x',
      sessionToken: 'sentinel',
    } as unknown as PromotionItem;
    const provenance = {
      ...item(),
      provenance: { ...item().provenance, databaseUrl: 'sentinel' },
    } as unknown as PromotionItem;

    await expect(bundle.put(smuggled)).rejects.toThrow(/schema/);
    await expect(bundle.put(provenance)).rejects.toThrow(/schema/);
  });

  it('refuses an entry id that is not an id — no path escapes the bundle', async () => {
    const bundle = createBundleDestination(directory);

    await expect(bundle.put(item({ promotionEntryId: '../../escape' }))).rejects.toThrow(
      /malformed/,
    );
    await expect(bundle.put(item({ payloadChecksum: 'not-hex' }))).rejects.toThrow(
      /malformed/,
    );
  });
});

describe('put', () => {
  it('writes one checksummed entry and names it in the destination ref', async () => {
    const bundle = createBundleDestination(directory);

    const { destinationRef } = await bundle.put(item());

    const written = JSON.parse(readFileSync(entryPath(), 'utf8')) as Record<
      string,
      unknown
    >;
    const { sha256, ...fields } = written;
    expect(Object.keys(written).sort()).toEqual([...BUNDLE_ENTRY_FIELDS].sort());
    expect(fields).toEqual(item());
    expect(sha256).toBe(createHash('sha256').update(canonicalJson(fields)).digest('hex'));
    expect(destinationRef).toBe(`bundle:${ENTRY_ID}:${String(sha256)}`);
    expect(bundle.destination).toBe('bundle');
  });

  it('is idempotent: a resumed put adopts the identical entry', async () => {
    const bundle = createBundleDestination(directory);

    const first = await bundle.put(item());
    const second = await createBundleDestination(directory).put(item());

    expect(second).toEqual(first);
    expect(readdirSync(entriesDirectory())).toEqual([`${ENTRY_ID}.json`]);
  });

  it('never overwrites a different entry under the same id', async () => {
    const bundle = createBundleDestination(directory);
    await bundle.put(item());
    const original = readFileSync(entryPath(), 'utf8');

    await expect(
      bundle.put(item({ canonicalPath: '/watch/videos/something-else' })),
    ).rejects.toThrow(/conflict/);
    expect(readFileSync(entryPath(), 'utf8')).toBe(original);
    expect(readdirSync(entriesDirectory())).toEqual([`${ENTRY_ID}.json`]);
  });

  it('settles concurrent identical puts on one entry', async () => {
    const bundle = createBundleDestination(directory);

    const refs = await Promise.all([
      bundle.put(item()),
      bundle.put(item()),
      bundle.put(item()),
    ]);

    expect(new Set(refs.map((ref) => ref.destinationRef)).size).toBe(1);
    expect(readdirSync(entriesDirectory())).toEqual([`${ENTRY_ID}.json`]);
  });
});

describe('the manifest', () => {
  const promotionId = '00000000-0000-4000-8000-0000000000d1';
  const secondId = '00000000-0000-4000-8000-0000000000e2';

  it('lists every verified entry with its checksum', async () => {
    const bundle = createBundleDestination(directory);
    const a = await bundle.put(item());
    const b = await bundle.put(item({ promotionEntryId: secondId }));

    const manifest = await bundle.writeManifest({ promotionId });

    expect(manifest.entries).toEqual([
      { promotionEntryId: ENTRY_ID, sha256: a.destinationRef.split(':')[2] },
      { promotionEntryId: secondId, sha256: b.destinationRef.split(':')[2] },
    ]);
    expect(
      JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')),
    ).toEqual(manifest);
  });

  it('refuses a bundle whose entry was altered after it was written', async () => {
    const bundle = createBundleDestination(directory);
    await bundle.put(item());
    const tampered = JSON.parse(readFileSync(entryPath(), 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      entryPath(),
      JSON.stringify({ ...tampered, canonicalPath: '/watch/videos/tampered' }),
    );

    await expect(bundle.writeManifest({ promotionId })).rejects.toThrow(/verification/);
  });
});
