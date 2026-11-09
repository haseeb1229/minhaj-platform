import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  memberBytes,
  verifyMember,
  zipMembers,
  type ZipMember,
} from '../../scripts/quran/zip-archive.ts';
import {
  membersBySurah,
  surahOfMember,
} from '../../scripts/quran/recitations-runtime.ts';

/**
 * Quran Part 5 — the archive reader the Irfan-ul-Quran narration import takes
 * its MP3s out of, proved on tiny archives BUILT HERE byte by byte: what it
 * lists, that it streams a member only when its local header agrees and its
 * size and CRC-32 are the directory's, and what it refuses outright. And the
 * import's own rule: exactly one `NNN. Name.mp3` per Surah.
 *
 * NOTHING HERE IS THE QURAN OR AN AUDIO FILE: members are `NON_QURAN_FIXTURE`
 * text.
 */

interface Entry {
  readonly name: string;
  readonly data: Buffer;
  readonly method?: 0 | 8;
  /** Tamper with one field of the written archive. */
  readonly crc?: number;
  readonly size?: number;
  readonly localName?: string;
  readonly flags?: number;
  readonly methodField?: number;
}

/** A one-disk ZIP of these entries, with optional tampering. */
function buildZip(
  entries: readonly Entry[],
  tamper: { readonly entriesField?: number; readonly directoryOffset?: number } = {},
): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = entry.crc ?? crc32(entry.data) >>> 0;
    const size = entry.size ?? entry.data.length;
    const name = Buffer.from(entry.name, 'latin1');
    const localName = Buffer.from(entry.localName ?? entry.name, 'latin1');
    const methodField = entry.methodField ?? method;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(methodField, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, localName, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(methodField, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += 30 + localName.length + body.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(tamper.entriesField ?? entries.length, 8);
  end.writeUInt16LE(tamper.entriesField ?? entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(tamper.directoryOffset ?? offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

let dir: string;
let counter = 0;

function write(zip: Buffer): string {
  counter += 1;
  const file = path.join(dir, `fixture-${String(counter)}.zip`);
  writeFileSync(file, zip);
  return file;
}

async function withArchive<T>(
  zip: Buffer,
  work: (handle: FileHandle, file: string) => Promise<T>,
): Promise<T> {
  const file = write(zip);
  const handle = await open(file, 'r');
  try {
    return await work(handle, file);
  } finally {
    await handle.close();
  }
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'minhaj-zip-fixture-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const TEXT = Buffer.from('NON_QURAN_FIXTURE member '.repeat(5000), 'latin1');

describe('the archive is read from its central directory', () => {
  it('lists stored and deflated members, and streams each exactly', async () => {
    const zip = buildZip([
      { name: '001. NON_QURAN_FIXTURE.mp3', data: TEXT, method: 8 },
      {
        name: '002. NON_QURAN_FIXTURE.mp3',
        data: Buffer.from('stored bytes'),
        method: 0,
      },
    ]);
    await withArchive(zip, async (handle, file) => {
      const members = await zipMembers(handle);
      expect(members.map(({ name, method, size }) => ({ name, method, size }))).toEqual([
        { name: '001. NON_QURAN_FIXTURE.mp3', method: 8, size: TEXT.length },
        { name: '002. NON_QURAN_FIXTURE.mp3', method: 0, size: 12 },
      ]);
      const [deflated, stored] = members as [ZipMember, ZipMember];
      expect((await collect(memberBytes(handle, file, deflated))).equals(TEXT)).toBe(
        true,
      );
      expect((await collect(memberBytes(handle, file, stored))).toString()).toBe(
        'stored bytes',
      );
      await expect(verifyMember(handle, file, deflated)).resolves.toBeUndefined();
    });
  });

  it.each([
    ['a wrong CRC-32', { crc: 12345 }, /CRC-32/],
    ['a declared size too small', { size: 10 }, /larger than declared/],
    ['a declared size too large', { size: TEXT.length + 1 }, /size or CRC-32/],
    ['a local header naming another file', { localName: '999. other.mp3' }, /disagrees/],
  ])('refuses to finish a member with %s', async (_label, tamper, message) => {
    const zip = buildZip([{ name: '001. NON_QURAN_FIXTURE.mp3', data: TEXT, ...tamper }]);
    await withArchive(zip, async (handle, file) => {
      const [member] = await zipMembers(handle);
      if (member === undefined) throw new Error('no member');
      await expect(verifyMember(handle, file, member)).rejects.toThrow(message);
    });
  });

  it.each([
    ['an encrypted member', [{ name: 'a.mp3', data: TEXT, flags: 1 }], {}, /encrypted/],
    [
      'an unsupported method',
      [{ name: 'a.mp3', data: TEXT, methodField: 12 }],
      {},
      /unsupported/,
    ],
    ['ZIP64 markers', [{ name: 'a.mp3', data: TEXT }], { entriesField: 0xffff }, /ZIP64/],
    [
      'a directory beyond the archive',
      [{ name: 'a.mp3', data: TEXT }],
      { directoryOffset: 0x7fffffff },
      /outside the archive/,
    ],
  ])('refuses an archive with %s', async (_label, entries, tamper, message) => {
    await withArchive(buildZip(entries as Entry[], tamper), async (handle) => {
      await expect(zipMembers(handle)).rejects.toThrow(message);
    });
  });

  it('refuses a file that is not an archive at all', async () => {
    await withArchive(Buffer.from('NON_QURAN_FIXTURE not a zip'), async (handle) => {
      await expect(zipMembers(handle)).rejects.toThrow(/no end of central directory/);
    });
  });
});

describe('the narration archive is exactly one MP3 per Surah', () => {
  const member = (name: string): ZipMember => ({
    name,
    method: 8,
    crc32: 0,
    compressedSize: 0,
    size: 0,
    headerOffset: 0,
  });
  const all = () =>
    Array.from({ length: 114 }, (_, index) =>
      member(`${String(index + 1).padStart(3, '0')}. NON_QURAN_FIXTURE.mp3`),
    );

  it.each([
    ['001. Al-Fatihah.mp3', 1],
    ["003. Aal-e-'Imran.mp3", 3],
    ['114. An-Nas.mp3', 114],
    ['000. Zero.mp3', null],
    ['115. Beyond.mp3', null],
    ['1. Short.mp3', null],
    ['001.Al-Fatihah.mp3', null],
    ['001. Al-Fatihah.wav', null],
    ['dir/001. Al-Fatihah.mp3', null],
  ])('%s is Surah %s', (name, surah) => {
    expect(surahOfMember({ name })).toBe(surah);
  });

  it('maps 114 members to their Surahs, skipping a directory entry', () => {
    const map = membersBySurah([member('Quran_mp3/'), ...all()]);
    expect(map.size).toBe(114);
    expect(map.get(36)?.name).toBe('036. NON_QURAN_FIXTURE.mp3');
  });

  it('refuses a duplicate, a gap and a stray file', () => {
    const members = all();
    expect(() => membersBySurah([...members, member('001. Again.mp3')])).toThrow(
      /one MP3 per Surah/,
    );
    expect(() => membersBySurah(members.slice(1))).toThrow(/all 114 Surahs/);
    expect(() => membersBySurah([...members, member('readme.txt')])).toThrow(
      /one MP3 per Surah/,
    );
  });
});
