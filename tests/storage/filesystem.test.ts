import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ByteLimitExceeded,
  createFilesystemStore,
  type FilesystemStore,
} from '../../packages/storage/src/filesystem.ts';
import { generateStorageKey } from '../../packages/storage/src/keys.ts';

/**
 * The filesystem adapter, against a REAL filesystem in a disposable root.
 *
 * Nothing here mocks `fs`: the claims are about what actually happens on disk,
 * and a mocked filesystem would prove only that the mock agrees with itself.
 */

/**
 * Can this account create a symlink at all?
 *
 * Probed once, against a real temporary path, rather than inferred from the
 * platform name: Windows with Developer Mode enabled CAN create one, and
 * assuming otherwise would skip a proof that would have run.
 */
const CAN_CREATE_SYMLINK = ((): boolean => {
  const probe = mkdtempSync(path.join(tmpdir(), 'minhaj-symlink-probe-'));
  try {
    writeFileSync(path.join(probe, 'target'), 'x');
    symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

let root: string;
let outside: string;
let store: FilesystemStore;

beforeAll(async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'minhaj-storage-'));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  store = await createFilesystemStore(root);
});

afterAll(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

const stream = async function* (...chunks: Uint8Array[]) {
  for (const chunk of chunks) yield chunk;
};

const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

describe('writing measures exactly the bytes that landed', () => {
  it('reports the size, the checksum and a bounded prefix', async () => {
    const key = generateStorageKey();
    const body = ascii('the quick brown fox');

    const written = await store.write(key, stream(body), 1024);

    expect(written.byteSize).toBe(body.length);
    expect(written.checksum).toBe(createHash('sha256').update(body).digest('hex'));
    expect([...written.prefix]).toEqual([...body]);

    // The checksum describes what is genuinely on disk, not what was offered.
    const onDisk = await readFile(path.join(root, key));
    expect(createHash('sha256').update(onDisk).digest('hex')).toBe(written.checksum);
  });

  it('round-trips the bytes through read()', async () => {
    const key = generateStorageKey();
    await store.write(key, stream(ascii('alpha'), ascii('beta')), 1024);

    const chunks: Uint8Array[] = [];
    for await (const chunk of store.read(key)) chunks.push(chunk);

    expect(Buffer.concat(chunks).toString('utf8')).toBe('alphabeta');
  });
});

describe('the byte ceiling is enforced during the stream', () => {
  it('refuses an oversized upload and leaves nothing behind', async () => {
    const key = generateStorageKey();
    const chunk = new Uint8Array(64 * 1024);

    await expect(
      store.write(key, stream(chunk, chunk, chunk, chunk), 100 * 1024),
    ).rejects.toBeInstanceOf(ByteLimitExceeded);

    // A partial file left on disk would be exactly the orphan the ceiling
    // exists to avoid.
    expect(await store.exists(key)).toBe(false);
  });

  it('does not hold the whole upload in memory', async () => {
    const key = generateStorageKey();
    const megabyte = new Uint8Array(1024 * 1024);
    const total = 48;

    const before = process.memoryUsage().heapUsed;
    const written = await store.write(
      key,
      (async function* () {
        for (let index = 0; index < total; index++) yield megabyte;
      })(),
      64 * 1024 * 1024,
    );
    const growth = process.memoryUsage().heapUsed - before;

    expect(written.byteSize).toBe(total * 1024 * 1024);

    // 48 MiB streamed. Heap growth an order of magnitude below the payload is
    // what distinguishes streaming from buffering; a buffering implementation
    // would have to hold all 48 MiB at once.
    expect(growth).toBeLessThan(16 * 1024 * 1024);

    await store.remove(key);
  });
});

describe('nothing escapes the storage root', () => {
  it.each([
    '../escape',
    '../../escape',
    '/etc/passwd',
    'ab/cd/../../../escape',
    '..\\escape',
  ])('refuses the key %j on every operation', async (key) => {
    await expect(store.write(key, stream(ascii('x')), 1024)).rejects.toThrow(
      /storage key|storage root/u,
    );
    expect(() => store.pathOf(key)).toThrow(/storage key|storage root/u);
    await expect(store.remove(key)).rejects.toThrow(/storage key|storage root/u);
  });

  /**
   * Skipped rather than weakened where the precondition cannot be created.
   *
   * An unprivileged Windows account cannot create a symlink, so on this
   * workstation the hostile setup does not exist to test against. A test that
   * passed by never planting the link would be worse than one that says where
   * it ran. The Linux CI `Verify` job has no such restriction and executes it
   * on every push, so the escape path stays proven.
   */
  it.skipIf(!CAN_CREATE_SYMLINK)(
    'refuses to follow a symlink that points outside the root',
    async () => {
      const victim = path.join(outside, 'secret.txt');
      await writeFile(victim, 'a secret the storage layer must never serve');

      // A link planted inside the root, at a path whose SYNTAX is a perfectly
      // valid generated key. String rules alone cannot catch this one — only
      // resolving the link does.
      const key = generateStorageKey();
      const linkPath = path.join(root, key);
      await mkdir(path.dirname(linkPath), { recursive: true });
      symlinkSync(victim, linkPath, 'file');

      await expect(async () => {
        for await (const _chunk of store.read(key)) void _chunk;
      }).rejects.toThrow(/outside the root/u);

      expect(await store.exists(key)).toBe(false);

      // The file it pointed at is untouched: a refusal must not delete a victim.
      expect(readFileSync(victim, 'utf8')).toContain('a secret');
    },
  );
});

describe('integrity is verifiable after the fact', () => {
  it('accepts bytes that still match and detects every way they can stop matching', async () => {
    const key = generateStorageKey();
    const written = await store.write(key, stream(ascii('original content')), 1024);
    const expected = { byteSize: written.byteSize, checksum: written.checksum };

    expect(await store.verify(key, expected)).toBe(true);

    // Same length, different bytes — the case a size check alone would miss.
    writeFileSync(path.join(root, key), 'corrupted content');
    expect(await store.verify(key, expected)).toBe(false);

    // Truncated.
    writeFileSync(path.join(root, key), 'short');
    expect(await store.verify(key, expected)).toBe(false);

    // Gone entirely. Absence is not integrity.
    rmSync(path.join(root, key));
    expect(await store.verify(key, expected)).toBe(false);
    expect(await store.exists(key)).toBe(false);
  });

  it('reports a missing file as absent rather than throwing', async () => {
    expect(await store.exists(generateStorageKey())).toBe(false);
  });
});

describe('a byte range reads that range and nothing else (Phase 11)', () => {
  it('returns exactly the inclusive range from disk', async () => {
    const key = generateStorageKey();
    await store.write(key, stream(ascii('0123456789abcdef')), 1024);

    const chunks: Uint8Array[] = [];
    for await (const chunk of store.read(key, { start: 3, end: 7 })) chunks.push(chunk);

    expect(Buffer.concat(chunks).toString('utf8')).toBe('34567');
  });

  it('refuses a negative or reversed range instead of guessing', () => {
    const key = generateStorageKey();
    expect(() => store.read(key, { start: -1, end: 4 })).toThrow(RangeError);
    expect(() => store.read(key, { start: 5, end: 4 })).toThrow(RangeError);
    expect(() => store.read(key, { start: 0.5, end: 4 })).toThrow(RangeError);
  });
});
