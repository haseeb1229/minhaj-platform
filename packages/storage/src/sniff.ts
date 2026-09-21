import 'server-only';

/**
 * Content sniffing (SECURITY_BASELINE.md §10.1 rule 2).
 *
 * "Never trust the extension or client-supplied MIME type." What a file IS is
 * decided here, from its leading bytes, and the answer is what gets stored and
 * what later gets sent as `Content-Type`.
 *
 * WHY NO LIBRARY. The foundation recognises a SMALL, CLOSED set of formats and
 * refuses everything else, so the detector is a table of magic numbers rather
 * than a general-purpose identifier. A dependency would earn its place if the
 * requirement were "identify anything"; the requirement is the opposite —
 * admit almost nothing — and for that a reviewable table is stronger than a
 * library whose breadth is the thing we are trying not to have. When a real
 * format arrives that needs deep parsing, that phase can justify a dependency
 * with its own evidence.
 *
 * THIS IS A DETECTOR, NOT A VALIDATOR. It answers "what do these bytes look
 * like", not "are these bytes safe". Safety is quarantine plus the scanner.
 */

/** How many leading bytes the detector is allowed to look at. */
export const SNIFF_PREFIX_BYTES = 4096;

interface Signature {
  readonly mediaType: string;
  readonly offset: number;
  readonly magic: readonly number[];
  /** Extra structural check for containers whose magic alone is ambiguous. */
  readonly confirm?: (prefix: Uint8Array) => boolean;
}

const ASCII = (text: string): readonly number[] =>
  [...text].map((character) => character.charCodeAt(0));

/**
 * The closed set of recognised formats.
 *
 * ORDER MATTERS. ZIP-based formats share the `PK\x03\x04` magic, so anything
 * that must be distinguished from a bare archive is checked before it.
 */
const SIGNATURES: readonly Signature[] = Object.freeze([
  { mediaType: 'image/jpeg', offset: 0, magic: [0xff, 0xd8, 0xff] },
  {
    mediaType: 'image/png',
    offset: 0,
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mediaType: 'image/gif', offset: 0, magic: ASCII('GIF87a') },
  { mediaType: 'image/gif', offset: 0, magic: ASCII('GIF89a') },
  {
    mediaType: 'image/webp',
    offset: 0,
    magic: ASCII('RIFF'),
    confirm: (prefix) => matches(prefix, 8, ASCII('WEBP')),
  },
  { mediaType: 'application/pdf', offset: 0, magic: ASCII('%PDF-') },
  {
    mediaType: 'audio/mpeg',
    offset: 0,
    magic: ASCII('ID3'),
  },
  {
    mediaType: 'video/mp4',
    offset: 4,
    magic: ASCII('ftyp'),
  },
  /**
   * ARCHIVES AND EXECUTABLES ARE RECOGNISED ON PURPOSE.
   *
   * They are never allowed — `archiveOrExecutable` below is what the pipeline
   * consults — but recognising them produces an honest, specific refusal
   * rather than the "unknown format" a silent table would give. Knowing that
   * something IS a ZIP is also what stops a ZIP declared as an image from
   * being filed as merely unrecognised.
   */
  { mediaType: 'application/zip', offset: 0, magic: [0x50, 0x4b, 0x03, 0x04] },
  { mediaType: 'application/zip', offset: 0, magic: [0x50, 0x4b, 0x05, 0x06] },
  { mediaType: 'application/gzip', offset: 0, magic: [0x1f, 0x8b] },
  { mediaType: 'application/x-tar', offset: 257, magic: ASCII('ustar') },
  {
    mediaType: 'application/x-7z-compressed',
    offset: 0,
    magic: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  },
  { mediaType: 'application/x-rar-compressed', offset: 0, magic: ASCII('Rar!') },
  { mediaType: 'application/x-msdownload', offset: 0, magic: ASCII('MZ') },
  { mediaType: 'application/x-elf', offset: 0, magic: [0x7f, 0x45, 0x4c, 0x46] },
  { mediaType: 'application/x-mach-binary', offset: 0, magic: [0xcf, 0xfa, 0xed, 0xfe] },
  { mediaType: 'application/x-shellscript', offset: 0, magic: ASCII('#!') },
]);

/**
 * Types the foundation refuses no matter what a caller's policy allows.
 *
 * "Archives and executables rejected by default" (SECURITY_BASELINE.md §10.1
 * rule 7). A consumer may narrow what it accepts; it cannot widen past this.
 */
const NEVER_ALLOWED: ReadonlySet<string> = new Set([
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-msdownload',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-shellscript',
]);

function matches(prefix: Uint8Array, offset: number, magic: readonly number[]): boolean {
  if (prefix.length < offset + magic.length) return false;
  return magic.every((byte, index) => prefix[offset + index] === byte);
}

/**
 * The media type these bytes actually are, or `null` when unrecognised.
 *
 * A truncated file whose magic has not fully arrived returns `null` rather
 * than a guess, and `null` is refused upstream. Being unsure is a refusal,
 * never an acceptance.
 */
export function detectMediaType(prefix: Uint8Array): string | null {
  for (const signature of SIGNATURES) {
    if (!matches(prefix, signature.offset, signature.magic)) continue;
    if (signature.confirm && !signature.confirm(prefix)) continue;
    return signature.mediaType;
  }

  return null;
}

/** Is this detected type one the foundation refuses outright? */
export function archiveOrExecutable(mediaType: string): boolean {
  return NEVER_ALLOWED.has(mediaType);
}
