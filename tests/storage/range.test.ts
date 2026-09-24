import { describe, expect, it } from 'vitest';

import { parseByteRange } from '../../packages/storage/src/range.ts';

/**
 * Phase 11 — the one `Range` form a media player needs (RFC 9110 §14).
 *
 * PURE, so every edge is proved without a file: a satisfiable single range is
 * partial, a well-formed range past the end is unsatisfiable, and anything
 * malformed, multipart or oversized is IGNORED — the whole file — which RFC 9110
 * permits and which is always a correct answer. None of this authorises: the
 * serving route consults it only after both owners have allowed.
 */

const SIZE = 1000;

describe('a single satisfiable range is partial', () => {
  it.each([
    ['bytes=0-99', 0, 99],
    ['bytes=100-', 100, 999],
    ['bytes=900-1999', 900, 999],
    ['bytes=-100', 900, 999],
    ['bytes=-5000', 0, 999],
    ['bytes=999-999', 999, 999],
    ['  bytes=0-0  ', 0, 0],
  ])('%s → %i–%i', (header, start, end) => {
    expect(parseByteRange(header, SIZE)).toEqual({ kind: 'partial', start, end });
  });
});

describe('a well-formed range no byte satisfies is unsatisfiable', () => {
  it.each(['bytes=1000-', 'bytes=1000-1001', 'bytes=5000-6000', 'bytes=-0'])(
    '%s',
    (header) => {
      expect(parseByteRange(header, SIZE)).toEqual({ kind: 'unsatisfiable' });
    },
  );
});

describe('anything else is ignored, and the whole file is sent', () => {
  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['another unit', 'items=0-5'],
    ['a multipart request', 'bytes=0-1,5-9'],
    ['a reversed range', 'bytes=50-10'],
    ['no positions at all', 'bytes=-'],
    ['a negative start', 'bytes=-5-10'],
    ['a non-numeric position', 'bytes=a-b'],
    ['an absurdly long position', `bytes=${'9'.repeat(40)}-`],
    ['a missing unit', '0-99'],
  ])('%s', (_label, header) => {
    expect(parseByteRange(header, SIZE)).toEqual({ kind: 'full' });
  });
});
