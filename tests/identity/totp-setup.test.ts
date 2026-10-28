import { describe, expect, it } from 'vitest';

import {
  parseTotpSetup,
  qrModules,
  qrPath,
} from '@/app/[locale]/my/settings/security/totp-setup';

/**
 * The second-factor setup screen derives its QR code and its typeable key from
 * the one provisioning URI the enrolment returns. These prove the key a person
 * types is exactly the URI's secret, that anything unrecognisable is refused
 * rather than guessed at, and that the QR matrix is a real, deterministic code.
 */

// Synthetic sentinel secret, not a real factor.
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/One%20Minhaj:owner%40example.invalid?secret=${SECRET}&issuer=One%20Minhaj&digits=6&period=30`;

describe('parseTotpSetup', () => {
  it('returns the URI secret, grouped in fours for manual entry', () => {
    const setup = parseTotpSetup(URI);
    expect(setup).not.toBeNull();
    expect(setup?.uri).toBe(URI);
    expect(setup?.secret).toBe(SECRET);
    expect(setup?.groupedSecret).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    expect(setup?.groupedSecret.replace(/\s+/gu, '')).toBe(SECRET);
  });

  it('normalises a lower-case or padded secret', () => {
    const setup = parseTotpSetup(URI.replace(SECRET, `${SECRET.toLowerCase()}====`));
    expect(setup?.secret).toBe(SECRET);
  });

  it.each([
    ['not a URL', 'not a uri'],
    ['another scheme', URI.replace('otpauth://', 'https://')],
    ['a counter-based factor', URI.replace('otpauth://totp/', 'otpauth://hotp/')],
    ['no secret', URI.replace(`secret=${SECRET}&`, '')],
    ['a short secret', URI.replace(SECRET, 'JBSWY3DP')],
    ['a secret outside Base32', URI.replace(SECRET, `${SECRET.slice(0, -1)}1`)],
  ])('refuses %s rather than showing a key that may be wrong', (_name, uri) => {
    expect(parseTotpSetup(uri)).toBeNull();
  });
});

describe('qrModules', () => {
  const modules = qrModules(URI);

  it('is a square QR matrix of a valid version size', () => {
    const size = modules.length;
    expect(modules.every((row) => row.length === size)).toBe(true);
    // Version v has 4v + 17 modules per side.
    expect((size - 17) % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(21);
  });

  it('carries the three finder patterns', () => {
    const size = modules.length;
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      // A finder pattern's outer ring is dark and its inner ring light.
      expect(modules[top]?.[left]).toBe(true);
      expect(modules[top + 6]?.[left + 6]).toBe(true);
      expect(modules[top + 1]?.[left + 1]).toBe(false);
      expect(modules[top + 3]?.[left + 3]).toBe(true);
    }
  });

  it('is deterministic for the same URI and differs for another secret', () => {
    expect(qrModules(URI)).toEqual(modules);
    expect(
      qrModules(URI.replace(SECRET, 'KRUGS4ZANFZSAYJAORSXG5BAKRUGS4ZA')),
    ).not.toEqual(modules);
  });
});

describe('qrPath', () => {
  it('draws one unit square per dark module, offset by the quiet zone', () => {
    const tiny = [
      [true, false],
      [false, true],
    ];
    expect(qrPath(tiny, 4)).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
  });

  it('draws every dark module of a real code', () => {
    const modules = qrModules(URI);
    const dark = modules.flat().filter(Boolean).length;
    expect(qrPath(modules, 4).match(/M/gu)).toHaveLength(dark);
  });
});
