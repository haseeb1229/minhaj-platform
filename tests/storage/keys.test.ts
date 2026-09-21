import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  displayNameFrom,
  generateStorageKey,
  isBeneath,
  isValidStorageKey,
  resolveWithinRoot,
} from '../../packages/storage/src/keys.ts';

/**
 * Storage keys and containment (SECURITY_BASELINE.md §10.1 rules 5, 6).
 *
 * The claim under test is that a caller cannot influence WHERE bytes land.
 * Every hostile string below is one somebody would actually try.
 */

const ROOT = path.resolve('/srv/minhaj/storage');

describe('a storage key is generated, never derived', () => {
  it('is opaque, high-entropy and unique across many draws', () => {
    const keys = new Set(Array.from({ length: 2000 }, generateStorageKey));

    // 128 bits of entropy: a collision in 2000 draws would mean the generator
    // is not what it claims to be.
    expect(keys.size).toBe(2000);

    for (const key of keys) expect(isValidStorageKey(key)).toBe(true);
  });

  it('carries nothing a caller supplied', () => {
    // The generator takes no argument at all, which is the strongest possible
    // form of "the filename cannot reach the key". This asserts the shape that
    // makes that true rather than restating the signature.
    const key = generateStorageKey();

    expect(key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/u);
  });
});

describe('a key that is not a generated key is refused', () => {
  it.each([
    '../../../etc/passwd',
    '..\\..\\windows\\system32\\config\\sam',
    '/etc/passwd',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '\\\\server\\share\\file',
    'ab/cd/../../../../etc/passwd',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%2f..%2fetc%2fpasswd',
    'ab/cd/0123456789abcdef0123456789abcde',
    'ab/cd/0123456789abcdef0123456789abcdef0',
    'AB/CD/0123456789ABCDEF0123456789ABCDEF',
    'ab/cd/0123456789abcdef0123456789abcde\u0000',
    'ab/cd/0123456789abcdef0123456789abcdef/../../x',
    '',
    '.',
    '..',
    'ab/cd/0123456789abcdef0123456789abcdef ',
  ])('refuses %j', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
    expect(() => resolveWithinRoot(ROOT, key)).toThrow(/storage key|storage root/u);
  });

  it('resolves a genuine key to a path beneath the root', () => {
    const key = generateStorageKey();
    const resolved = resolveWithinRoot(ROOT, key);

    expect(isBeneath(path.resolve(ROOT), resolved)).toBe(true);
    expect(resolved.startsWith(path.resolve(ROOT) + path.sep)).toBe(true);
  });
});

describe('containment compares segments, not string prefixes', () => {
  it('does not treat a sibling with a shared prefix as contained', () => {
    // The classic bug: `/srv/minhaj-evil` starts with `/srv/minhaj`. A prefix
    // check calls that containment; a segment check does not.
    expect(
      isBeneath(path.resolve('/srv/minhaj'), path.resolve('/srv/minhaj-evil/x')),
    ).toBe(false);
  });

  it('does not treat the root itself as contained within itself', () => {
    expect(isBeneath(path.resolve('/srv/minhaj'), path.resolve('/srv/minhaj'))).toBe(
      false,
    );
  });

  it('rejects a traversal that climbs back out', () => {
    expect(
      isBeneath(path.resolve('/srv/minhaj'), path.resolve('/srv/minhaj/a/../../etc')),
    ).toBe(false);
  });

  it('accepts a genuine descendant', () => {
    expect(
      isBeneath(path.resolve('/srv/minhaj'), path.resolve('/srv/minhaj/a/b/c')),
    ).toBe(true);
  });
});

describe('a display name is metadata and nothing else', () => {
  it('strips separators and control characters so it cannot look like a path', () => {
    expect(displayNameFrom('../../etc/passwd')).toBe('....etcpasswd');
    expect(displayNameFrom('a\\b/c')).toBe('abc');
    expect(displayNameFrom('bad\u0000name\u001f')).toBe('badname');
  });

  it('is bounded, so it cannot be used to pad a record', () => {
    expect(displayNameFrom('x'.repeat(5000))).toHaveLength(200);
  });

  it('is null when there is nothing left worth keeping', () => {
    for (const value of ['', '   ', '///', null, undefined]) {
      expect(displayNameFrom(value)).toBeNull();
    }
  });

  it('keeps a legitimate name readable', () => {
    expect(displayNameFrom('  Annual Report 2026.pdf  ')).toBe('Annual Report 2026.pdf');
  });
});
