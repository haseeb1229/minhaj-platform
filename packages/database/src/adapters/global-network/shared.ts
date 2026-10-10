import 'server-only';

import type { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import type {
  CentreLabel,
  Coordinates,
  GlobalState,
  PlaceLabel,
} from '@minhaj/contracts/global';

/**
 * What the Global Network adapter's administrative, public and reference halves
 * share — refusal mapping, label mapping and the PUBLIC PREDICATES — so the
 * three cannot disagree about what a duplicate slug, a stale version or a
 * "public" Centre means.
 *
 * PACKAGE-INTERNAL. Nothing here is exported from `@minhaj/database`, and none
 * of it is a capability: `Client` is a type the adapter's own transactions use.
 */

export type Client = Prisma.TransactionClient;

export class GlobalDataError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Unique keys whose violation means something other than "slug taken". */
const KEY_REASONS: readonly (readonly [string, string])[] = [
  ['Country_code_key', 'duplicate-code'],
  ['CentreContact_centreId_channel_value_key', 'duplicate-contact'],
  // Contacts are rewritten densely under the Centre's claimed version, so
  // meeting the position key means two writers raced; neither silently wins.
  ['CentreContact_pkey', 'conflict'],
  ['CentreServiceCity_pkey', 'duplicate-city'],
];

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * foreign-key refusal is `invalid` — a parent from another Country, a parent
 * that does not exist, or a Country change a slug reservation pins. Everything
 * unrecognised, including a serialisation failure, is rethrown and reported as
 * unavailable, never as a rule that was not evaluated (DOMAIN_MODEL.md §19.8).
 */
export function refuse(error: unknown): never {
  if (error instanceof GlobalDataError) throw error;
  const known = error as { code?: string; meta?: unknown; message?: string } | null;
  const code = known?.code;
  if (code === 'P2002') {
    const detail = `${JSON.stringify(known?.meta ?? {})} ${known?.message ?? ''}`;
    const reason = KEY_REASONS.find(([key]) => detail.includes(key))?.[1];
    throw new GlobalDataError(reason ?? 'duplicate-slug');
  }
  if (code === 'P2025') throw new GlobalDataError('conflict');
  if (code === 'P2003' || code === 'P2004') throw new GlobalDataError('invalid');
  throw error;
}

export const RECENTLY_CHANGED = [{ updatedAt: 'desc' }, { id: 'asc' }] as const;
export const BY_SLUG = [{ slug: 'asc' }, { id: 'asc' }] as const;
export const LABELS = { orderBy: { locale: 'asc' } } as const;

export const boundedOffset = (value: number) =>
  Math.max(0, Math.min(10_000_000, Math.trunc(value) || 0));

/**
 * A version no row can hold (`CHECK ([version] > 0)`). An edit that somehow
 * arrived without an expected version conflicts rather than overwriting.
 */
export const UNMATCHABLE_VERSION = 0;

/** A batch of identifiers a caller may ask about at once. */
export const ID_BATCH = 200;

/* ===========================================================================
 * The public predicates — a record is public only under public ancestors
 * ========================================================================= */

const PUBLISHED = { state: 'published' } as const;

export const PUBLIC_COUNTRY = PUBLISHED;

export const PUBLIC_REGION = { ...PUBLISHED, country: PUBLISHED } as const;

/** A City is public when it, its Country and — where it has one — its Region are. */
export const PUBLIC_CITY = {
  ...PUBLISHED,
  country: PUBLISHED,
  OR: [{ regionId: null }, { region: { is: PUBLISHED } }],
} satisfies Prisma.CityWhereInput;

/**
 * A Centre is public when it and its Country are published and NO locality it
 * names is withheld: a City it is in must be public (and so its Region), and a
 * Region it names directly must be published. Fail closed: a hidden ancestor
 * hides the Centre.
 */
export const PUBLIC_CENTRE = {
  ...PUBLISHED,
  country: PUBLISHED,
  AND: [
    { OR: [{ cityId: null }, { city: { is: PUBLIC_CITY } }] },
    { OR: [{ regionId: null }, { region: { is: PUBLISHED } }] },
  ],
} satisfies Prisma.CentreWhereInput;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

export interface PlaceLabelRow {
  readonly locale: string;
  readonly name: string;
}

export interface CentreLabelRow extends PlaceLabelRow {
  readonly description: string | null;
  readonly address: string | null;
}

export function placeLabels(rows: readonly PlaceLabelRow[]): PlaceLabel[] {
  return rows.map((row) => ({ locale: row.locale as Locale, name: row.name }));
}

export function centreLabels(rows: readonly CentreLabelRow[]): CentreLabel[] {
  return rows.map((row) => ({
    locale: row.locale as Locale,
    name: row.name,
    description: row.description,
    address: row.address,
  }));
}

/** A SQL `decimal(9,6)` read back exactly as the six-place text it is. */
export function coordinatesOf(
  latitude: { toFixed(places: number): string } | null,
  longitude: { toFixed(places: number): string } | null,
): Coordinates | null {
  return latitude === null || longitude === null
    ? null
    : { latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) };
}

export function stateOf(value: string): GlobalState {
  return value as GlobalState;
}

export function localeOf(value: string): Locale {
  return value as Locale;
}

/** An administrative text match: the slug or any name. Bounded by the schema. */
export function nameMatch(text: string | null): object {
  return text === null
    ? {}
    : {
        OR: [
          { slug: { contains: text } },
          { labels: { some: { name: { contains: text } } } },
        ],
      };
}

/**
 * Which of a record's facts changed — NAMES ONLY, never values, so an audit
 * entry carries no address, coordinate, contact or name (SECURITY_BASELINE.md
 * §13.4).
 */
export function changedFields(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>,
): string {
  if (before === null) return 'created';
  return Object.keys(after)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
    .join(',');
}
