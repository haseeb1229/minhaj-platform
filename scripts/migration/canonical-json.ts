import { createHash } from 'node:crypto';

/**
 * CANONICAL JSON for evidence and bundle bytes.
 *
 * Object keys sorted by code unit, no whitespace, arrays in order. Two writers
 * that hold the same value produce the same bytes, so a checksum over them is a
 * statement about the value rather than about whoever serialised it — which is
 * what an idempotent promotion entry and a reproducible export snapshot need.
 *
 * Only plain JSON values are accepted. Anything else (a Date, undefined, a
 * function, a non-finite number) is a programming error, never coerced.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value))
        throw new TypeError('canonical JSON: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError('canonical JSON: only plain objects are accepted');
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonical JSON: unsupported ${typeof value}`);
  }
}

/** Lowercase hex SHA-256 — the checksum form every Phase-29 column uses. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
