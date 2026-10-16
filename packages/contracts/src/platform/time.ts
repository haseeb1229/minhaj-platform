import { z } from 'zod';

/**
 * Time zones and local wall-clock times — the Layer-0 helpers every scheduling
 * owner shares (DOMAIN_MODEL.md §19.5).
 *
 * THE RULES THESE IMPLEMENT. An authoritative instant is UTC; a scheduling
 * preference is an IANA zone name, never an offset; the local time an
 * occurrence was scheduled in is a FACT and is kept beside the instant; and a
 * daylight-saving transition is handled deliberately — a wall-clock time a
 * zone skips resolves to NOTHING, one it repeats resolves to TWO candidates the
 * caller must choose between — rather than by whatever `Date` would guess.
 *
 * DERIVED FROM THE RUNTIME'S OWN ZONE DATA, NOT A LIBRARY. `Intl` knows every
 * zone this runtime supports and its offsets at any instant; nothing else is
 * needed, and no dependency is introduced. Editorial's Events (Phase 14) proved
 * these rules first; Learning's classes (Phase 23) schedule by the same ones,
 * so the implementation lives here once and both owners import it.
 *
 * PURE. No clock is read here: a caller supplies the instants it reasons about.
 */

/** A zone NAME, never an offset: `Area/Location`, or `UTC` itself. */
const ZONE_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

let geographicZones: ReadonlySet<string> | null = null;

/** The IANA zones the runtime knows, as the runtime spells them. */
export function supportedTimeZones(): readonly string[] {
  return ['UTC', ...Intl.supportedValuesOf('timeZone')];
}

/**
 * The canonical spelling of an IANA zone, or `null` when the value is not one
 * this platform accepts.
 *
 * A FIXED OFFSET IS NOT A TIME ZONE. `+05:00`, `GMT`, `EST` and `Etc/GMT+5`
 * name an offset, which is wrong twice a year wherever daylight saving is
 * observed (§19.5), so they are refused. An alias the runtime knows —
 * `US/Eastern`, `Asia/Kolkata` — is stored under the runtime's canonical name,
 * so one zone is never spelled two ways in the database.
 */
export function canonicalTimeZone(value: string): string | null {
  if (value.length > 64 || !ZONE_NAME.test(value)) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
  geographicZones ??= new Set(Intl.supportedValuesOf('timeZone'));
  return resolved === 'UTC' || geographicZones.has(resolved) ? resolved : null;
}

/** An IANA zone, canonicalised, or a refusal. */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value, context) => {
    const zone = canonicalTimeZone(value);
    if (zone === null) {
      context.addIssue({ code: 'custom', message: 'An IANA time zone is required.' });
      return z.NEVER;
    }
    return zone;
  });

/* ===========================================================================
 * Local wall-clock times
 * ========================================================================= */

/** `YYYY-MM-DDTHH:mm` — what a `datetime-local` control submits. */
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** The calendar years a wall-clock time may fall in. */
export interface YearBounds {
  readonly earliestYear: number;
  readonly latestYear: number;
}

/**
 * A `YYYY-MM-DDTHH:mm` value as a real calendar date and minute within the
 * bounds, or `null`. February 30th is `null`, as is 24:00.
 */
export function parseWallTime(value: string, bounds: YearBounds): WallTime | null {
  const match = LOCAL_TIME.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    year < bounds.earliestYear ||
    year > bounds.latestYear ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute };
}

/** A schema for a real calendar date and minute within `bounds`. */
export function localTimeSchema(bounds: YearBounds) {
  return z
    .string()
    .trim()
    .refine((value) => parseWallTime(value, bounds) !== null, {
      message: 'A local date and time is required.',
    });
}

/** Which of the two instants a person means when a local time repeats. */
export const foldSchema = z.enum(['earlier', 'later']);
export type Fold = z.infer<typeof foldSchema>;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The zone's wall clock at an instant, as if it were a UTC instant (ms). */
function wallClockAt(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    formatterFor(zone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

const DAY = 86_400_000;

/** The years any wall-clock time this platform schedules may fall in. */
const ANY_YEAR: YearBounds = { earliestYear: 1, latestYear: 9999 };

/**
 * Every UTC instant at which `local` is the zone's wall-clock time — none
 * when a daylight-saving change skips it, two when one repeats it, in order.
 *
 * The zone's offsets a day either side of the wall time are the only
 * candidates (no zone changes its offset twice within two days), and each
 * candidate is kept only if the zone's clock really reads `local` at it.
 */
export function instantsOf(local: string, zone: string): readonly Date[] {
  const wall = parseWallTime(local, ANY_YEAR);
  if (wall === null) return [];
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const offsets = new Set(
    [asUtc - DAY, asUtc, asUtc + DAY].map((probe) => wallClockAt(probe, zone) - probe),
  );
  const found = [...offsets]
    .map((offset) => asUtc - offset)
    .filter((instant) => wallClockAt(instant, zone) === asUtc);
  return [...new Set(found)].sort((a, b) => a - b).map((instant) => new Date(instant));
}

export type ResolvedTime =
  | { readonly kind: 'exact'; readonly instant: Date }
  | { readonly kind: 'nonexistent' }
  | { readonly kind: 'ambiguous' };

/**
 * One local time in one zone, resolved to its authoritative instant — or the
 * reason it cannot be, so the person is told rather than the time moved.
 */
export function resolveLocalTime(
  local: string,
  zone: string,
  fold: Fold | null,
): ResolvedTime {
  const candidates = instantsOf(local, zone);
  const [earlier, later] = candidates;
  if (earlier === undefined) return { kind: 'nonexistent' };
  if (later === undefined) return { kind: 'exact', instant: earlier };
  if (fold === null) return { kind: 'ambiguous' };
  return { kind: 'exact', instant: fold === 'earlier' ? earlier : later };
}

/**
 * Which repetition a stored instant is, when its local time repeats — so a
 * person re-opening a record sees the choice that was made. `null` when the
 * local time occurs once.
 */
export function foldOf(local: string, zone: string, instant: Date): Fold | null {
  const candidates = instantsOf(local, zone);
  if (candidates.length < 2) return null;
  return candidates[0]?.getTime() === instant.getTime() ? 'earlier' : 'later';
}

/** The offset, in minutes east of UTC, a stored local time had at its instant. */
export function offsetMinutesOf(local: string, instant: Date): number {
  const wall = parseWallTime(local, ANY_YEAR);
  if (wall === null) return 0;
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * A stored local time as an ISO 8601 date-time WITH its offset —
 * `2026-11-14T19:00:00+05:00` — the form a `<time>` element states an
 * occurrence in.
 */
export function zonedIso(local: string, instant: Date): string {
  const offset = offsetMinutesOf(local, instant);
  const sign = offset < 0 ? '-' : '+';
  const hours = String(Math.trunc(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${local}:00${sign}${hours}:${minutes}`;
}

/**
 * The zone's wall-clock reading of an instant, as `YYYY-MM-DDTHH:mm` — the
 * inverse of `instantsOf` for a stored instant, used when a record is moved and
 * its scheduling zone's local time must be re-stated from the new instant.
 */
export function localTimeAt(instant: Date, zone: string): string {
  const wall = new Date(wallClockAt(instant.getTime(), zone));
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${String(wall.getUTCFullYear()).padStart(4, '0')}-${pad(wall.getUTCMonth() + 1)}-` +
    `${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`
  );
}
