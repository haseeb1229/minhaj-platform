import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AssetPersistencePort,
  AssetRecord,
  AssetAuthorizationPort,
} from '../../packages/contracts/src/platform/storage.ts';
import { createClamAvScanner } from '../../packages/storage/src/scanner.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';

/**
 * The REAL malware scanner.
 *
 * SECURITY_BASELINE.md §10.1 rule 4 makes scanning part of the design, and a
 * fake scanner cannot evidence that scanning works — it evidences only that
 * the fake agrees with the code that calls it. This file talks to an actual
 * clamd and proves it DETECTS something.
 *
 * NO REAL MALWARE IS USED OR DISTRIBUTED. The detection fixture is EICAR: a
 * 68-byte printable ASCII string, published by the European Institute for
 * Computer Antivirus Research precisely so that scanners can be tested without
 * anybody handling a live sample. It is inert — it is not executable code and
 * does nothing if run — and every mainstream engine ships a signature for it.
 *
 * The string is ASSEMBLED FROM FRAGMENTS at runtime rather than written as one
 * literal, so that this repository does not itself contain a file that every
 * scanner on every developer machine and CI runner will quarantine.
 */

/** Set by the CI job and by the developer running the local Compose stack. */
const HOST = process.env['CLAMAV_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['CLAMAV_PORT'] ?? 3310);

/**
 * Is a clamd genuinely listening and ready?
 *
 * Probed with PING/PONG, which clamd answers only once its signature database
 * is loaded. A TCP connect alone would succeed against a daemon that is up but
 * still loading, and the first scan would then fail for a reason that has
 * nothing to do with the code under test.
 */
async function scannerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port: PORT });
    let reply = '';
    const settle = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(10_000);
    socket.on('timeout', () => settle(false));
    socket.on('error', () => settle(false));
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
      if (reply.includes('PONG')) settle(true);
    });
    socket.on('close', () => settle(reply.includes('PONG')));
  });
}

const READY = await scannerReady();

/**
 * Skipped only when no scanner exists to talk to.
 *
 * The required CI job starts clamd, so this NEVER skips there — that is what
 * makes it real proof rather than a proof that runs when convenient. A skip
 * locally means a developer has not started the Compose stack.
 */
const withScanner = READY ? describe : describe.skip;

/** EICAR, assembled at runtime. Inert, standard, not malware. */
const eicar = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',
  'STANDARD',
  'ANTIVIRUS',
  'TEST',
  'FILE!$H+H*',
].join('-');

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const bytes = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

/** Metadata in memory: this file's subject is the SCANNER, not persistence. */
function memoryAssets(): AssetPersistencePort & { rows: Map<string, AssetRecord> } {
  const rows = new Map<string, AssetRecord>();
  const now = () => new Date();

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
        createdAt: now(),
        updatedAt: now(),
      });
    },
    async quarantine(input) {
      const row = rows.get(input.id);
      if (!row || row.state !== 'uploading') return;
      rows.set(input.id, { ...row, ...input, state: 'quarantined', updatedAt: now() });
    },
    async clear(input) {
      const row = rows.get(input.id);
      if (!row || row.state !== 'quarantined' || row.checksum !== input.checksum)
        return false;
      rows.set(input.id, { ...row, state: 'clean', updatedAt: now() });
      return true;
    },
    async reject(input) {
      const row = rows.get(input.id);
      if (!row) return;
      rows.set(input.id, {
        ...row,
        state: 'rejected',
        rejection: input.rejection,
        updatedAt: now(),
      });
    },
    async fail(id) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, state: 'failed', updatedAt: now() });
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
    async staleBefore() {
      return [];
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };

withScanner('Phase 7 against a real ClamAV daemon', () => {
  let directory: string;
  const scanner = createClamAvScanner({ host: HOST, port: PORT, timeoutMs: 120_000 });

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'minhaj-clamav-'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('clears a genuinely harmless file', async () => {
    const file = path.join(directory, 'clean.bin');
    await writeFile(file, Buffer.from(PNG));

    expect(await scanner.scan(file)).toEqual({ status: 'clean' });
  });

  it('DETECTS the standard test signature', async () => {
    // The load-bearing assertion of the whole phase. If this passes, the
    // scanner is genuinely inspecting content; every other scanner test in the
    // suite is about how the pipeline reacts to a verdict.
    const file = path.join(directory, 'eicar.txt');
    await writeFile(file, eicar);

    const outcome = await scanner.scan(file);

    expect(outcome.status).toBe('infected');
    if (outcome.status === 'infected') {
      expect(outcome.signature).toMatch(/EICAR|Eicar/u);
    }
  });

  /**
   * WHY THIS ASSERTS REFUSAL RATHER THAN `infected`.
   *
   * The two gates cannot both be exercised by one EICAR upload, and pretending
   * otherwise would make this test a lie:
   *
   *   - A PURE EICAR file is what clamd detects, and it has no magic number,
   *     so content sniffing refuses it as unrecognised BEFORE a scan happens.
   *   - EICAR wrapped behind a PNG or PDF header does reach the scanner, and
   *     clamd does NOT detect it there — verified against this daemon, which
   *     reports only the pure file.
   *
   * So the honest division is: that the scanner genuinely DETECTS is proven
   * directly against the port above; that the pipeline REJECTS an infected
   * verdict is proven in `service.test.ts` with a programmed verdict. This
   * test proves the remaining real path — a pure signature file, uploaded
   * through the whole pipeline against the real daemon, never becomes
   * servable and leaves no bytes behind.
   *
   * It deliberately does NOT claim that EICAR hidden behind a PNG header is
   * refused. Against this daemon it is not, because clamd does not consider it
   * a detection, and asserting otherwise would be inventing a guarantee the
   * system does not provide.
   */
  it('refuses the pure signature file before it is ever stored as clean', async () => {
    const root = path.join(directory, 'pipeline-pure');
    await mkdir(root, { recursive: true });

    const assets = memoryAssets();
    const files = await createFilesystemStore(root);
    const storage = createStorageService({
      files,
      assets,
      scanner,
      maxBytes: 1024 * 1024,
    });

    const stored = await storage.store(
      bytes(Uint8Array.from(Buffer.from(eicar, 'utf8'))),
      {
        allowedMediaTypes: ['image/png', 'application/pdf'],
        maxBytes: 1024 * 1024,
      },
    );

    // Unrecognised content is refused, and the bytes do not survive the
    // refusal. Defence in depth: the scanner is the second gate, not the only.
    expect(stored.state).toBe('rejected');
    expect(stored.rejection).toBe('unreadable');

    const record = assets.rows.get(stored.id);
    expect(await files.exists(record!.storageKey)).toBe(false);
  });

  it('clears a harmless upload end to end and serves it only with an allow', async () => {
    const root = path.join(directory, 'pipeline-clean');
    await mkdir(root, { recursive: true });

    const assets = memoryAssets();
    const files = await createFilesystemStore(root);
    const storage = createStorageService({
      files,
      assets,
      scanner,
      maxBytes: 1024 * 1024,
    });

    const stored = await storage.store(bytes(PNG), {
      allowedMediaTypes: ['image/png'],
      maxBytes: 1024 * 1024,
    });

    expect(stored.state).toBe('clean');
    expect(await storage.open(stored.id, allow)).not.toBeNull();
    expect(
      await storage.open(stored.id, { decide: () => Promise.resolve('deny') }),
    ).toBeNull();
  });

  it('never reports clean when the daemon cannot be reached', async () => {
    // The same adapter, pointed at nothing. An outage must fail closed even
    // though the code path is otherwise identical to the working one above.
    const unreachable = createClamAvScanner({ host: HOST, port: 1, timeoutMs: 3000 });
    const file = path.join(directory, 'clean.bin');

    expect(await unreachable.scan(file)).toEqual({ status: 'unavailable' });
  });
});
