import {
  PERSONAL_LIMITS,
  personalTargetSchema,
  targetKey,
  type PersonalInterest,
  type PersonalTarget,
} from '@minhaj/contracts/personalisation';

/**
 * Presentation decisions for the My Minhaj surfaces Personalisation owns —
 * PURE and free of React (ROUTE_MAP.md §5.1; DELIVERY_PLAN.md Phase 21).
 *
 * Which offset a URL asks for, how a typed target travels through a form and
 * back, and which public section an interest names. Each has ONE
 * implementation, so every page and every action read them the same way.
 *
 * A FORM NAMES A TARGET, NEVER AN OWNER. A target crosses a form as its
 * `targetKey` — `article:{uuid}`, `ayah:{surah}:{ayah}` — and is parsed back
 * through the contract's strict schema; whose record it is comes from the
 * session the action resolves, never from a field.
 */

type Query = Record<string, string | string[] | undefined>;

/** The first value of one query parameter, or `null`. */
function single(query: Query, name: string): string | null {
  const raw = query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

/** A plain `?offset=`, bounded by the lists' ceiling; anything else is 0. */
export function readPersonalOffset(query: Query): number {
  const raw = single(query, 'offset');
  if (raw === null || !/^\d{1,5}$/.test(raw)) return 0;
  const value = Number(raw);
  return value <= PERSONAL_LIMITS.offsetMax ? value : 0;
}

/** A list page's address: the path alone for the first page. */
export function personalOffsetHref(path: string, offset: number): string {
  return offset <= 0 ? path : `${path}?offset=${String(offset)}`;
}

/** A target as one form value. */
export function encodeTarget(target: PersonalTarget): string {
  return targetKey(target);
}

/** A whole positive number of at most three digits, or `NaN`. */
function position(value: string | undefined): number {
  return value !== undefined && /^[1-9][0-9]{0,2}$/.test(value)
    ? Number(value)
    : Number.NaN;
}

/**
 * A form value back into a typed target — or `null` for anything the
 * contract would not accept. Never repaired, never guessed.
 */
export function decodeTarget(value: unknown): PersonalTarget | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parts = value.split(':');
  const candidate =
    parts[0] === 'ayah'
      ? parts.length === 3
        ? { kind: 'ayah', surah: position(parts[1]), ayah: position(parts[2]) }
        : null
      : parts.length === 2
        ? { kind: parts[0], id: parts[1] }
        : null;
  const parsed = personalTargetSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * The public section each interest names. An interest is a choice among the
 * platform's public areas and nothing more, so its only use here is a link to
 * the area it names.
 */
export const INTEREST_SECTIONS: Readonly<Record<PersonalInterest, string>> =
  Object.freeze({
    quran: '/quran',
    hadith: '/hadith',
    library: '/library',
    watch: '/watch',
    listen: '/listen',
    fatwa: '/fatwa',
    'news-events': '/news',
    'global-network': '/global',
  });

/** The time zone to show instants in: the account's own when it is a real one. */
export function displayTimeZone(timeZone: string | null): string {
  if (timeZone === null || timeZone === '') return 'UTC';
  try {
    return Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}
