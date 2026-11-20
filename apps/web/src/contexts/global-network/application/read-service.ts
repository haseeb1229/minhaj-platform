import { z } from 'zod';

import {
  centreFinderSchema,
  centreListingQuerySchema,
  countryCodeSchema,
  GLOBAL_MAX_OFFSET,
  GLOBAL_PAGE,
  GLOBAL_PLACE_ROWS,
  globalIdSchema,
  globalSlugSchema,
  type CentrePlace,
  type CentreScope,
  type PublicCentrePage,
  type GlobalPublicReaderPort,
  type GlobalReferencePort,
} from '@minhaj/contracts/global';

/**
 * The PUBLIC Global Network read service — every directory page reads through
 * this, with no actor, no session and no permission: the directory is anonymous
 * public knowledge (ARCHITECTURE.md §8.1).
 *
 * A MALFORMED ADDRESS IS ABSENT, never an error and never a query: a slug that
 * does not parse resolves to nothing before the reader is asked.
 */

const slug = (value: string) => globalSlugSchema.safeParse(value).success;
const offsetSchema = z.number().int().min(0).max(GLOBAL_MAX_OFFSET);

/** What a finder query resolved to — kept distinct so each gets honest words. */
export type FinderResult =
  | { readonly status: 'invalid' }
  | {
      readonly status: 'ok';
      readonly scope: CentreScope;
      readonly page: PublicCentrePage;
      /** No public Centre exists at all — not "none match this filter". */
      readonly inventoryEmpty: boolean;
    };

export function createGlobalReadService(reader: GlobalPublicReaderPort) {
  return {
    /** Every public Country with its public Regions, Cities and Centres counted. */
    countryDirectory() {
      return reader.countryDirectory();
    },
    async country(countrySlug: string) {
      return slug(countrySlug) ? reader.country(countrySlug) : null;
    },
    async countryByCode(code: string) {
      const parsed = countryCodeSchema.safeParse(code);
      return parsed.success ? reader.countryByCode(parsed.data) : null;
    },
    async countryCanonicalSlug(countrySlug: string) {
      return slug(countrySlug) ? reader.countryCanonicalSlug(countrySlug) : null;
    },
    countryChoices() {
      return reader.countryChoices();
    },
    cityChoices(countryId: string) {
      return reader.cityChoices(globalIdSchema.parse(countryId));
    },
    countryRegions(countryId: string) {
      return reader.countryRegions(globalIdSchema.parse(countryId));
    },
    countryCities(countryId: string, region: string | 'none' | null, offset = 0) {
      return reader.countryCities(
        globalIdSchema.parse(countryId),
        region === null || region === 'none' ? region : globalIdSchema.parse(region),
        offsetSchema.parse(offset),
      );
    },
    async region(countrySlug: string, regionSlug: string) {
      return slug(countrySlug) && slug(regionSlug)
        ? reader.region(countrySlug, regionSlug)
        : null;
    },
    async regionCanonical(countrySlug: string, regionSlug: string) {
      return slug(countrySlug) && slug(regionSlug)
        ? reader.regionCanonical(countrySlug, regionSlug)
        : null;
    },
    async city(countrySlug: string, citySlug: string) {
      return slug(countrySlug) && slug(citySlug)
        ? reader.city(countrySlug, citySlug)
        : null;
    },
    async cityCanonical(countrySlug: string, citySlug: string) {
      return slug(countrySlug) && slug(citySlug)
        ? reader.cityCanonical(countrySlug, citySlug)
        : null;
    },

    /**
     * Find a Centre. A filter naming a place that is not public — or that does
     * not parse — is `invalid`: the finder says so rather than silently showing
     * every Centre, and never reveals whether a withheld place exists.
     */
    async find(raw: unknown): Promise<FinderResult> {
      const parsed = centreFinderSchema.safeParse(raw);
      if (!parsed.success) return { status: 'invalid' };
      const scope = await reader.scope(parsed.data);
      if (scope === null) return { status: 'invalid' };
      const page = await reader.centres({
        scope,
        kind: null,
        offset: parsed.data.offset,
        limit: GLOBAL_PAGE,
      });
      const inventoryEmpty =
        page.items.length === 0 && parsed.data.offset === 0
          ? !(await reader.hasPublicCentres())
          : false;
      return { status: 'ok', scope, page, inventoryEmpty };
    },

    /**
     * Phase 14 — a geography filter's public slugs resolved to identifiers, or
     * `null` when it names nothing public or does not parse: the caller then
     * refuses the filter rather than widening it.
     */
    async scope(raw: unknown): Promise<CentreScope | null> {
      const parsed = centreFinderSchema.safeParse(raw);
      return parsed.success ? reader.scope(parsed.data) : null;
    },

    /**
     * The public Centres within one resolved geography — optionally of one
     * kind — a page at a time, with the view's total. Every field is parsed
     * before the read.
     */
    centresIn(raw: unknown) {
      return reader.centres(centreListingQuerySchema.parse(raw));
    },
    /**
     * Where the public Centres of one Country (or of all) are, for a page to
     * count its places by — or `null` when there are more than the bound: the
     * page then offers its places uncounted rather than counting a subset.
     */
    async centrePlaces(countryId: string | null): Promise<readonly CentrePlace[] | null> {
      const rows = await reader.centrePlaces(
        countryId === null ? null : globalIdSchema.parse(countryId),
        GLOBAL_PLACE_ROWS,
      );
      return rows.length > GLOBAL_PLACE_ROWS ? null : rows;
    },
    async centre(centreSlug: string) {
      return slug(centreSlug) ? reader.centre(centreSlug) : null;
    },
    async centreCanonicalSlug(centreSlug: string) {
      return slug(centreSlug) ? reader.centreCanonicalSlug(centreSlug) : null;
    },
    /** Public Centres among these identifiers — attribution, nothing more. */
    centreReferences(ids: readonly string[]) {
      return reader.centreReferences(z.array(globalIdSchema).max(200).parse(ids));
    },
    /** Phase 14 — the public Centres among these, with where they are. */
    centreSummaries(ids: readonly string[]) {
      return reader.centreSummaries(z.array(globalIdSchema).max(200).parse(ids));
    },
    /**
     * Phase 14 — the public Centres PHYSICALLY in a Country or one of its Cities,
     * or `null` when there are more than `limit`: a caller then refuses the
     * filter rather than silently narrowing it to a subset.
     */
    async physicalCentreIds(
      scope: { readonly countryId: string; readonly cityId: string | null },
      limit: number,
    ): Promise<readonly string[] | null> {
      const bound = z.number().int().min(1).max(5000).parse(limit);
      const ids = await reader.physicalCentreIds(
        {
          countryId: globalIdSchema.parse(scope.countryId),
          cityId: scope.cityId === null ? null : globalIdSchema.parse(scope.cityId),
        },
        bound,
      );
      return ids.length > bound ? null : ids;
    },
    centreSitemap(offset: number, limit: number) {
      return reader.centreSitemap(offsetSchema.parse(offset), limit);
    },
  };
}

export type GlobalReadService = ReturnType<typeof createGlobalReadService>;

/**
 * Global's REFERENCE interface — what another context's composition may ask
 * about a Centre identity (Editorial choosing a Centre for a NewsArticle). It
 * validates every identifier and answers nothing about addresses, contacts or
 * geography.
 */
export function createCentreReferences(port: GlobalReferencePort) {
  return {
    centreChoices(text: string | null) {
      const query = z.string().trim().min(1).max(120).safeParse(text);
      return port.centreChoices(query.success ? query.data : null);
    },
    centresByIds(ids: readonly string[]) {
      return port.centresByIds(z.array(globalIdSchema).max(50).parse(ids));
    },
    async centreSelectable(id: string) {
      return globalIdSchema.safeParse(id).success ? port.centreSelectable(id) : false;
    },
  };
}

export type CentreReferences = ReturnType<typeof createCentreReferences>;
