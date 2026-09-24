import { describe, expect, it } from 'vitest';

import {
  archiveOrExecutable,
  detectMediaType,
  SNIFF_PREFIX_BYTES,
} from '../../packages/storage/src/sniff.ts';
import { syntheticSilentMp3 } from '../../packages/database/src/lifecycle/phase11-fixture.ts';

/**
 * Content sniffing (SECURITY_BASELINE.md §10.1 rule 2).
 *
 * No religious fixture appears here, and none is needed: these are format
 * headers, and the bytes carry no meaning beyond what they are.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const join = (...parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46);
const PDF = ascii('%PDF-1.7\n1 0 obj\n');
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0);

describe('what a file IS comes from its bytes', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['application/pdf', PDF],
    ['image/gif', ascii('GIF89a')],
    ['application/zip', ZIP],
  ])('detects %s', (expected, sample) => {
    expect(detectMediaType(sample)).toBe(expected);
  });

  it('distinguishes WEBP from any other RIFF container', () => {
    const webp = join(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WEBP'));
    const wav = join(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVE'));

    expect(detectMediaType(webp)).toBe('image/webp');
    // A RIFF that is not WEBP must not be mislabelled as one just because the
    // first four bytes matched.
    expect(detectMediaType(wav)).toBeNull();
  });
});

describe('being unsure is a refusal, never an acceptance', () => {
  it.each([
    ['empty input', new Uint8Array(0)],
    ['a truncated PNG signature', PNG.subarray(0, 4)],
    ['plain prose', ascii('This is just some text with no signature at all.')],
    ['random noise', bytes(0x13, 0x37, 0x42, 0x99, 0x01)],
    ['a NUL run', new Uint8Array(64)],
  ])('returns null for %s', (_label, sample) => {
    expect(detectMediaType(sample)).toBeNull();
  });
});

describe('the extension and the declared type carry no authority', () => {
  it('reports a ZIP as a ZIP however it was named or declared', () => {
    // This is the mislabelled-file case: the pipeline above refuses it because
    // the DETECTED type is what it consults, and the detected type is `zip`.
    expect(detectMediaType(ZIP)).toBe('application/zip');
    expect(archiveOrExecutable('application/zip')).toBe(true);
  });

  it('reports script and executable headers for what they are', () => {
    for (const [sample, expected] of [
      [ascii('#!/bin/sh\nrm -rf /\n'), 'application/x-shellscript'],
      [ascii('MZ\u0090\u0000'), 'application/x-msdownload'],
      [bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1), 'application/x-elf'],
    ] as const) {
      const detected = detectMediaType(sample);
      expect(detected).toBe(expected);
      expect(archiveOrExecutable(detected as string)).toBe(true);
    }
  });

  it('does not class a legitimate document as an archive', () => {
    for (const type of ['image/png', 'image/jpeg', 'application/pdf', 'image/webp']) {
      expect(archiveOrExecutable(type)).toBe(false);
    }
  });
});

describe('detection is bounded', () => {
  it('reads a bounded prefix rather than the whole file', () => {
    // A ceiling in the low kilobytes is what keeps sniffing from becoming a
    // way to make the server hold a large buffer.
    expect(SNIFF_PREFIX_BYTES).toBeLessThanOrEqual(8192);
    expect(SNIFF_PREFIX_BYTES).toBeGreaterThan(512);
  });

  it('still identifies a small file padded out to the prefix length', () => {
    const padded = join(PNG, new Uint8Array(SNIFF_PREFIX_BYTES));
    expect(detectMediaType(padded)).toBe('image/png');
  });
});

/* ---------------------------------------------------------------------------
 * Phase 11 — MPEG audio without an ID3 tag, confirmed structurally
 * ------------------------------------------------------------------------- */

describe('an untagged MP3 is recognised by its frames, not by one byte', () => {
  const frames = (count: number) => syntheticSilentMp3(count);

  it('recognises two consecutive valid Layer III frames', () => {
    expect(detectMediaType(frames(2))).toBe('audio/mpeg');
    expect(detectMediaType(frames(40).subarray(0, SNIFF_PREFIX_BYTES))).toBe(
      'audio/mpeg',
    );
  });

  it('still recognises an ID3-tagged file', () => {
    expect(detectMediaType(join(ascii('ID3'), bytes(4, 0, 0, 0, 0, 0, 0)))).toBe(
      'audio/mpeg',
    );
  });

  it('refuses a lone frame header whose successor is missing', () => {
    // One frame and nothing after it: the structure cannot be confirmed.
    expect(detectMediaType(frames(2).subarray(0, 417))).toBeNull();
  });

  it('refuses a sync byte followed by anything that is not a Layer III header', () => {
    const corrupt = Uint8Array.from(frames(3));
    // The second frame's header is broken: its layer bits say Layer I.
    corrupt.set([0xff, 0xff, 0x90, 0xc4], 417);
    expect(detectMediaType(corrupt)).toBeNull();

    const reserved = Uint8Array.from(frames(3));
    // Reserved sample rate on the first header.
    reserved.set([0xff, 0xfb, 0x9c, 0xc4], 0);
    expect(detectMediaType(reserved)).toBeNull();

    const freeFormat = Uint8Array.from(frames(3));
    // Bitrate index 0 ("free") is refused rather than guessed about.
    freeFormat.set([0xff, 0xfb, 0x00, 0xc4], 0);
    expect(detectMediaType(freeFormat)).toBeNull();
  });

  it('never confuses a JPEG, which also begins with 0xFF, for audio', () => {
    expect(detectMediaType(join(JPEG, new Uint8Array(1024)))).toBe('image/jpeg');
  });

  it('is not fooled by an archive or a script renamed to .mp3', () => {
    // The bytes decide: a ZIP is a ZIP and a script is a script, whatever the
    // name or the declared type says.
    expect(detectMediaType(ZIP)).toBe('application/zip');
    expect(detectMediaType(ascii('#!/bin/sh\n'))).toBe('application/x-shellscript');
  });
});
