import 'server-only';

/**
 * The one HTTP `Range` form a media player needs (RFC 9110 §14), and nothing
 * more.
 *
 * WHY IT EXISTS (Phase 11). A browser's `<audio>` element seeks by asking for a
 * byte range; a server that can only send the whole file makes every seek start
 * the download again. So a serving route that streams audio answers ONE
 * `bytes=` range with `206 Partial Content`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - MULTIPART RANGES. `bytes=0-99,200-299` would need a `multipart/byteranges`
 *     body; no player asks for one. RFC 9110 permits a server to ignore a Range
 *     it does not support, so such a request is answered with the whole file.
 *   - LENIENT PARSING. A malformed header, another unit, or a reversed range is
 *     IGNORED — the whole file is sent — exactly as RFC 9110 §14.2 prescribes for
 *     an invalid range set. Only a well-formed range that starts past the end is
 *     unsatisfiable (416).
 *   - `If-Range`. This platform emits no validator a client could echo, so the
 *     serving route treats any `If-Range` as a mismatch and sends the whole file,
 *     which is always a correct answer.
 *
 * NOTHING HERE AUTHORISES. The outcome is computed only after `open` has
 * released the asset, from the size Storage recorded — a range request is
 * decided exactly as a whole-file request is.
 */

export type ByteRange =
  /** Send the whole file (no Range, or one that is ignored). */
  | { readonly kind: 'full' }
  /** Send `[start, end]`, inclusive, as 206. */
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  /** A well-formed range that no byte of this file satisfies: 416. */
  | { readonly kind: 'unsatisfiable' };

/** Positions beyond this many digits are refused as malformed, not parsed. */
const MAX_DIGITS = 15;

const SINGLE = /^bytes=(\d*)-(\d*)$/u;

export function parseByteRange(header: string | null, byteSize: number): ByteRange {
  if (header === null) return { kind: 'full' };

  const match = SINGLE.exec(header.trim());
  if (match === null) return { kind: 'full' };

  const [, first = '', last = ''] = match;
  if (first.length > MAX_DIGITS || last.length > MAX_DIGITS) return { kind: 'full' };
  if (first === '' && last === '') return { kind: 'full' };

  if (first === '') {
    // A suffix range: the final `last` bytes.
    const length = Number(last);
    if (length === 0 || byteSize === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, byteSize - length), end: byteSize - 1 };
  }

  const start = Number(first);

  // A reversed range is invalid, and an invalid range is ignored. Judged on the
  // positions as WRITTEN — an open-ended range has no last position to reverse.
  if (last !== '' && Number(last) < start) return { kind: 'full' };
  if (start >= byteSize) return { kind: 'unsatisfiable' };

  const end = last === '' ? byteSize - 1 : Math.min(Number(last), byteSize - 1);
  return { kind: 'partial', start, end };
}
