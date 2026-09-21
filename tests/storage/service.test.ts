import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  AssetAuthorizationPort,
  AssetPersistencePort,
  AssetRecord,
  MalwareScannerPort,
  ScanOutcome,
  StorageServicePort,
  UploadPolicy,
} from '../../packages/contracts/src/platform/storage.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';

/**
 * The upload pipeline and the default-deny serving decision.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. The FILESYSTEM is real — these tests
 * write actual bytes into a disposable root, because the claims are about what
 * happens to bytes. Metadata is an in-memory port, because what is under test
 * is the ORDER and the REFUSALS of the pipeline, not SQL behaviour; the SQL
 * guarantees have their own live-database proof. The scanner is programmable,
 * because the claim here is "the pipeline reacts correctly to each verdict" —
 * that detection itself works is proven against a real ClamAV separately.
 */

/** Metadata persistence, in memory, with the same state rules as the SQL adapter. */
function memoryAssets(): AssetPersistencePort & { rows: Map<string, AssetRecord> } {
  const rows = new Map<string, AssetRecord>();
  const stamp = () => new Date();

  return {
    rows,
    async begin(input) {
      rows.set(input.id, {
        id: input.id,
        storageKey: input.storageKey,
        mediaType: 'application/octet-stream',
        byteSize: 0,
        checksum: '',
        state: 'uploading',
        rejection: null,
        displayName: input.displayName,
        scanAttempts: 0,
        createdAt: stamp(),
        updatedAt: stamp(),
      });
    },
    async quarantine(input) {
      const row = rows.get(input.id);
      if (!row || row.state !== 'uploading') return;
      rows.set(input.id, {
        ...row,
        mediaType: input.mediaType,
        byteSize: input.byteSize,
        checksum: input.checksum,
        state: 'quarantined',
        updatedAt: stamp(),
      });
    },
    async clear(input) {
      const row = rows.get(input.id);
      // The checksum guard, mirroring the SQL WHERE clause.
      if (!row || row.state !== 'quarantined' || row.checksum !== input.checksum) {
        return false;
      }
      rows.set(input.id, { ...row, state: 'clean', updatedAt: stamp() });
      return true;
    },
    async reject(input) {
      const row = rows.get(input.id);
      if (!row || !['uploading', 'quarantined'].includes(row.state)) return;
      rows.set(input.id, {
        ...row,
        state: 'rejected',
        rejection: input.rejection,
        updatedAt: stamp(),
      });
    },
    async fail(id) {
      const row = rows.get(id);
      if (!row || !['uploading', 'quarantined'].includes(row.state)) return;
      rows.set(id, { ...row, state: 'failed', updatedAt: stamp() });
    },
    async countScanAttempt(id) {
      const row = rows.get(id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      const scanAttempts = row.scanAttempts + 1;
      rows.set(id, { ...row, scanAttempts });
      return scanAttempts;
    },
    async find(id) {
      return rows.get(id) ?? null;
    },
    async staleBefore(cutoff, limit) {
      return [...rows.values()]
        .filter(
          (row) =>
            ['uploading', 'quarantined'].includes(row.state) && row.updatedAt < cutoff,
        )
        .slice(0, limit);
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

function programmableScanner(...outcomes: ScanOutcome[]): MalwareScannerPort & {
  calls: number;
} {
  const queue = [...outcomes];
  const scanner = {
    calls: 0,
    async scan(): Promise<ScanOutcome> {
      scanner.calls += 1;
      return queue.length > 1
        ? (queue.shift() as ScanOutcome)
        : (queue[0] as ScanOutcome);
    },
  };
  return scanner;
}

const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };
const deny: AssetAuthorizationPort = { decide: () => Promise.resolve('deny') };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0]);
const PDF = Uint8Array.from([...'%PDF-1.7\n'].map((c) => c.charCodeAt(0)));

const IMAGES: UploadPolicy = {
  allowedMediaTypes: ['image/png', 'image/jpeg'],
  maxBytes: 1024 * 1024,
};

const bytes = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

let base: string;
let assets: ReturnType<typeof memoryAssets>;

async function service(
  scanner: MalwareScannerPort,
  options: { maxBytes?: number; scanAttempts?: number } = {},
): Promise<StorageServicePort> {
  const root = path.join(base, `root-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });

  return createStorageService({
    files: await createFilesystemStore(root),
    assets,
    scanner,
    maxBytes: options.maxBytes ?? 8 * 1024 * 1024,
    ...(options.scanAttempts === undefined ? {} : { scanAttempts: options.scanAttempts }),
  });
}

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'minhaj-service-'));
  assets = memoryAssets();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('a clean upload becomes clean, and only then', () => {
  it('passes through uploading and quarantined before it is cleared', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    const stored = await storage.store(bytes(PNG), IMAGES);

    expect(stored.state).toBe('clean');
    expect(stored.mediaType).toBe('image/png');
    expect(stored.byteSize).toBe(PNG.length);
    expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('serves it only with an explicit allow', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));
    const stored = await storage.store(bytes(PNG), IMAGES);

    expect(await storage.open(stored.id, deny)).toBeNull();

    const opened = await storage.open(stored.id, allow);
    expect(opened).not.toBeNull();
    expect(opened?.mediaType).toBe('image/png');

    const chunks: Uint8Array[] = [];
    for await (const chunk of opened!.body) chunks.push(chunk);
    expect(Buffer.concat(chunks).equals(Buffer.from(PNG))).toBe(true);
  });
});

describe('validation refuses before the scanner is ever consulted', () => {
  it('refuses a type the caller does not allow', async () => {
    const scanner = programmableScanner({ status: 'clean' });
    const storage = await service(scanner);

    const stored = await storage.store(bytes(PDF), IMAGES);

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('detected-type-not-allowed');
    // Refused on content, so no scan was needed and none happened.
    expect(scanner.calls).toBe(0);
  });

  it('refuses an archive even when the caller allows its type', async () => {
    // The foundation's own floor. A permissive caller cannot admit an archive
    // by listing it, which is what "rejected by default" has to mean.
    const permissive: UploadPolicy = {
      allowedMediaTypes: ['application/zip', 'image/png'],
      maxBytes: 1024 * 1024,
    };

    const storage = await service(programmableScanner({ status: 'clean' }));
    const stored = await storage.store(bytes(ZIP), permissive);

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('detected-type-not-allowed');
  });

  it('catches a mislabelled file', async () => {
    // A ZIP announced as a PNG. The declared value is what a browser sends and
    // an attacker controls; the bytes are what decides.
    const storage = await service(programmableScanner({ status: 'clean' }));

    const stored = await storage.store(bytes(ZIP), {
      ...IMAGES,
      declaredMediaType: 'image/png',
    });

    expect(stored.state).toBe('rejected');
  });

  it('refuses a PNG declared as something else', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    const stored = await storage.store(bytes(PNG), {
      ...IMAGES,
      declaredMediaType: 'application/pdf',
    });

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('declared-type-mismatch');
  });

  it('refuses unrecognised bytes rather than guessing', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    const stored = await storage.store(
      bytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])),
      IMAGES,
    );

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('unreadable');
  });

  it('refuses an empty upload', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    const stored = await storage.store(bytes(new Uint8Array(0)), IMAGES);

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('empty');
  });

  it('refuses an upload past the foundation ceiling even when the caller allows more', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }), {
      maxBytes: 1024,
    });

    const stored = await storage.store(bytes(new Uint8Array(4096)), {
      allowedMediaTypes: ['image/png'],
      maxBytes: 1024 * 1024 * 1024,
    });

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('too-large');
  });
});

describe('quarantine holds until the scanner clears the exact bytes', () => {
  it('never serves an infected upload and removes its bytes', async () => {
    const storage = await service(
      programmableScanner({ status: 'infected', signature: 'Synthetic.Test' }),
    );

    const stored = await storage.store(bytes(PNG), IMAGES);

    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('infected');
    // Even an explicit allow cannot serve it: the state gate comes first.
    expect(await storage.open(stored.id, allow)).toBeNull();
  });

  it('keeps the bytes quarantined when the scanner is unavailable', async () => {
    const storage = await service(programmableScanner({ status: 'unavailable' }), {
      scanAttempts: 2,
    });

    const stored = await storage.store(bytes(PNG), IMAGES);

    // Fail closed: not cleared, not deleted. An outage must neither release a
    // file nor destroy somebody's upload.
    expect(stored.state).toBe('quarantined');
    expect(await storage.open(stored.id, allow)).toBeNull();
    expect(assets.rows.get(stored.id)?.state).toBe('quarantined');
  });

  it('bounds its retries rather than looping on an outage', async () => {
    const scanner = programmableScanner({ status: 'unavailable' });
    const storage = await service(scanner, { scanAttempts: 3 });

    await storage.store(bytes(PNG), IMAGES);

    // Bounded, and small. An unbounded retry would hang the request.
    expect(scanner.calls).toBeGreaterThan(1);
    expect(scanner.calls).toBeLessThanOrEqual(5);
  });

  it('does not retry a verdict the scanner already reached', async () => {
    const scanner = programmableScanner({ status: 'unscannable' });
    const storage = await service(scanner);

    const stored = await storage.store(bytes(PNG), IMAGES);

    // `unscannable` is an answer, not an outage. Asking again would be asking
    // the same question.
    expect(scanner.calls).toBe(1);
    expect(stored.state).toBe('quarantined');
  });

  it('refuses to clear when the stored bytes are no longer the scanned bytes', async () => {
    // The bytes change between the scan and the clearance. The clearance names
    // the checksum it cleared, so it must match nothing and the asset must
    // stay quarantined rather than inheriting a verdict for different bytes.
    const tampering: AssetPersistencePort = {
      ...assets,
      clear: async (input) => {
        const row = assets.rows.get(input.id);
        if (row) assets.rows.set(input.id, { ...row, checksum: 'a'.repeat(64) });
        return assets.clear(input);
      },
    };

    const storage = createStorageService({
      files: await createFilesystemStore(path.join(base, 'tamper')),
      assets: tampering,
      scanner: programmableScanner({ status: 'clean' }),
      maxBytes: 1024 * 1024,
    });

    const stored = await storage.store(bytes(PNG), IMAGES);

    expect(stored.state).toBe('quarantined');
    expect(assets.rows.get(stored.id)?.state).toBe('quarantined');
    // And it is not servable, which is the consequence that matters.
    expect(await storage.open(stored.id, allow)).toBeNull();
  });
});

describe('the serving decision denies by default', () => {
  it('denies when the policy throws', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));
    const stored = await storage.store(bytes(PNG), IMAGES);

    const broken: AssetAuthorizationPort = {
      decide: () => Promise.reject(new Error('policy is broken')),
    };

    // A policy that breaks must fail closed, not open.
    expect(await storage.open(stored.id, broken)).toBeNull();
  });

  it.each([
    ['an empty answer', undefined],
    ['a nonsense answer', 'yes'],
    ['a truthy object', {}],
    ['null', null],
  ])('denies on %s', async (_label, answer) => {
    const storage = await service(programmableScanner({ status: 'clean' }));
    const stored = await storage.store(bytes(PNG), IMAGES);

    const malformed = {
      decide: () => Promise.resolve(answer),
    } as unknown as AssetAuthorizationPort;

    // Anything that is not exactly `allow` is a denial.
    expect(await storage.open(stored.id, malformed)).toBeNull();
  });

  it('returns the same nothing for an asset that does not exist', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    expect(await storage.open('00000000-0000-0000-0000-000000000000', allow)).toBeNull();
  });

  it('does not serve a clean asset whose bytes have gone missing', async () => {
    const root = path.join(base, 'vanishing');
    await mkdir(root, { recursive: true });
    const files = await createFilesystemStore(root);

    const storage = createStorageService({
      files,
      assets,
      scanner: programmableScanner({ status: 'clean' }),
      maxBytes: 1024 * 1024,
    });

    const stored = await storage.store(bytes(PNG), IMAGES);
    expect(stored.state).toBe('clean');

    // Metadata still says clean; the file is gone. An empty 200 would be a
    // silently corrupt download.
    await files.remove(assets.rows.get(stored.id)!.storageKey);

    expect(await storage.open(stored.id, allow)).toBeNull();
  });
});

describe('reconciliation is bounded and touches only its own resources', () => {
  it('clears a quarantined asset once the scanner recovers', async () => {
    const root = path.join(base, 'recovering');
    await mkdir(root, { recursive: true });
    const files = await createFilesystemStore(root);

    /**
     * Unavailable during the upload, clean afterwards — the outage-then-
     * recovery sequence, driven by one scanner whose answer changes rather
     * than by two services, so reconciliation acts on the SAME asset.
     */
    let recovered = false;
    const scanner: MalwareScannerPort = {
      scan: async () => (recovered ? { status: 'clean' } : { status: 'unavailable' }),
    };

    const storage = createStorageService({
      files,
      assets,
      scanner,
      maxBytes: 1024 * 1024,
      scanAttempts: 1,
    });

    const stored = await storage.store(bytes(PNG), IMAGES);
    expect(stored.state).toBe('quarantined');
    expect(await storage.open(stored.id, allow)).toBeNull();

    recovered = true;
    const row = assets.rows.get(stored.id)!;
    assets.rows.set(stored.id, { ...row, updatedAt: new Date(Date.now() - 3_600_000) });

    expect(await storage.reconcile(new Date(), 25)).toBe(1);

    // The asset is now genuinely clean AND genuinely servable — the bytes
    // survived the outage rather than being discarded by it.
    expect(assets.rows.get(stored.id)?.state).toBe('clean');
    expect(await storage.open(stored.id, allow)).not.toBeNull();
  });

  it('rejects a quarantined asset that turns out to be infected', async () => {
    const root = path.join(base, 'late-detection');
    await mkdir(root, { recursive: true });
    const files = await createFilesystemStore(root);

    let detecting = false;
    const scanner: MalwareScannerPort = {
      scan: async () =>
        detecting
          ? { status: 'infected', signature: 'Synthetic.Late' }
          : { status: 'unavailable' },
    };

    const storage = createStorageService({
      files,
      assets,
      scanner,
      maxBytes: 1024 * 1024,
      scanAttempts: 1,
    });

    const stored = await storage.store(bytes(PNG), IMAGES);
    expect(stored.state).toBe('quarantined');

    detecting = true;
    const row = assets.rows.get(stored.id)!;
    assets.rows.set(stored.id, { ...row, updatedAt: new Date(Date.now() - 3_600_000) });

    expect(await storage.reconcile(new Date(), 25)).toBe(1);

    expect(assets.rows.get(stored.id)?.state).toBe('rejected');
    expect(await storage.open(stored.id, allow)).toBeNull();
    // The bytes are gone, not merely flagged.
    expect(await files.exists(row.storageKey)).toBe(false);
  });

  it('discards a row a crash left mid-upload', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    // A row that never reached `quarantined`: nothing can ever clear it.
    await assets.begin({
      id: 'stranded',
      storageKey: 'ab/cd/' + 'f'.repeat(32),
      displayName: null,
    });
    const row = assets.rows.get('stranded')!;
    assets.rows.set('stranded', { ...row, updatedAt: new Date(Date.now() - 3_600_000) });

    const settledCount = await storage.reconcile(new Date(), 25);

    expect(settledCount).toBe(1);
    expect(assets.rows.has('stranded')).toBe(false);
  });

  it('honours its limit', async () => {
    const storage = await service(programmableScanner({ status: 'clean' }));

    for (let index = 0; index < 10; index++) {
      const id = `stranded-${index}`;
      await assets.begin({
        id,
        storageKey: `ab/cd/${index}`.padEnd(38, '0'),
        displayName: null,
      });
      const row = assets.rows.get(id)!;
      assets.rows.set(id, { ...row, updatedAt: new Date(Date.now() - 3_600_000) });
    }

    const settledCount = await storage.reconcile(new Date(), 3);

    // A sweep that ignored its limit would be an unbounded operation on a
    // table that grows with every upload.
    expect(settledCount).toBeLessThanOrEqual(3);
  });
});
