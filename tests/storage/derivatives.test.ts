import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DERIVATIVE_SOURCE_LIMITS,
  IMAGE_DERIVATIVE_WIDTHS,
  type AssetAuthorizationPort,
  type AssetPersistencePort,
  type AssetRecord,
  type MalwareScannerPort,
  type ScanOutcome,
  type StorageServicePort,
} from '../../packages/contracts/src/platform/storage.ts';
import { renderDerivatives } from '../../packages/storage/src/derivative.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';
import { pngChunk } from '../../packages/database/src/lifecycle/phase12-fixture.ts';

/**
 * Rebaseline R2 — Storage's WebP image derivatives.
 *
 * The FILESYSTEM and the DECODER are real: the claims are about the bytes a
 * visitor receives (their widths, their format, what metadata survives) and
 * about which bytes are ever decoded. Metadata is an in-memory port with the
 * SQL adapter's rules (`derivatives.integration.test.ts` proves the SQL half);
 * the scanner is programmable.
 */

const SENTINEL = 'R2-DERIVATIVE-GPS-SENTINEL';

/** A real JPEG of `width` × `height` carrying EXIF that names the sentinel. */
async function jpeg(width: number, height: number, orientation?: number) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 90 } },
  })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { ImageDescription: SENTINEL, Artist: SENTINEL } });
  const buffer = await (
    orientation === undefined ? image : image.withMetadata({ orientation })
  ).toBuffer();
  return new Uint8Array(buffer);
}

/** A PNG whose header declares `width` × `height` and carries no real image data. */
function declaredPng(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
      pngChunk('IEND'),
    ]),
  );
}

const has = (bytes: Uint8Array, text: string) =>
  Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));

describe('rendering derivatives', () => {
  it('renders each width no wider than the picture, as WebP, keeping its shape', async () => {
    const rendered = await renderDerivatives(
      await jpeg(1000, 500),
      DERIVATIVE_SOURCE_LIMITS,
      IMAGE_DERIVATIVE_WIDTHS,
    );
    expect(rendered?.map((entry) => entry.width)).toEqual([320, 640, 960]);
    for (const entry of rendered ?? []) {
      const facts = await sharp(entry.bytes).metadata();
      expect(facts.format).toBe('webp');
      expect(facts.width).toBe(entry.width);
      expect(facts.height).toBe(entry.width / 2);
    }
  });

  it('never enlarges: a picture narrower than every width yields none', async () => {
    expect(
      await renderDerivatives(
        await jpeg(300, 300),
        DERIVATIVE_SOURCE_LIMITS,
        IMAGE_DERIVATIVE_WIDTHS,
      ),
    ).toEqual([]);
  });

  it('measures the DISPLAYED width, orientation applied, and writes upright pixels', async () => {
    // Stored 800 × 400, displayed (EXIF orientation 6) 400 × 800.
    const rendered = await renderDerivatives(
      await jpeg(800, 400, 6),
      DERIVATIVE_SOURCE_LIMITS,
      IMAGE_DERIVATIVE_WIDTHS,
    );
    expect(rendered?.map((entry) => entry.width)).toEqual([320]);
    const facts = await sharp(rendered?.[0]?.bytes).metadata();
    expect([facts.width, facts.height]).toEqual([320, 640]);
    expect(facts.orientation).toBeUndefined();
  });

  it('strips every piece of metadata: no EXIF, no XMP, no colour profile', async () => {
    const source = await jpeg(700, 700);
    expect(has(source, SENTINEL)).toBe(true);
    const [only] =
      (await renderDerivatives(source, DERIVATIVE_SOURCE_LIMITS, [640])) ?? [];
    expect(only).toBeDefined();
    const bytes = only?.bytes ?? new Uint8Array();
    expect(has(bytes, SENTINEL)).toBe(false);
    expect(has(bytes, 'EXIF')).toBe(false);
    expect(has(bytes, 'XMP ')).toBe(false);
    expect(has(bytes, 'ICCP')).toBe(false);
    const facts = await sharp(bytes).metadata();
    expect(facts.exif).toBeUndefined();
    expect(facts.icc).toBeUndefined();
  });

  it('refuses a decompression bomb from its header, before decoding a pixel', async () => {
    // 30,000 × 30,000 declared — 900 megapixels — in a few dozen bytes.
    expect(
      await renderDerivatives(
        declaredPng(30_000, 30_000),
        DERIVATIVE_SOURCE_LIMITS,
        IMAGE_DERIVATIVE_WIDTHS,
      ),
    ).toBeNull();
    // A side beyond the edge bound is refused even within the pixel bound.
    expect(
      await renderDerivatives(
        declaredPng(20_000, 10),
        DERIVATIVE_SOURCE_LIMITS,
        IMAGE_DERIVATIVE_WIDTHS,
      ),
    ).toBeNull();
    // And the bound is the caller's: a real picture past a smaller one is refused.
    expect(
      await renderDerivatives(
        await jpeg(400, 400),
        { maxPixels: 10_000, maxEdge: 100 },
        IMAGE_DERIVATIVE_WIDTHS,
      ),
    ).toBeNull();
  });

  it('refuses bytes that are not a still JPEG, PNG or WebP', async () => {
    const gif = new Uint8Array(
      await sharp({
        create: { width: 400, height: 400, channels: 3, background: '#123456' },
      })
        .gif()
        .toBuffer(),
    );
    expect(await renderDerivatives(gif, DERIVATIVE_SOURCE_LIMITS, [320])).toBeNull();
    expect(
      await renderDerivatives(
        Uint8Array.from(Buffer.from('%PDF-1.7\n')),
        DERIVATIVE_SOURCE_LIMITS,
        [320],
      ),
    ).toBeNull();
  });
});

/* ===========================================================================
 * The service: custody, the two decisions, idempotence, release
 * ========================================================================= */

/** Asset metadata in memory, with the SQL adapter's rules — derivative links included. */
function memoryAssets(): AssetPersistencePort & {
  rows: Map<string, AssetRecord>;
  links: Map<string, { width: number; assetId: string }[]>;
  linkRace: boolean;
} {
  const rows = new Map<string, AssetRecord>();
  const digests = new Map<string, string | null>();
  const links = new Map<string, { width: number; assetId: string }[]>();
  const stamp = () => new Date();
  const update = (id: string, change: Partial<AssetRecord>) => {
    const row = rows.get(id);
    if (row !== undefined) rows.set(id, { ...row, ...change, updatedAt: stamp() });
  };
  const port = {
    rows,
    links,
    linkRace: false,
    async begin(input: {
      id: string;
      storageKey: string;
      releaseDigest?: string | null;
    }) {
      digests.set(input.id, input.releaseDigest ?? null);
      rows.set(input.id, {
        id: input.id,
        storageKey: input.storageKey,
        mediaType: 'application/octet-stream',
        byteSize: 0,
        checksum: '',
        state: 'uploading',
        rejection: null,
        displayName: null,
        scanAttempts: 0,
        createdAt: stamp(),
        updatedAt: stamp(),
      });
    },
    async quarantine(input: {
      id: string;
      mediaType: string;
      byteSize: number;
      checksum: string;
    }) {
      if (rows.get(input.id)?.state === 'uploading')
        update(input.id, { ...input, state: 'quarantined' });
    },
    async clear(input: { id: string; checksum: string }) {
      const row = rows.get(input.id);
      if (row?.state !== 'quarantined' || row.checksum !== input.checksum) return false;
      update(input.id, { state: 'clean' });
      return true;
    },
    async reject(input: { id: string; rejection: AssetRecord['rejection'] }) {
      update(input.id, { state: 'rejected', rejection: input.rejection });
    },
    async fail(id: string) {
      update(id, { state: 'failed' });
    },
    async countScanAttempt(id: string) {
      const row = rows.get(id);
      if (row === undefined) return Number.MAX_SAFE_INTEGER;
      update(id, { scanAttempts: row.scanAttempts + 1 });
      return row.scanAttempts + 1;
    },
    async find(id: string) {
      return rows.get(id) ?? null;
    },
    async findMany(ids: readonly string[]) {
      return ids.flatMap((id) => (rows.has(id) ? [rows.get(id) as AssetRecord] : []));
    },
    async staleBefore() {
      return [];
    },
    async remove(id: string) {
      rows.delete(id);
    },
    async beginRelease(releaseDigest: string) {
      const id = [...digests].find(([, digest]) => digest === releaseDigest)?.[0];
      const row = id === undefined ? undefined : rows.get(id);
      if (row === undefined) return null;
      update(row.id, { state: 'rejected', rejection: 'released' });
      return { id: row.id, storageKey: row.storageKey };
    },
    async removeReleased(id: string) {
      // A link naming it is the foreign key that refuses the delete.
      if ([...links.values()].some((set) => set.some((link) => link.assetId === id)))
        return false;
      if (rows.get(id)?.rejection === 'released') rows.delete(id);
      return true;
    },
    async derivatives(sourceAssetId: string) {
      return links.get(sourceAssetId) ?? [];
    },
    async derivative(sourceAssetId: string, width: number) {
      const link = (links.get(sourceAssetId) ?? []).find(
        (entry) => entry.width === width,
      );
      return link === undefined ? null : (rows.get(link.assetId) ?? null);
    },
    async recordDerivative(input: {
      sourceAssetId: string;
      width: number;
      assetId: string;
    }) {
      const set = links.get(input.sourceAssetId) ?? [];
      // A concurrent derivation linking the same width first.
      if (port.linkRace || set.some((entry) => entry.width === input.width)) return false;
      links.set(input.sourceAssetId, [
        ...set,
        { width: input.width, assetId: input.assetId },
      ]);
      return true;
    },
    async beginReleaseDerivatives(sourceAssetId: string) {
      return (links.get(sourceAssetId) ?? []).flatMap((link) => {
        const row = rows.get(link.assetId);
        if (row === undefined) return [];
        update(row.id, { state: 'rejected', rejection: 'released' });
        return [{ id: row.id, storageKey: row.storageKey }];
      });
    },
    async removeDerivatives(sourceAssetId: string) {
      for (const link of links.get(sourceAssetId) ?? []) {
        if (rows.get(link.assetId)?.rejection === 'released') rows.delete(link.assetId);
      }
      links.delete(sourceAssetId);
    },
  };
  return port;
}

function scanner(outcome: ScanOutcome = { status: 'clean' }): MalwareScannerPort {
  return { scan: async () => outcome };
}

const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };
const deny: AssetAuthorizationPort = { decide: () => Promise.resolve('deny') };

const one = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

async function drain(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Uint8Array.from(Buffer.concat(chunks));
}

const PHOTO_POLICY = {
  allowedMediaTypes: ['image/jpeg', 'image/png'],
  maxBytes: 4 * 1024 * 1024,
  image: { maxPixels: 40_000_000, maxEdge: 16_384 },
};

let root: string;
let assets: ReturnType<typeof memoryAssets>;

async function storage(scan = scanner()): Promise<StorageServicePort> {
  return createStorageService({
    files: await createFilesystemStore(root),
    assets,
    scanner: scan,
    maxBytes: 8 * 1024 * 1024,
  });
}

async function storedPhoto(service: StorageServicePort, width = 1000, height = 600) {
  const stored = await service.store(one(await jpeg(width, height)), PHOTO_POLICY);
  expect(stored.state).toBe('clean');
  return stored.id;
}

describe('deriving through Storage', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-derivatives-'));
    assets = memoryAssets();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('stores each width as its own clean WebP asset, linked to its source', async () => {
    const service = await storage();
    const source = await storedPhoto(service);

    expect(await service.derive(source, allow)).toEqual({
      status: 'derived',
      created: 3,
      existing: 0,
      withheld: 0,
    });
    const linked = assets.links.get(source) ?? [];
    expect(linked.map((link) => link.width).sort((a, b) => a - b)).toEqual([
      320, 640, 960,
    ]);
    for (const link of linked) {
      const record = assets.rows.get(link.assetId);
      expect(record?.state).toBe('clean');
      expect(record?.mediaType).toBe('image/webp');
      const stream = await service.openDerivative(source, link.width, allow);
      if (stream === null || stream === 'not-derived') throw new Error('not served');
      const served = await drain(stream.body);
      expect(createHash('sha256').update(served).digest('hex')).toBe(record?.checksum);
      expect((await sharp(served).metadata()).width).toBe(link.width);
      expect(has(served, SENTINEL)).toBe(false);
    }
  });

  it('is idempotent: a second derivation creates nothing', async () => {
    const service = await storage();
    const source = await storedPhoto(service);
    await service.derive(source, allow);
    const before = assets.rows.size;
    expect(await service.derive(source, allow)).toEqual({
      status: 'derived',
      created: 0,
      existing: 3,
      withheld: 0,
    });
    expect(assets.rows.size).toBe(before);
  });

  it('derives nothing the policy refuses — and decodes nothing', async () => {
    const service = await storage();
    const source = await storedPhoto(service);
    const throwing: AssetAuthorizationPort = {
      decide: () => Promise.reject(new Error('policy broke')),
    };
    const malformed = {
      decide: () => Promise.resolve('ALLOW'),
    } as unknown as AssetAuthorizationPort;
    for (const policy of [deny, throwing, malformed])
      expect(await service.derive(source, policy)).toEqual({ status: 'refused' });
    expect(assets.links.size).toBe(0);
  });

  it('derives only from a CLEAN still image whose bytes are present', async () => {
    const service = await storage(scanner({ status: 'unavailable' }));
    const quarantined = await service.store(one(await jpeg(800, 800)), PHOTO_POLICY);
    expect(quarantined.state).toBe('quarantined');
    expect(await service.derive(quarantined.id, allow)).toEqual({ status: 'refused' });

    const clean = await storage();
    const pdf = await clean.store(
      one(Uint8Array.from(Buffer.from('%PDF-1.7\n%%EOF\n'))),
      {
        allowedMediaTypes: ['application/pdf'],
        maxBytes: 1024,
      },
    );
    expect(pdf.state).toBe('clean');
    expect(await clean.derive(pdf.id, allow)).toEqual({ status: 'refused' });
    expect(await clean.derive('00000000-0000-4000-8000-000000000000', allow)).toEqual({
      status: 'refused',
    });

    const photo = await storedPhoto(clean);
    const record = assets.rows.get(photo);
    rmSync(path.join(root, ...(record?.storageKey ?? '').split('/')), { force: true });
    expect(await clean.derive(photo, allow)).toEqual({ status: 'refused' });
    expect(assets.links.size).toBe(0);
  });

  it('withholds a derivative the scanner has not cleared, and never serves it', async () => {
    const source = await storedPhoto(await storage(), 700, 700);
    const service = await storage(scanner({ status: 'unavailable' }));
    expect(await service.derive(source, allow)).toEqual({
      status: 'derived',
      created: 0,
      existing: 0,
      withheld: 2,
    });
    expect(await service.openDerivative(source, 640, allow)).toBe('not-derived');
  });

  it('serves a derivative only where its SOURCE passes both decisions', async () => {
    const service = await storage();
    const source = await storedPhoto(service);
    expect(await service.openDerivative(source, 640, allow)).toBe('not-derived');
    await service.derive(source, allow);

    expect(await service.openDerivative(source, 640, deny)).toBeNull();
    // A width that is not one Storage renders, and a width the picture lacks.
    expect(await service.openDerivative(source, 641, allow)).toBeNull();
    expect(await service.openDerivative(source, 1440, allow)).toBe('not-derived');
    // A derivative has no derivatives of its own.
    const derived = (assets.links.get(source) ?? [])[0]?.assetId ?? '';
    expect(await service.openDerivative(derived, 320, allow)).toBe('not-derived');
    // The source withdrawn from custody takes its derivatives with it at once.
    assets.rows.set(source, {
      ...(assets.rows.get(source) as AssetRecord),
      state: 'rejected',
    });
    expect(await service.openDerivative(source, 640, allow)).toBeNull();
  });

  it('a derivation that loses the race to link a width releases its own copy', async () => {
    const service = await storage();
    const source = await storedPhoto(service, 500, 500);
    assets.linkRace = true;
    const before = assets.rows.size;
    expect(await service.derive(source, allow)).toEqual({
      status: 'derived',
      created: 0,
      existing: 1,
      withheld: 0,
    });
    // The 320 copy it stored was released: no record and no bytes nobody names.
    expect(assets.rows.size).toBe(before);
  });

  it('releasing a source releases its derivatives — records and bytes', async () => {
    const service = await storage();
    const token = 'b'.repeat(64);
    const stored = await service.store(one(await jpeg(700, 400)), {
      ...PHOTO_POLICY,
      releaseToken: token,
    });
    await service.derive(stored.id, allow);
    const derived = (assets.links.get(stored.id) ?? []).map(
      (link) => assets.rows.get(link.assetId) as AssetRecord,
    );
    expect(derived).toHaveLength(2);

    expect(await service.release(token)).toBe('released');
    expect(assets.links.has(stored.id)).toBe(false);
    const files = await createFilesystemStore(root);
    for (const record of derived) {
      expect(assets.rows.has(record.id)).toBe(false);
      expect(await files.exists(record.storageKey)).toBe(false);
    }
    expect(assets.rows.has(stored.id)).toBe(false);
  });
});
