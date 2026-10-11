import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';

/**
 * Global Network — Country, Region, City, Centre and CentreContact
 * (DOMAIN_MODEL.md §17.1; DELIVERY_PLAN.md Phase 16).
 *
 * A FLEXIBLE HIERARCHY, NOT A CHAIN. A Country may have no Region; a City may
 * sit directly under its Country; a virtual Centre has no physical place at
 * all; a Centre may serve Cities beyond its own. Every level below Country is
 * pinned to ONE Country, and the database refuses a parent from another.
 *
 * ONE LOCALITY FACT PER CENTRE. A Centre names a physical City — whose Region,
 * if any, is then the Centre's Region too — or, with no City, a Region directly,
 * or neither. It never stores a Region beside its City, so the two cannot
 * disagree.
 *
 * NOTHING HERE IS INFERRED. An address is the words the organisation supplied;
 * coordinates are the ones it supplied, as exact decimals, never geocoded; a
 * Centre is virtual because an operator said so, never because its address is
 * missing. Until OPEN_DECISIONS.md §6.2 is closed no real directory record is
 * seeded: an empty directory says so honestly.
 */

export const globalIdSchema = z.uuid();

/** One slug grammar for every Global record with a public address. */
export const globalSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * The smallest lifecycle a directory needs: prepared privately, shown, and
 * withdrawn without being destroyed. No review step — Global has none — so no
 * editorial workflow is imported.
 */
export type GlobalState = 'draft' | 'published' | 'archived';
export const GLOBAL_STATES = Object.freeze(['draft', 'published', 'archived'] as const);
export const globalStateSchema = z.enum(GLOBAL_STATES) satisfies z.ZodType<GlobalState>;

export const globalVersionSchema = z.number().int().positive().max(2_147_483_646);

/** ISO 3166-1 alpha-2, typed in either case and stored upper case. */
export const countryCodeSchema = z
  .string()
  .trim()
  .length(2)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/));

/** The ISO code the Pakistan structure entry point names (ROUTE_MAP.md §3.9). */
export const PAKISTAN_CODE = 'PK';

/** Every bound in one place, each enforced again by a SQL CHECK or column size. */
export const GLOBAL_LIMITS = Object.freeze({
  placeName: 160,
  centreName: 200,
  description: 2000,
  address: 500,
  contactValue: 320,
  /** Places for public contacts on one Centre (the SQL position CHECK). */
  contacts: 12,
  /** Further Cities one Centre may be recorded as serving. */
  servedCities: 48,
});

/** One public listing page — a grid of four, three or two columns divides it. */
export const GLOBAL_PAGE = 24;

/** The most Regions a Country page lists at once: far beyond any real Country. */
export const GLOBAL_REGION_LIST = 200;

/** One page of an administrative directory. */
export const GLOBAL_ADMIN_PAGE = 25;

/** The most choices one administrative selector offers at once. */
export const GLOBAL_CHOICES = 300;

const text = (max: number) => z.string().trim().max(max);

/* ===========================================================================
 * Labels — localised names, one per interface locale, never parallel columns
 * ========================================================================= */

export const placeLabelSchema = z
  .object({ locale: localeSchema, name: text(GLOBAL_LIMITS.placeName).min(1) })
  .strict();

export type PlaceLabel = z.infer<typeof placeLabelSchema>;

/**
 * A Centre's words in one locale: its name, and only where the organisation
 * supplied them, a description and a human-readable address.
 */
export const centreLabelSchema = z
  .object({
    locale: localeSchema,
    name: text(GLOBAL_LIMITS.centreName).min(1),
    description: text(GLOBAL_LIMITS.description).min(1).nullable(),
    address: text(GLOBAL_LIMITS.address).min(1).nullable(),
  })
  .strict();

export type CentreLabel = z.infer<typeof centreLabelSchema>;

function labelRules(
  value: {
    readonly primaryLocale: Locale;
    readonly labels: readonly { readonly locale: Locale }[];
  },
  ctx: z.RefinementCtx,
): void {
  if (
    !value.labels.some((label) => label.locale === value.primaryLocale) ||
    new Set(value.labels.map((label) => label.locale)).size !== value.labels.length
  )
    ctx.addIssue({
      code: 'custom',
      message: 'A unique primary locale label is required.',
    });
}

/* ===========================================================================
 * Coordinates — exact, both or neither, never inferred
 * ========================================================================= */

const DECIMAL = /^-?\d{1,3}(?:\.\d{1,6})?$/;

/** A decimal written as text, canonicalised to six places so it compares exactly. */
function exactDecimal(value: string, bound: number): string | null {
  if (!DECIMAL.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const integer = Number(whole);
  const padded = fraction.padEnd(6, '0');
  if (integer > bound || (integer === bound && /[1-9]/.test(padded))) return null;
  const sign = negative && (integer !== 0 || /[1-9]/.test(padded)) ? '-' : '';
  return `${sign}${String(integer)}.${padded}`;
}

/**
 * A Centre's coordinates as the organisation supplied them: latitude and
 * longitude in decimal degrees, at most six decimal places (about 0.1 m), kept
 * as TEXT so no binary floating point ever touches them.
 */
export const coordinatesSchema = z
  .object({
    latitude: z.string().trim().max(12),
    longitude: z.string().trim().max(12),
  })
  .strict()
  .transform((value, context) => {
    const latitude = exactDecimal(value.latitude, 90);
    const longitude = exactDecimal(value.longitude, 180);
    if (latitude === null || longitude === null) {
      context.addIssue({ code: 'custom', message: 'Coordinates are out of range.' });
      return z.NEVER;
    }
    return { latitude, longitude };
  });

export type Coordinates = z.output<typeof coordinatesSchema>;

/* ===========================================================================
 * Country, Region, City
 * ========================================================================= */

const labelsSchema = z.array(placeLabelSchema).min(1).max(3);

export const countryInputSchema = z
  .object({
    code: countryCodeSchema,
    slug: globalSlugSchema,
    primaryLocale: localeSchema,
    state: globalStateSchema,
    labels: labelsSchema,
  })
  .strict()
  .superRefine(labelRules);

export type CountryValue = z.output<typeof countryInputSchema>;

/**
 * A Region as an operator saves it. `countryId` is named on CREATION only: a
 * Region never leaves its Country, which the database refuses as well.
 */
export const regionInputSchema = z
  .object({
    countryId: globalIdSchema,
    slug: globalSlugSchema,
    primaryLocale: localeSchema,
    state: globalStateSchema,
    labels: labelsSchema,
  })
  .strict()
  .superRefine(labelRules);

export type RegionValue = z.output<typeof regionInputSchema>;

/**
 * A City as an operator saves it: its Country (fixed after creation) and,
 * only where meaningful, a Region of that same Country — which MAY change, and
 * moves every Centre in the City with it.
 */
export const cityInputSchema = z
  .object({
    countryId: globalIdSchema,
    regionId: globalIdSchema.nullable(),
    slug: globalSlugSchema,
    primaryLocale: localeSchema,
    state: globalStateSchema,
    labels: labelsSchema,
  })
  .strict()
  .superRefine(labelRules);

export type CityValue = z.output<typeof cityInputSchema>;

/* ===========================================================================
 * Centre
 * ========================================================================= */

/**
 * A Centre as an operator saves it.
 *
 * AT MOST ONE LOCALITY FACT: a City, or with no City a Region, or neither.
 * A VIRTUAL Centre has no physical City, Region, coordinates or address — the
 * database refuses the first three and this schema the fourth. Its served
 * Cities and its contacts are changed separately, one named change at a time.
 */
export const centreInputSchema = z
  .object({
    countryId: globalIdSchema,
    regionId: globalIdSchema.nullable(),
    cityId: globalIdSchema.nullable(),
    isVirtual: z.boolean(),
    coordinates: coordinatesSchema.nullable(),
    slug: globalSlugSchema,
    primaryLocale: localeSchema,
    state: globalStateSchema,
    labels: z.array(centreLabelSchema).min(1).max(3),
  })
  .strict()
  .superRefine(labelRules)
  .superRefine((value, ctx) => {
    if (value.cityId !== null && value.regionId !== null)
      ctx.addIssue({
        code: 'custom',
        message: 'A Centre with a City takes its Region from that City.',
      });
    if (
      value.isVirtual &&
      (value.cityId !== null ||
        value.regionId !== null ||
        value.coordinates !== null ||
        value.labels.some((label) => label.address !== null))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'A virtual Centre has no physical place.',
      });
  });

export type CentreValue = z.output<typeof centreInputSchema>;

/* ===========================================================================
 * CentreContact — public directory contact, not correspondence
 * ========================================================================= */

/** The smallest set of channels the product needs. No social catalogue. */
export const CONTACT_CHANNELS = Object.freeze(['phone', 'email', 'website'] as const);
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const contactChannelSchema = z.enum(CONTACT_CHANNELS);

/**
 * A website as a described outbound link: absolute HTTPS, no credentials,
 * normalised by the platform's own URL parser — so a protocol-relative,
 * relative, `javascript:`, `data:` or `file:` address is refused rather than
 * reinterpreted. Nothing ever fetches, proxies or preloads it.
 */
export function safeWebsiteHref(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === '' ||
    !url.hostname.includes('.') ||
    url.href.length > GLOBAL_LIMITS.contactValue
  )
    return null;
  return url.href;
}

/**
 * A phone number AS DISPLAYED — international formats vary, so it is not
 * rewritten — and the `tel:` address derived from it: a leading `+` and its
 * digits, and nothing else. A number with too few digits to dial gets none.
 */
const PHONE = /^\+?[0-9(][0-9 ().-]{3,38}[0-9]$/;

export function dialablePhone(value: string): string | null {
  if (!PHONE.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5 || digits.length > 17) return null;
  return `tel:${value.startsWith('+') ? '+' : ''}${digits}`;
}

export const contactInputSchema = z
  .object({
    channel: contactChannelSchema,
    value: z.string().trim().min(1).max(GLOBAL_LIMITS.contactValue),
  })
  .strict()
  .transform((contact, context) => {
    const value =
      contact.channel === 'website'
        ? safeWebsiteHref(contact.value)
        : contact.channel === 'email'
          ? z.email().max(254).safeParse(contact.value).success
            ? contact.value
            : null
          : dialablePhone(contact.value) === null
            ? null
            : contact.value.replace(/\s+/g, ' ');
    if (value === null) {
      context.addIssue({ code: 'custom', message: 'Not a valid contact.' });
      return z.NEVER;
    }
    return { channel: contact.channel, value };
  });

export type CentreContact = z.output<typeof contactInputSchema>;

/**
 * One change to a Centre's ordered contacts or to the Cities it serves.
 *
 * NAMED CHANGES, NOT A LIST THE BROWSER SUPPLIES — as for a Gallery. Each is
 * applied to the Centre at the version the operator was shown, so a stale page
 * can neither reorder nor drop what somebody else just added.
 */
export const contactChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), contact: contactInputSchema }).strict(),
  z
    .object({ op: z.literal('remove'), position: z.number().int().min(0).max(11) })
    .strict(),
  z
    .object({
      op: z.literal('move'),
      position: z.number().int().min(0).max(11),
      direction: z.enum(['earlier', 'later']),
    })
    .strict(),
]);

export type ContactChange = z.infer<typeof contactChangeSchema>;

export const servedCityChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), cityId: globalIdSchema }).strict(),
  z.object({ op: z.literal('remove'), cityId: globalIdSchema }).strict(),
]);

export type ServedCityChange = z.infer<typeof servedCityChangeSchema>;

/**
 * The contacts after one change, or the reason it cannot apply. PURE, so the
 * rule is proved without a database: a duplicate is refused, the bound is
 * `limit`, and a change naming an absent place or moving nowhere is `invalid`.
 */
export function applyContactChange(
  current: readonly CentreContact[],
  change: ContactChange,
): { readonly contacts: readonly CentreContact[] } | { readonly refusal: string } {
  if (change.op === 'add') {
    if (
      current.some(
        (entry) =>
          entry.channel === change.contact.channel &&
          entry.value === change.contact.value,
      )
    )
      return { refusal: 'duplicate-contact' };
    if (current.length >= GLOBAL_LIMITS.contacts) return { refusal: 'limit' };
    return { contacts: [...current, change.contact] };
  }
  if (change.position >= current.length) return { refusal: 'invalid' };
  if (change.op === 'remove')
    return { contacts: current.filter((_, index) => index !== change.position) };
  const target =
    change.direction === 'earlier' ? change.position - 1 : change.position + 1;
  if (target < 0 || target >= current.length) return { refusal: 'invalid' };
  const next = [...current];
  const moved = next[change.position];
  const other = next[target];
  if (moved === undefined || other === undefined) return { refusal: 'invalid' };
  next[target] = moved;
  next[change.position] = other;
  return { contacts: next };
}

/** The served Cities after one change, or the reason it cannot apply. PURE. */
export function applyServedCityChange(
  current: readonly string[],
  change: ServedCityChange,
): { readonly cityIds: readonly string[] } | { readonly refusal: string } {
  if (change.op === 'add') {
    if (current.includes(change.cityId)) return { refusal: 'duplicate-city' };
    if (current.length >= GLOBAL_LIMITS.servedCities) return { refusal: 'limit' };
    return { cityIds: [...current, change.cityId] };
  }
  if (!current.includes(change.cityId)) return { refusal: 'invalid' };
  return { cityIds: current.filter((id) => id !== change.cityId) };
}

/* ===========================================================================
 * Queries
 * ========================================================================= */

/** An administrative directory's filters: lifecycle state, text, and parent. */
export const globalAdminQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    state: globalStateSchema.nullable().default(null),
    text: z.string().trim().min(1).max(120).nullable().default(null),
    countryId: globalIdSchema.nullable().default(null),
  })
  .strict();

export type GlobalAdminQuery = z.infer<typeof globalAdminQuerySchema>;

/**
 * Find a Centre: a Country, and within it a Region or a City, by their public
 * slugs — narrowing only the public predicate. A Region or City without its
 * Country means nothing and is refused; so is naming both a Region and a City,
 * which a single geography choice never does.
 */
export const centreFinderSchema = z
  .object({
    country: globalSlugSchema.nullable().default(null),
    region: globalSlugSchema.nullable().default(null),
    city: globalSlugSchema.nullable().default(null),
    offset: z.number().int().min(0).max(25_000).default(0),
  })
  .strict()
  .refine(
    (value) =>
      (value.region === null && value.city === null) ||
      (value.country !== null && (value.region === null || value.city === null)),
    { message: 'A Region or City needs its Country, and only one of them.' },
  );

export type CentreFinderQuery = z.infer<typeof centreFinderSchema>;

/** The resolved, public geography a finder query narrows to. */
export interface CentreScope {
  readonly countryId: string | null;
  readonly regionId: string | null;
  readonly cityId: string | null;
}

/* ===========================================================================
 * Records — administrative
 * ========================================================================= */

export interface CountryRecord {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: GlobalState;
  readonly labels: readonly PlaceLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface RegionRecord {
  readonly id: string;
  readonly countryId: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: GlobalState;
  readonly labels: readonly PlaceLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface CityRecord {
  readonly id: string;
  readonly countryId: string;
  readonly regionId: string | null;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: GlobalState;
  readonly labels: readonly PlaceLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

export interface CentreRecord {
  readonly id: string;
  readonly slug: string;
  readonly countryId: string;
  readonly regionId: string | null;
  readonly cityId: string | null;
  readonly isVirtual: boolean;
  readonly coordinates: Coordinates | null;
  readonly primaryLocale: Locale;
  readonly state: GlobalState;
  readonly labels: readonly CentreLabel[];
  readonly version: number;
  readonly updatedAt: Date;
}

/** A Centre with its ordered contacts and the Cities it serves, any state. */
export interface CentreDetail extends CentreRecord {
  readonly contacts: readonly CentreContact[];
  readonly servedCities: readonly CityRecord[];
}

/*
 * One bounded page of each record type, each named concretely: a persistence
 * adapter's surface must be SHOWN to be narrow (ARCHITECTURE.md §4.1), and a
 * generic page type could carry anything.
 */
export interface CountryPage {
  readonly items: readonly CountryRecord[];
  readonly hasMore: boolean;
}
export interface RegionPage {
  readonly items: readonly RegionRecord[];
  readonly hasMore: boolean;
}
export interface CityPage {
  readonly items: readonly CityRecord[];
  readonly hasMore: boolean;
}
export interface CentrePage {
  readonly items: readonly CentreRecord[];
  readonly hasMore: boolean;
}

/**
 * One choice an administrative selector offers, IN ANY STATE — so a parent an
 * operator has since archived is shown truthfully rather than silently cleared.
 */
export interface GlobalChoice {
  readonly id: string;
  readonly slug: string;
  readonly state: GlobalState;
  readonly primaryLocale: Locale;
  readonly labels: readonly PlaceLabel[];
  /** The Country a Region or City belongs to; for a Country, itself. */
  readonly countryId: string;
  /** A City's Region, where it has one. */
  readonly regionId: string | null;
}

/* ===========================================================================
 * Records — public
 * ========================================================================= */

/** A published place as the public sees it: its address and its names. */
export interface PublicPlace {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly PlaceLabel[];
}

export interface PublicCountry extends PublicPlace {
  readonly code: string;
  readonly updatedAt: Date;
}

export interface PublicRegion extends PublicPlace {
  readonly country: PublicPlace;
  readonly updatedAt: Date;
}

export interface PublicCity extends PublicPlace {
  readonly country: PublicPlace;
  readonly region: PublicPlace | null;
  readonly updatedAt: Date;
}

/** A public City as a selector offers it, with its Region where it has one. */
export interface PublicCityChoice extends PublicPlace {
  readonly regionId: string | null;
}

/** A Centre as a list shows it: its names and where it is, nothing more. */
export interface PublicCentreSummary {
  readonly id: string;
  readonly slug: string;
  readonly isVirtual: boolean;
  readonly primaryLocale: Locale;
  readonly labels: readonly CentreLabel[];
  readonly country: PublicPlace;
  /** The Centre's Region: its City's, or its own when it has no City. */
  readonly region: PublicPlace | null;
  readonly city: PublicPlace | null;
}

/** A published Centre with every public fact it genuinely has. */
export interface PublicCentre extends PublicCentreSummary {
  readonly coordinates: Coordinates | null;
  readonly contacts: readonly CentreContact[];
  /** The PUBLIC Cities it serves beyond its own, in name order of their slugs. */
  readonly servedCities: readonly PublicPlace[];
  readonly updatedAt: Date;
}

export interface PublicCountryPage {
  readonly items: readonly PublicCountry[];
  readonly hasMore: boolean;
}
export interface PublicPlacePage {
  readonly items: readonly PublicPlace[];
  readonly hasMore: boolean;
}
export interface PublicCentrePage {
  readonly items: readonly PublicCentreSummary[];
  readonly hasMore: boolean;
}

/** A Centre a published News revision names, as attribution: public or absent. */
export interface CentreReference {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly PlaceLabel[];
}

/** One Centre an Editorial selector may offer, in any state but archived. */
export interface CentreChoice extends CentreReference {
  readonly state: GlobalState;
}

/** One public Centre for the `centres` sitemap segment. */
export interface CentreSitemapRow {
  readonly slug: string;
  readonly languages: readonly Locale[];
  readonly updatedAt: Date;
}

/* ===========================================================================
 * Pure helpers
 * ========================================================================= */

/**
 * The label a page renders: the reader's locale, then the record's primary
 * locale, then any. The locale travels with it so the markup can say which
 * language the words are actually in (WCAG 3.1.2).
 */
export function labelFor<L extends { readonly locale: Locale }>(
  record: { readonly labels: readonly L[]; readonly primaryLocale: Locale },
  locale: Locale,
): L | null {
  return (
    record.labels.find((label) => label.locale === locale) ??
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0] ??
    null
  );
}

/** The canonical public addresses, one function per resource — never assembled by hand. */
export const globalPaths = Object.freeze({
  home: (locale: Locale) => `/${locale}/global`,
  finder: (locale: Locale) => `/${locale}/global/find-a-centre`,
  countries: (locale: Locale) => `/${locale}/global/countries`,
  country: (locale: Locale, country: string) =>
    `/${locale}/global/countries/${encodeURIComponent(country)}`,
  region: (locale: Locale, country: string, region: string) =>
    `/${locale}/global/countries/${encodeURIComponent(country)}/regions/${encodeURIComponent(region)}`,
  city: (locale: Locale, country: string, city: string) =>
    `/${locale}/global/countries/${encodeURIComponent(country)}/cities/${encodeURIComponent(city)}`,
  centres: (locale: Locale) => `/${locale}/global/centres`,
  centre: (locale: Locale, centre: string) =>
    `/${locale}/global/centres/${encodeURIComponent(centre)}`,
  centreNews: (locale: Locale, centre: string) =>
    `/${locale}/global/centres/${encodeURIComponent(centre)}/news`,
  centreEvents: (locale: Locale, centre: string) =>
    `/${locale}/global/centres/${encodeURIComponent(centre)}/events`,
  centreContact: (locale: Locale, centre: string) =>
    `/${locale}/global/centres/${encodeURIComponent(centre)}/contact`,
  pakistan: (locale: Locale) => `/${locale}/global/pakistan`,
});
