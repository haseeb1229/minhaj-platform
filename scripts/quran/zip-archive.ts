import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { crc32, createInflateRaw } from 'node:zlib';

/**
 * A ZIP ARCHIVE, READ — just enough of the format to take the members out of
 * one owner-attested archive (Quran Part 5's Irfan-ul-Quran narration), with
 * no dependency: Node's own `inflateRaw` does the decompression.
 *
 * WHAT IT ADMITS, AND NOTHING ELSE. One disk, no ZIP64, no encryption, members
 * stored (0) or deflated (8) — the shape of the archive the owner attested
 * (687,598,353 bytes, 114 members). A member is located from the CENTRAL
 * directory, its local header is re-read and must agree, its bytes are
 * streamed — never held whole — and its size and CRC-32 are checked against
 * the directory as they pass. Anything else is refused, never guessed at.
 */

export interface ZipMember {
  readonly name: string;
  readonly method: 0 | 8;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Where the member's local header begins. */
  readonly headerOffset: number;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
/** The end record is 22 bytes plus a comment of at most 65,535. */
const TAIL_WINDOW = 22 + 0xffff;

async function readAt(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('zip: truncated archive');
  return buffer;
}

/** Every member of the archive, from its central directory. */
export async function zipMembers(handle: FileHandle): Promise<readonly ZipMember[]> {
  const { size } = await handle.stat();
  const window = Math.min(size, TAIL_WINDOW);
  const tail = await readAt(handle, size - window, window);
  let end = -1;
  for (let at = tail.length - 22; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('zip: no end of central directory');
  const disk = tail.readUInt16LE(end + 4);
  const directoryDisk = tail.readUInt16LE(end + 6);
  const entriesHere = tail.readUInt16LE(end + 8);
  const entries = tail.readUInt16LE(end + 10);
  const directorySize = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesHere !== entries)
    throw new Error('zip: multi-disk archives are not read');
  if (
    entries === 0xffff ||
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff
  )
    throw new Error('zip: ZIP64 archives are not read');
  if (directoryOffset + directorySize > size - window + end)
    throw new Error('zip: the central directory lies outside the archive');

  const directory = await readAt(handle, directoryOffset, directorySize);
  const members: ZipMember[] = [];
  let at = 0;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== DIRECTORY_ENTRY)
      throw new Error('zip: malformed central directory');
    const flags = directory.readUInt16LE(at + 8);
    const method = directory.readUInt16LE(at + 10);
    const crc = directory.readUInt32LE(at + 16);
    const compressedSize = directory.readUInt32LE(at + 20);
    const uncompressed = directory.readUInt32LE(at + 24);
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const headerOffset = directory.readUInt32LE(at + 42);
    if ((flags & 0x1) !== 0) throw new Error('zip: encrypted members are not read');
    if (method !== 0 && method !== 8) throw new Error('zip: unsupported compression');
    const name = directory.subarray(at + 46, at + 46 + nameLength).toString('latin1');
    members.push({
      name,
      method,
      crc32: crc,
      compressedSize,
      size: uncompressed,
      headerOffset,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

/** Where a member's data begins, after its local header agrees with the directory. */
async function dataOffset(handle: FileHandle, member: ZipMember): Promise<number> {
  const header = await readAt(handle, member.headerOffset, 30);
  if (header.readUInt32LE(0) !== LOCAL_HEADER) throw new Error('zip: bad local header');
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const name = (await readAt(handle, member.headerOffset + 30, nameLength)).toString(
    'latin1',
  );
  if (name !== member.name || header.readUInt16LE(8) !== member.method)
    throw new Error('zip: the local header disagrees with the directory');
  return member.headerOffset + 30 + nameLength + extraLength;
}

/**
 * One member's bytes, streamed and checked: the count and the CRC-32 must be
 * the directory's by the end, or the iteration throws before it completes —
 * so a consumer that stores what it is given must not keep a store whose
 * iteration threw.
 */
export async function* memberBytes(
  handle: FileHandle,
  path: string,
  member: ZipMember,
): AsyncGenerator<Uint8Array> {
  const start = await dataOffset(handle, member);
  const raw = createReadStream(path, {
    start,
    end: start + member.compressedSize - 1,
    highWaterMark: 1024 * 1024,
  });
  const source = member.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  let crc = 0;
  let count = 0;
  for await (const chunk of source as AsyncIterable<Buffer>) {
    count += chunk.length;
    if (count > member.size) throw new Error('zip: member larger than declared');
    crc = crc32(chunk, crc);
    yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  if (count !== member.size || crc >>> 0 !== member.crc32 >>> 0)
    throw new Error('zip: member failed its size or CRC-32 check');
}

/** Reads a member through to the end, checking it, and keeps nothing. */
export async function verifyMember(
  handle: FileHandle,
  path: string,
  member: ZipMember,
): Promise<void> {
  for await (const chunk of memberBytes(handle, path, member)) void chunk;
}
