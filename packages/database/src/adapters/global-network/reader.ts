import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  GLOBAL_CHOICES,
  GLOBAL_LIMITS,
  GLOBAL_PAGE,
  GLOBAL_REGION_LIST,
  type CentreChoice,
  type CentreContact,
  type CentreScope,
  type GlobalPublicReaderPort,
  type GlobalReferencePort,
  type PublicCentreSummary,
  type PublicCountry,
  type PublicPlace,
} from '@minhaj/contracts/global';

import { getDatabaseClient } from '../../client.ts';
import {
  BY_SLUG,
  boundedOffset,
  centreLabels,
  coordinatesOf,
  ID_BATCH,
  LABELS,
  localeOf,
  nameMatch,
  placeLabels,
  PUBLIC_CENTRE,
  PUBLIC_CITY,
  PUBLIC_COUNTRY,
  PUBLIC_REGION,
  stateOf,
  type CentreLabelRow,
  type PlaceLabelRow,
} from './shared.ts';

/**
 * The Global Network adapter's PUBLIC and REFERENCE halves.
 *
 * ONE PUBLIC PREDICATE PER LEVEL, IN THE QUERY (`./shared.ts`). Nothing here
 * can return a draft or archived record, or one beneath a withheld ancestor:
 * a stale page may omit a newly public Centre, never disclose a withdrawn one
 * (ARCHITECTURE.md §8.5).
 *
 * GLOBAL TABLES ONLY. No Editorial table is read; a Centre's News is Editorial's
 * own bounded read, composed beside this at Layer 4.
 *
 * NO N+1. A page of Centres is read with its Country, Region and City names in
 * the same query; a detail reads its contacts and served Cities with it.
 */

const PLACE_LABELS = { select: { locale: true, name: true }, ...LABELS } as const;

const PLACE = {
  id: true,
  slug: true,
  primaryLocale: true,
  labels: PLACE_LABELS,
} as const;

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  isVirtual: true,
  primaryLocale: true,
  labels: {
    select: { locale: true, name: true, description: true, address: true },
    ...LABELS,
  },
  country: { select: PLACE },
  region: { select: PLACE },
  city: { select: { ...PLACE, region: { select: PLACE } } },
} satisfies Prisma.CentreSelect;

/*
 * The ROW SHAPES the mappings read, as plain interfaces — never derived from the
 * generated client — so nothing this reader returns carries a Prisma type
 * (ARCHITECTURE.md §4.1). Each select above is checked against the client by
 * `satisfies`.
 */
interface PlaceRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly labels: readonly PlaceLabelRow[];
}

interface SummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly isVirtual: boolean;
  readonly primaryLocale: string;
  readonly labels: readonly CentreLabelRow[];
  readonly country: PlaceRow;
  readonly region: PlaceRow | null;
  readonly city: (PlaceRow & { readonly region: PlaceRow | null }) | null;
}

function place(row: PlaceRow): PublicPlace {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: localeOf(row.primaryLocale),
    labels: placeLabels(row.labels),
  };
}

function summary(row: SummaryRow): PublicCentreSummary {
  const region = row.city?.region ?? row.region;
  return {
    id: row.id,
    slug: row.slug,
    isVirtual: row.isVirtual,
    primaryLocale: localeOf(row.primaryLocale),
    labels: centreLabels(row.labels),
    country: place(row.country),
    region: region === null ? null : place(region),
    city: row.city === null ? null : place(row.city),
  };
}

/**
 * The Centres a scope covers. A City: in it or serving it. A Region: in it
 * directly, in one of its Cities, or serving a public City of it. Each is an
 * EXISTS on the Centre, so a Centre matching twice is still one row.
 */
function inScope(scope: CentreScope): Prisma.CentreWhereInput {
  const parts: Prisma.CentreWhereInput[] = [];
  if (scope.countryId !== null) parts.push({ countryId: scope.countryId });
  if (scope.regionId !== null)
    parts.push({
      OR: [
        { regionId: scope.regionId },
        { city: { is: { regionId: scope.regionId } } },
        { serves: { some: { city: { regionId: scope.regionId, ...PUBLIC_CITY } } } },
      ],
    });
  if (scope.cityId !== null)
    parts.push({
      OR: [{ cityId: scope.cityId }, { serves: { some: { cityId: scope.cityId } } }],
    });
  return parts.length === 0 ? {} : { AND: parts };
}

export function createGlobalPublicReader(): GlobalPublicReaderPort {
  const db = getDatabaseClient();

  async function publicCountry(
    by: { readonly slug: string } | { readonly code: string },
  ): Promise<PublicCountry | null> {
    const row = await db.country.findFirst({
      where: { ...by, ...PUBLIC_COUNTRY },
      select: { ...PLACE, code: true, updatedAt: true },
    });
    return row === null
      ? null
      : { ...place(row), code: row.code, updatedAt: row.updatedAt };
  }

  /** The public Country a current or former slug names, with its current slug. */
  async function countryBySlugHistory(
    slug: string,
  ): Promise<{ readonly id: string; readonly slug: string } | null> {
    const history = await db.countrySlugHistory.findFirst({
      where: { slug, country: PUBLIC_COUNTRY },
      select: { country: { select: { id: true, slug: true } } },
    });
    return history?.country ?? null;
  }

  return {
    async countries(offset) {
      const rows = await db.country.findMany({
        where: PUBLIC_COUNTRY,
        select: { ...PLACE, code: true, updatedAt: true },
        orderBy: [...BY_SLUG],
        skip: boundedOffset(offset),
        take: GLOBAL_PAGE + 1,
      });
      return {
        items: rows
          .slice(0, GLOBAL_PAGE)
          .map((row) => ({ ...place(row), code: row.code, updatedAt: row.updatedAt })),
        hasMore: rows.length > GLOBAL_PAGE,
      };
    },

    country(slug) {
      return publicCountry({ slug });
    },

    countryByCode(code) {
      return publicCountry({ code });
    },

    async countryCanonicalSlug(slug) {
      return (await countryBySlugHistory(slug))?.slug ?? null;
    },

    async countryChoices() {
      const rows = await db.country.findMany({
        where: PUBLIC_COUNTRY,
        select: PLACE,
        orderBy: [...BY_SLUG],
        take: GLOBAL_CHOICES,
      });
      return rows.map(place);
    },

    async cityChoices(countryId) {
      const rows = await db.city.findMany({
        where: { countryId, AND: [PUBLIC_CITY] },
        select: { ...PLACE, regionId: true },
        orderBy: [...BY_SLUG],
        take: GLOBAL_CHOICES,
      });
      return rows.map((row) => ({ ...place(row), regionId: row.regionId }));
    },

    async countryRegions(countryId) {
      const rows = await db.region.findMany({
        where: { countryId, ...PUBLIC_REGION },
        select: PLACE,
        orderBy: [...BY_SLUG],
        take: GLOBAL_REGION_LIST,
      });
      return rows.map(place);
    },

    async countryCities(countryId, region, offset) {
      const rows = await db.city.findMany({
        where: {
          countryId,
          AND: [
            PUBLIC_CITY,
            region === null
              ? {}
              : region === 'none'
                ? { regionId: null }
                : { regionId: region },
          ],
        },
        select: PLACE,
        orderBy: [...BY_SLUG],
        skip: boundedOffset(offset),
        take: GLOBAL_PAGE + 1,
      });
      return {
        items: rows.slice(0, GLOBAL_PAGE).map(place),
        hasMore: rows.length > GLOBAL_PAGE,
      };
    },

    async region(countrySlug, regionSlug) {
      const row = await db.region.findFirst({
        where: { slug: regionSlug, country: { slug: countrySlug }, AND: [PUBLIC_REGION] },
        select: { ...PLACE, updatedAt: true, country: { select: PLACE } },
      });
      return row === null
        ? null
        : { ...place(row), country: place(row.country), updatedAt: row.updatedAt };
    },

    async regionCanonical(countrySlug, regionSlug) {
      const country = await countryBySlugHistory(countrySlug);
      if (country === null) return null;
      const history = await db.regionSlugHistory.findFirst({
        where: { countryId: country.id, slug: regionSlug, region: PUBLIC_REGION },
        select: { region: { select: { slug: true } } },
      });
      return history === null
        ? null
        : { country: country.slug, region: history.region.slug };
    },

    async city(countrySlug, citySlug) {
      const row = await db.city.findFirst({
        where: { slug: citySlug, country: { slug: countrySlug }, AND: [PUBLIC_CITY] },
        select: {
          ...PLACE,
          updatedAt: true,
          country: { select: PLACE },
          region: { select: PLACE },
        },
      });
      return row === null
        ? null
        : {
            ...place(row),
            country: place(row.country),
            region: row.region === null ? null : place(row.region),
            updatedAt: row.updatedAt,
          };
    },

    async cityCanonical(countrySlug, citySlug) {
      const country = await countryBySlugHistory(countrySlug);
      if (country === null) return null;
      const history = await db.citySlugHistory.findFirst({
        where: { countryId: country.id, slug: citySlug, city: PUBLIC_CITY },
        select: { city: { select: { slug: true } } },
      });
      return history === null ? null : { country: country.slug, city: history.city.slug };
    },

    async scope({ country, region, city }) {
      if (country === null) return { countryId: null, regionId: null, cityId: null };
      const found = await db.country.findFirst({
        where: { slug: country, ...PUBLIC_COUNTRY },
        select: { id: true },
      });
      if (found === null) return null;
      let regionId: string | null = null;
      let cityId: string | null = null;
      if (region !== null) {
        const row = await db.region.findFirst({
          where: { countryId: found.id, slug: region, ...PUBLIC_REGION },
          select: { id: true },
        });
        if (row === null) return null;
        regionId = row.id;
      }
      if (city !== null) {
        const row = await db.city.findFirst({
          where: { countryId: found.id, slug: city, AND: [PUBLIC_CITY] },
          select: { id: true },
        });
        if (row === null) return null;
        cityId = row.id;
      }
      return { countryId: found.id, regionId, cityId };
    },

    async centres(scope, offset) {
      const rows = await db.centre.findMany({
        where: { AND: [PUBLIC_CENTRE, inScope(scope)] },
        select: SUMMARY_SELECT,
        orderBy: [...BY_SLUG],
        skip: boundedOffset(offset),
        take: GLOBAL_PAGE + 1,
      });
      return {
        items: rows.slice(0, GLOBAL_PAGE).map(summary),
        hasMore: rows.length > GLOBAL_PAGE,
      };
    },

    async hasPublicCentres() {
      return (
        (await db.centre.findFirst({ where: PUBLIC_CENTRE, select: { id: true } })) !==
        null
      );
    },

    async centre(slug) {
      const row = await db.centre.findFirst({
        where: { slug, ...PUBLIC_CENTRE },
        select: {
          ...SUMMARY_SELECT,
          latitude: true,
          longitude: true,
          updatedAt: true,
          contacts: {
            select: { channel: true, value: true },
            orderBy: { position: 'asc' },
          },
          serves: {
            where: { city: PUBLIC_CITY },
            select: { city: { select: PLACE } },
            orderBy: { city: { slug: 'asc' } },
            take: GLOBAL_LIMITS.servedCities,
          },
        },
      });
      if (row === null) return null;
      return {
        ...summary(row),
        coordinates: coordinatesOf(row.latitude, row.longitude),
        contacts: row.contacts.map((contact) => ({
          channel: contact.channel as CentreContact['channel'],
          value: contact.value,
        })),
        servedCities: row.serves.map((served) => place(served.city)),
        updatedAt: row.updatedAt,
      };
    },

    async centreCanonicalSlug(slug) {
      const history = await db.centreSlugHistory.findFirst({
        where: { slug, centre: PUBLIC_CENTRE },
        select: { centre: { select: { slug: true } } },
      });
      return history?.centre.slug ?? null;
    },

    async centreReferences(ids) {
      if (ids.length === 0) return [];
      const rows = await db.centre.findMany({
        where: { id: { in: [...ids].slice(0, ID_BATCH) }, ...PUBLIC_CENTRE },
        select: PLACE,
      });
      return rows.map(place);
    },

    async centreSummaries(ids) {
      if (ids.length === 0) return [];
      const rows = await db.centre.findMany({
        where: { id: { in: [...ids].slice(0, ID_BATCH) }, ...PUBLIC_CENTRE },
        select: SUMMARY_SELECT,
      });
      return rows.map(summary);
    },

    /**
     * WHERE A CENTRE IS, NOT WHOM IT SERVES. A Country matches a Centre of that
     * Country; a City only a Centre physically IN it — never one merely serving
     * it, and never a virtual Centre, which has no place (DOMAIN_MODEL.md
     * §17.1.1). Public Centres only, under public ancestors.
     */
    async physicalCentreIds({ countryId, cityId }, limit) {
      const rows = await db.centre.findMany({
        where: {
          ...PUBLIC_CENTRE,
          countryId,
          isVirtual: false,
          ...(cityId === null ? {} : { cityId }),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: Math.max(1, Math.trunc(limit) || 1) + 1,
      });
      return rows.map((row) => row.id);
    },

    async centreSitemap(offset, limit) {
      const rows = await db.centre.findMany({
        where: PUBLIC_CENTRE,
        select: { slug: true, updatedAt: true, labels: { select: { locale: true } } },
        orderBy: [...BY_SLUG],
        skip: boundedOffset(offset),
        take: Math.min(1000, Math.max(1, Math.trunc(limit) || 1)),
      });
      return rows.map((row) => ({
        slug: row.slug,
        updatedAt: row.updatedAt,
        languages: row.labels.map((label) => localeOf(label.locale)),
      }));
    },
  };
}

/**
 * The narrow REFERENCE surface: which Centres an editor may choose. Identity,
 * names and lifecycle state only — no address, contact or geography.
 */
export function createGlobalReferences(): GlobalReferencePort {
  const db = getDatabaseClient();
  const select = {
    id: true,
    slug: true,
    state: true,
    primaryLocale: true,
    labels: PLACE_LABELS,
  } as const;
  const toChoice = (row: PlaceRow & { readonly state: string }): CentreChoice => ({
    ...place(row),
    state: stateOf(row.state),
  });

  return {
    async centreChoices(text) {
      const rows = await db.centre.findMany({
        where: { state: { not: 'archived' }, ...nameMatch(text) },
        select,
        orderBy: [...BY_SLUG],
        take: GLOBAL_CHOICES,
      });
      return rows.map(toChoice);
    },

    async centresByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.centre.findMany({
        where: { id: { in: [...ids].slice(0, ID_BATCH) } },
        select,
      });
      return rows.map(toChoice);
    },

    async centreSelectable(id) {
      return (
        (await db.centre.findFirst({
          where: { id, state: { not: 'archived' } },
          select: { id: true },
        })) !== null
      );
    },
  };
}
