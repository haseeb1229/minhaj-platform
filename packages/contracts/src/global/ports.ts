import type {
  CentreChoice,
  CentreContact,
  CentreDetail,
  CentreRecord,
  CentreReference,
  CentreScope,
  CentreSitemapRow,
  CentreValue,
  CityRecord,
  CityValue,
  CountryRecord,
  CountryValue,
  GlobalAdminQuery,
  GlobalChoice,
  CentrePage,
  CityPage,
  CountryPage,
  PublicCentrePage,
  PublicCountryPage,
  PublicPlacePage,
  RegionPage,
  PublicCentre,
  PublicCentreSummary,
  PublicCity,
  PublicCityChoice,
  PublicCountry,
  PublicPlace,
  PublicRegion,
  RegionRecord,
  RegionValue,
} from './values.ts';

/**
 * The ports between the Global Network context and what it depends on
 * (ARCHITECTURE.md §3.1.1, §4.1).
 *
 * The context lives in `apps/web/src/contexts/global-network/` and its adapter
 * in `packages/database/src/adapters/global-network/`; neither imports the
 * other, and both import this. Every operation is ONE named act with its own
 * bounds — no repository, no `where`, no transaction handle.
 *
 * THREE READ SURFACES, AND THE SPLIT IS A SECURITY BOUNDARY.
 * `GlobalPublicReaderPort` has no method that returns a draft or archived
 * record, or anything beneath a non-public ancestor, and takes no actor: the
 * public directory is built on it and cannot render withheld state by
 * forgetting a check. `GlobalPersistencePort` is reached only through the
 * Global service, which re-checks `global.read` or `global.administer` live on
 * every call. `GlobalReferencePort` is the narrow surface another context's
 * composition may ask about a Centre IDENTITY — and nothing else.
 *
 * GLOBAL NEVER READS EDITORIAL. Centre-scoped News is composed at Layer 4 from
 * this context's Centre and Editorial's own bounded reader.
 */

export interface GlobalActor {
  readonly accountId: string;
}

/** The ONE thing Global asks Identity: does this account hold this permission now? */
export interface GlobalAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
}

/* ===========================================================================
 * Public reads — published records under published ancestors, only
 * ========================================================================= */

export interface GlobalPublicReaderPort {
  /** One bounded page of public Countries, in slug order. */
  countries(offset: number): Promise<PublicCountryPage>;
  country(slug: string): Promise<PublicCountry | null>;
  /** A public Country by its ISO code — the Pakistan entry point's question. */
  countryByCode(code: string): Promise<PublicCountry | null>;
  /** The current slug a current or FORMER slug of a public Country resolves to. */
  countryCanonicalSlug(slug: string): Promise<string | null>;
  /** Every public Country, bounded, in slug order — a finder's selector. */
  countryChoices(): Promise<readonly PublicPlace[]>;
  /**
   * A public Country's public Cities, bounded, in slug order, each with its
   * Region where it has one — a finder's selector and the Pakistan structure.
   */
  cityChoices(countryId: string): Promise<readonly PublicCityChoice[]>;
  /** A public Country's public Regions, bounded, in slug order. */
  countryRegions(countryId: string): Promise<readonly PublicPlace[]>;
  /**
   * One page of a public Country's public Cities: all of them, only those with
   * no Region (`'none'`), or those of one Region.
   */
  countryCities(
    countryId: string,
    region: string | 'none' | null,
    offset: number,
  ): Promise<PublicPlacePage>;

  region(countrySlug: string, regionSlug: string): Promise<PublicRegion | null>;
  /** The CURRENT Country and Region slugs any former pair resolves to — one hop. */
  regionCanonical(
    countrySlug: string,
    regionSlug: string,
  ): Promise<{ readonly country: string; readonly region: string } | null>;

  city(countrySlug: string, citySlug: string): Promise<PublicCity | null>;
  cityCanonical(
    countrySlug: string,
    citySlug: string,
  ): Promise<{ readonly country: string; readonly city: string } | null>;

  /**
   * Resolves a finder's public slugs to identifiers. `null` when a named place
   * is not public — the finder then reports an invalid filter rather than
   * silently widening to everything.
   */
  scope(input: {
    readonly country: string | null;
    readonly region: string | null;
    readonly city: string | null;
  }): Promise<CentreScope | null>;
  /**
   * One bounded page of public Centres within a scope, in slug order. A City
   * scope includes a Centre in that City OR serving it, once; a Region scope a
   * Centre in it (directly or through its City) or serving one of its Cities.
   */
  centres(scope: CentreScope, offset: number): Promise<PublicCentrePage>;
  /** Is there any public Centre at all? Distinguishes an empty inventory from no match. */
  hasPublicCentres(): Promise<boolean>;
  centre(slug: string): Promise<PublicCentre | null>;
  centreCanonicalSlug(slug: string): Promise<string | null>;
  /** The public Centres among these identifiers — attribution for News. Bounded. */
  centreReferences(ids: readonly string[]): Promise<readonly CentreReference[]>;
  /**
   * PHASE 14 — the public Centres among these identifiers with where they are:
   * what an Event card and an Event page say about the Centre it is held at.
   * Bounded.
   */
  centreSummaries(ids: readonly string[]): Promise<readonly PublicCentreSummary[]>;
  /**
   * PHASE 14 — the identifiers of the public Centres PHYSICALLY in a Country
   * or a City — never those merely serving it, and never a virtual Centre — at
   * most `limit + 1` of them, so a caller can tell a complete answer from one
   * it must refuse rather than truncate.
   */
  physicalCentreIds(
    scope: { readonly countryId: string; readonly cityId: string | null },
    limit: number,
  ): Promise<readonly string[]>;
  centreSitemap(offset: number, limit: number): Promise<readonly CentreSitemapRow[]>;
}

/* ===========================================================================
 * The reference surface another context's composition may use
 * ========================================================================= */

/**
 * What Editorial's composition may ask about Centres: which ones an editor may
 * choose, and whether one identifier is still such a choice. No address, no
 * contact, no geography, no write.
 */
export interface GlobalReferencePort {
  /** Centres in any state but archived, bounded, optionally narrowed by text. */
  centreChoices(text: string | null): Promise<readonly CentreChoice[]>;
  /** The choices among these identifiers, whatever their state — to show truthfully. */
  centresByIds(ids: readonly string[]): Promise<readonly CentreChoice[]>;
  /** Is this Centre one an editor may newly choose (it exists, not archived)? */
  centreSelectable(id: string): Promise<boolean>;
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

/** Who saves which record at which version; `id: null` creates. Named per level. */
interface GlobalSaveBase {
  readonly actorId: string;
  readonly id: string | null;
  readonly expectedVersion: number | null;
}
export interface CountrySave extends GlobalSaveBase {
  readonly value: CountryValue;
}
export interface RegionSave extends GlobalSaveBase {
  readonly value: RegionValue;
}
export interface CitySave extends GlobalSaveBase {
  readonly value: CityValue;
}
export interface CentreSave extends GlobalSaveBase {
  readonly value: CentreValue;
}

export interface GlobalPersistencePort {
  countries(query: GlobalAdminQuery): Promise<CountryPage>;
  country(id: string): Promise<CountryRecord | null>;
  saveCountry(input: CountrySave): Promise<CountryRecord>;

  regions(query: GlobalAdminQuery): Promise<RegionPage>;
  region(id: string): Promise<RegionRecord | null>;
  saveRegion(input: RegionSave): Promise<RegionRecord>;

  cities(query: GlobalAdminQuery): Promise<CityPage>;
  city(id: string): Promise<CityRecord | null>;
  saveCity(input: CitySave): Promise<CityRecord>;

  centres(query: GlobalAdminQuery): Promise<CentrePage>;
  centre(id: string): Promise<CentreDetail | null>;
  saveCentre(input: CentreSave): Promise<CentreRecord>;
  /**
   * Replaces a Centre's ordered contacts with `contacts` — ONLY if the Centre is
   * still at `expectedVersion` — and audits the named change by channel, never
   * by value.
   */
  setCentreContacts(input: {
    readonly actorId: string;
    readonly centreId: string;
    readonly expectedVersion: number;
    readonly contacts: readonly CentreContact[];
    readonly change: string;
  }): Promise<CentreDetail>;
  /** Replaces the Cities a Centre serves, under the same version claim. */
  setCentreServedCities(input: {
    readonly actorId: string;
    readonly centreId: string;
    readonly expectedVersion: number;
    readonly cityIds: readonly string[];
    readonly change: string;
  }): Promise<CentreDetail>;

  /** Bounded selector choices, in any state. */
  countryChoices(): Promise<readonly GlobalChoice[]>;
  regionChoices(countryId: string): Promise<readonly GlobalChoice[]>;
  cityChoices(countryId: string, text: string | null): Promise<readonly GlobalChoice[]>;
  /** The named choices, whatever their state — so a selected one is always shown. */
  choicesByIds(
    level: 'country' | 'region' | 'city',
    ids: readonly string[],
  ): Promise<readonly GlobalChoice[]>;
}
