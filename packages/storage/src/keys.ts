import 'server-only';

import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Storage keys and root containment (SECURITY_BASELINE.md §10.1 rules 5, 6).
 *
 * A storage key is the ONLY thing that may become a path under the storage
 * root. It is generated here, from a CSPRNG, and never derived from a
 * filename, title, slug, account identifier or any other caller input. A
 * caller cannot propose a key, so a caller cannot aim a write.
 *
 * `path.join(root, untrusted)` IS NOT CONTAINMENT and this module does not
 * pretend otherwise: `join` happily resolves `..` and on Windows it accepts a
 * drive-relative path. Containment here is proven by resolving the candidate
 * and checking it is genuinely beneath the resolved root, and separately by
 * refusing any key that is not the exact shape this module generates.
 */

/** Bytes of entropy per key segment. 16 bytes is 128 bits. */
const ENTROPY_BYTES = 16;

/**
 * The exact shape of a generated key: `ab/cd/<32 hex>`.
 *
 * The two leading fan-out segments keep any one directory from accumulating
 * every object, which matters on a real filesystem long before it matters to
 * correctness. They are taken FROM the generated entropy, not from anything a
 * caller supplied, so they leak nothing about the content.
 */
const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/u;

/** A freshly generated, opaque storage key. */
export function generateStorageKey(): string {
  const hex = randomBytes(ENTROPY_BYTES).toString('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

/**
 * Is this the exact syntax `generateStorageKey` produces?
 *
 * Deliberately an EQUALITY test against a generated shape rather than a
 * blocklist of dangerous substrings. A blocklist has to anticipate `..`,
 * absolute paths, backslashes, NUL, drive letters, UNC prefixes, encoded
 * traversal and whatever the next encoding trick turns out to be. An
 * allowlist of 32 hex characters in a fixed layout admits none of them
 * because it admits almost nothing.
 */
export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Resolve a key to an absolute path, PROVING it stays under the root.
 *
 * Throws rather than returning a fallback: a key that does not contain is a
 * programming error or an attack, and there is no safe default location to
 * quietly write to instead.
 *
 * Both checks are kept. The syntax check is what actually stops traversal;
 * the containment check is what still stops it if the syntax rule is ever
 * loosened, and it is the one that survives a symlinked root because it
 * compares RESOLVED paths.
 */
export function resolveWithinRoot(root: string, key: string): string {
  if (!isValidStorageKey(key)) {
    throw new Error('Refusing a storage key that is not a generated key.');
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, key);

  if (!isBeneath(resolvedRoot, candidate)) {
    throw new Error('Refusing a storage path outside the storage root.');
  }

  return candidate;
}

/**
 * Is `candidate` strictly beneath `parent`, both already resolved?
 *
 * Compares path SEGMENTS rather than string prefixes. A prefix comparison
 * treats `/srv/minhaj-evil` as being inside `/srv/minhaj`, which is exactly
 * the bug this shape avoids. `path.relative` gives the segment answer, and a
 * result that is empty, absolute, or starts by walking up is not containment.
 */
export function isBeneath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);

  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    !relative.split(path.sep).includes('..')
  );
}

/**
 * A bounded, display-only rendering of the caller's filename.
 *
 * This value is metadata and NOTHING else. It never reaches a path, a key or
 * a header without further encoding. Directory separators and control
 * characters are removed so that a later consumer which is careless with it
 * has less to be careless with, and the result is length-bounded so it cannot
 * be used to pad a record.
 */
export function displayNameFrom(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const cleaned = [...value.normalize('NFC')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127 && !'/\\'.includes(character);
    })
    .join('')
    .trim();

  return cleaned === '' ? null : cleaned.slice(0, 200);
}
