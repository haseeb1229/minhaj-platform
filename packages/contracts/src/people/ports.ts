import type { Locale } from '../env/shared.ts';
import type { ContributorCapabilities } from '../identity/capabilities.ts';
import type {
  PersonDetail,
  PersonPage,
  PersonSitemapEntry,
  PersonStatus,
  ProfileKind,
  ProfileStatus,
  PublicPersonProfile,
  PublicTeacherEntry,
} from './values.ts';

/**
 * The ports between the People & Contributors context and what it depends on.
 *
 * Here for the same reason Identity's and Taxonomy's are: the context lives
 * under `apps/web/src/contexts/people-contributors/`, its adapter is physically
 * inside `packages/database`, and neither may import the other. Both import
 * this (ARCHITECTURE.md §3.1.1).
 *
 * THREE PORTS, AND THE SPLIT IS THE POINT.
 *
 *   - `PeopleReaderPort` — reads. Holding it confers no ability to change what
 *     it reads, so the PUBLIC profile page receives a surface on which no
 *     mutation exists.
 *   - `PeoplePersistencePort` — named administrative acts, reached only by the
 *     People context's own service.
 *   - `ContributorAccountPort` — the ONE thing People asks Identity. See its
 *     own note; it is the narrowest expression of the single dependency edge
 *     DOMAIN_MODEL.md §3.1 grants this context.
 *
 * NAMED ACTS, NEVER A REPOSITORY. There is no `update`, no `find(where)`, no
 * `save`, no transaction handle, no delegate and no generic page type anywhere
 * below. Each operation is one thing an administrator does, with its own
 * invariants (ARCHITECTURE.md §6.3 rule 13).
 *
 * WHO WRITES THE AUDIT ROW. The adapter does, inside the transaction that makes
 * the change — which is why every mutation takes an `auditAction` and an
 * `actorId`. The context owns the audit VOCABULARY; the payload is composed
 * where the before and after state is actually known, because a "before" read
 * taken outside the transaction is a value another writer can move.
 */

/* ===========================================================================
 * Reading
 * ========================================================================= */

/**
 * WHAT A PERSON LISTING IS ALLOWED TO BE.
 *
 * Bounded in every direction: an explicit row cap, an explicit offset, an
 * allowlisted status filter and a search term the adapter bounds again. There
 * is deliberately no "give me everything" shape, and no free-form `where`.
 *
 * ORDERING IS NOT A PARAMETER. It is fixed by the adapter to `slug` — which is
 * unique, so the order is TOTAL and a page boundary cannot show one row twice
 * or skip one. A caller-chosen sort would be a caller-chosen index, and an
 * unindexed order over a growing table is a scan per page.
 */
export interface PersonQuery {
  /** Free-text match against slug and stored names. Bounded by the adapter. */
  readonly query: string | null;
  /** `null` includes every lifecycle state. */
  readonly status: PersonStatus | null;
  /** Only people holding this profile kind. `null` does not filter. */
  readonly profileKind: ProfileKind | null;
  /** The interface locale each Person's label is resolved in. */
  readonly locale: Locale;
  readonly limit: number;
  readonly offset: number;
}

export interface PeopleReaderPort {
  contributorReferences(
    ids: readonly string[],
    locale: Locale,
  ): Promise<
    readonly { readonly id: string; readonly slug: string; readonly name: string }[]
  >;
  /** One bounded, deterministically ordered page of the contributor directory. */
  listPeople(query: PersonQuery): Promise<PersonPage>;

  /** One Person with every translation, variant and profile, for the editor. */
  findPerson(input: {
    readonly personId: string;
    readonly locale: Locale;
  }): Promise<PersonDetail | null>;

  /**
   * One Person as the PUBLIC profile page needs it, or `null`.
   *
   * PUBLISHED ONLY, AND THE PREDICATE IS IN THE QUERY. A draft or archived
   * Person is not returned at all, rather than returned and filtered by the
   * page — a visibility rule applied after the read is a visibility rule the
   * next caller can forget (SECURITY_BASELINE.md §3.4 rule 3).
   *
   * ARCHIVED FACETS ARE EXCLUDED THE SAME WAY, so the page cannot render a
   * withdrawn teacher facet by neglecting to check one field.
   */
  findPublicProfile(input: {
    readonly slug: string;
    readonly locale: Locale;
  }): Promise<PublicPersonProfile | null>;

  /**
   * Whether a slug names a genuinely public Person.
   *
   * WHY THIS EXISTS SEPARATELY FROM `findPublicProfile`. The two author aliases
   * must not redirect into a 404: ROUTE_MAP.md §9.1 rule 3 makes them 301s to a
   * canonical URL, and a 301 to a page that then 404s is a redirect chain
   * ending in nothing. The alias asks this question, gets a yes or a no, and
   * either redirects or 404s itself — without loading a profile it will not
   * render.
   */
  publicPersonExists(slug: string): Promise<boolean>;

  /**
   * Every publicly indexable Person URL, bounded, for the sitemap.
   *
   * Returns only `published` people, and for each one only the locales it
   * GENUINELY has a translation in. A sitemap listing a locale that falls back
   * would advertise a page that is not a language version of anything
   * (ROUTE_MAP.md §9.2, §9.4).
   */
  listSitemapEntries(
    limit: number,
    offset: number,
  ): Promise<readonly PersonSitemapEntry[]>;

  /**
   * Phase 23 — of the accounts named, those linked to a PUBLISHED Person
   * holding an ACTIVE TeacherProfile, with that profile's public facts.
   *
   * Asked by the Layer-4 Learning composition to LIST operational teachers
   * and to ADMIT a teaching scope; never to decide authority, which is
   * Identity's live grant and Learning's current scope. Bounded and capped.
   */
  publicTeachers(
    accountIds: readonly string[],
    locale: Locale,
  ): Promise<readonly PublicTeacherEntry[]>;

  /**
   * One PUBLISHED Person's public search projection data, or `null`.
   *
   * Exactly what the public profile shows and nothing else: names, variants,
   * biography and the prose of ACTIVE facets. Never the account link, never a
   * draft or archived facet (DELIVERY_PLAN.md Phase 17 — People).
   */
  searchPerson(id: string): Promise<PersonSearchRecord | null>;

  /** Published People in identifier order after `after`, bounded, with stamps. */
  searchPeople(input: {
    readonly after: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
}

/** What Search may know about one published Person. */
export interface PersonSearchRecord {
  readonly id: string;
  readonly slug: string;
  /** `Person.updatedAt`, which every People mutation moves. */
  readonly stamp: string;
  readonly translations: readonly {
    readonly locale: Locale;
    readonly name: string;
    readonly biography: string | null;
  }[];
  readonly nameVariants: readonly { readonly locale: Locale; readonly value: string }[];
  /** Prose of ACTIVE facets only, per locale it was genuinely written in. */
  readonly facetProse: readonly { readonly locale: Locale; readonly text: string }[];
}

/* ===========================================================================
 * The ONE Identity dependency
 * ========================================================================= */

/**
 * What People asks Identity & Access, and the whole of it.
 *
 * DOMAIN_MODEL.md §3.1 gives this context exactly one edge — "Layer 0; Identity
 * & Access *(to link a Person to an optional User)*" — and this port is that
 * edge written down. Two operations, both read-only, neither of which can
 * grant, revoke, enrol, elevate, list accounts or reveal an address.
 *
 * WHAT IS DELIBERATELY NOT ON IT. No `findAccount`, no email, no display name,
 * no status enum, no account search. People has no business knowing who an
 * account belongs to: it stores an opaque identifier and asks two questions
 * about it. An account DIRECTORY reached from here would make
 * `people.administer` a quiet grant of `users.read` (SECURITY_BASELINE.md
 * §19.1), which is exactly what the admin surface is built to avoid.
 *
 * IMPLEMENTED AT LAYER 4, over Identity's own public services. People never
 * queries an Identity table, and the Identity semantics — live assignments,
 * active roles, current bundle, active account — stay in the one service that
 * defines them.
 */
export interface ContributorAccountPort {
  /**
   * The four capability projections for one linked account.
   *
   * DERIVED LIVE FROM IDENTITY GRANTS, never from a profile and never from a
   * stored boolean (DOMAIN_MODEL.md §4.5). Fails closed for a disabled,
   * suspended or closed account because the permission read it is built on
   * already requires an active one.
   */
  capabilities(accountId: string): Promise<ContributorCapabilities>;

  /**
   * Of the accounts named, those Identity reports as CLOSED.
   *
   * THE RECONCILIATION HALF OF THE CLOSURE DISPOSITION. Identity owns account
   * closure and commits it in its own transaction; People then releases its own
   * link. If that second step is interrupted — the process stops between the
   * two — the link survives, and this is how the next attempt finds it.
   *
   * SET-BASED AND BOUNDED, so the repair is one query rather than one per
   * linked Person. It returns identifiers and nothing else: the caller learns
   * that an account it already knew about is closed, and no account data
   * crosses the boundary.
   */
  closedAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

/** What every People mutation carries, for the audit row it writes. */
export interface PeopleActorInput {
  /** The authenticated account performing the change, or null for system disposal. */
  readonly actorId: string | null;
  /** Closure-driven release is a system action, not a retained account association. */
  readonly actorType: 'user' | 'system';
  /** The permission that authorised it, recorded as `authorisingSource`. */
  readonly authorisingSource: string;
  /** The audited action name, owned by the People context. */
  readonly auditAction: string;
}

export interface CreatePersonInput extends PeopleActorInput {
  readonly slug: string;
  /**
   * The locale this Person's content is originally written in.
   *
   * CHOSEN, NOT ASSUMED. ROUTE_MAP.md §9.2.1 resolves `x-default` to the
   * original language when no English version exists, and a platform whose
   * corpus is substantially Urdu-original cannot infer that from a default.
   */
  readonly primaryLocale: Locale;
  /**
   * The name in the primary locale, required.
   *
   * A Person created without one would have no translation at all, so every
   * locale would resolve to nothing — and "nothing" is not a name a profile
   * page can render or a canonical URL can be justified by.
   */
  readonly name: string;
  readonly biography: string | null;
}

export interface PeoplePersistencePort {
  /* ---- Person ---------------------------------------------------------- */

  /**
   * Creates a Person and its primary-locale translation in ONE transaction.
   *
   * The two halves are inseparable for the same reason a Topic and its fallback
   * translation are: a Person row with no translation renders as nothing, and a
   * crash between two statements must not be able to produce one.
   *
   * Created as `draft`. Nothing arrives publicly visible.
   */
  createPerson(input: CreatePersonInput): Promise<PersonDetail>;

  /**
   * Writes one locale's name and biography.
   *
   * UPSERT ON (personId, locale), which the composite primary key makes
   * race-safe: two editors saving the Urdu name at once produce one row, and
   * neither had to read first to find out.
   */
  setPersonTranslation(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly locale: Locale;
      readonly name: string;
      readonly biography: string | null;
    },
  ): Promise<PersonDetail>;

  /**
   * Removes one locale's translation.
   *
   * REFUSED FOR THE PRIMARY LOCALE — by the adapter AND by a database trigger,
   * because a Person with no translation in their own primary language is a
   * Person whose canonical URL points at no genuine language version, which
   * ROUTE_MAP.md §9.3 does not permit to be indexable.
   */
  removePersonTranslation(
    input: PeopleActorInput & { readonly personId: string; readonly locale: Locale },
  ): Promise<PersonDetail>;

  /**
   * Moves a Person between draft, published and archived.
   *
   * There is NO delete. The runtime principal holds no DELETE on `Person`, so
   * this is the whole of the lifecycle — and a later content context's typed
   * contributor reference can therefore never be orphaned.
   */
  setPersonStatus(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly status: PersonStatus;
    },
  ): Promise<PersonDetail>;

  /* ---- Name variants --------------------------------------------------- */

  /**
   * Adds one alternative name.
   *
   * DE-DUPLICATED BY THE DATABASE on (person, locale, normalised form), and
   * COUNT-BOUNDED by a trigger. Both are properties of the data rather than of
   * this call, so two administrators adding the same variant at the same moment
   * produce one row rather than two.
   */
  addNameVariant(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly locale: Locale;
      readonly value: string;
    },
  ): Promise<PersonDetail>;

  /** Removes one alternative name. A variant entered in error must be removable. */
  removeNameVariant(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly variantId: string;
    },
  ): Promise<PersonDetail>;

  /* ---- The optional account link --------------------------------------- */

  /**
   * Links a Person to an account, or refuses.
   *
   * RACE-SAFE BY A UNIQUE INDEX, not by a pre-read. `Person.userId` is unique,
   * so two concurrent attempts to attach one account to two different people
   * end with exactly one link and a refusal — an application check performed
   * first would read a state the other transaction is in the middle of writing.
   *
   * THE ACCOUNT IS RE-VALIDATED SERVER-SIDE. The identifier arrives from a form
   * and is a user-controlled value; the foreign key is what makes a forged one
   * fail, and it fails in the database rather than on the strength of a lookup
   * the caller might have skipped.
   *
   * NOTHING IS COPIED. Not the address, not the display name. A contributor's
   * public name is editorial content entered here; an account's name is what
   * somebody typed at sign-up, and treating the second as the first would put
   * unreviewed personal data on a public page.
   */
  linkAccount(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly accountId: string;
    },
  ): Promise<PersonDetail>;

  /** Removes the link. IDEMPOTENT: unlinking an unlinked Person is a no-op. */
  unlinkAccount(
    input: PeopleActorInput & { readonly personId: string },
  ): Promise<PersonDetail>;

  /**
   * Releases the link held for a CLOSED account.
   *
   * PEOPLE'S OWN DISPOSITION, performed by People (SECURITY_BASELINE.md §19.1 —
   * "every semantic data owner owns the disposition of its own data"). Identity
   * closes the account in its own transaction and then asks; it never reaches
   * into this table, and there is no cross-context transaction anywhere in it.
   *
   * IDEMPOTENT AND KEYED BY ACCOUNT, not by Person, because the caller
   * coordinating a closure knows an account identifier and must not have to
   * discover whether a Person exists in order to ask. Returns whether a link
   * was actually released, so a reconciliation can report work rather than
   * guess at it.
   */
  releaseAccountLink(
    input: PeopleActorInput & { readonly accountId: string },
  ): Promise<boolean>;

  /**
   * The account identifiers this context currently holds links for, bounded.
   *
   * THE INPUT TO THE CLOSURE RECONCILIATION, and the only reason it exists. It
   * returns opaque identifiers People already stores — it discloses nothing it
   * was not given — so the coordinator can ask Identity which of them are
   * closed and finish a disposition that was interrupted.
   */
  linkedAccountIds(limit: number, offset: number): Promise<readonly string[]>;

  /* ---- Profiles -------------------------------------------------------- */

  /**
   * Creates one profile facet for a Person, as a `draft`.
   *
   * ONE PER KIND PER PERSON, enforced by a unique index on each of the four
   * tables. Four separate tables and four separate indexes, rather than one
   * table with a `kind` column: DOMAIN_MODEL.md §5.2 requires four distinct
   * aggregates, and a discriminated single table is the shape that makes them
   * one aggregate wearing four names.
   *
   * IT GRANTS NOTHING. Creating a TeacherProfile writes one row in one People
   * table and touches no `RoleAssignment`, which the Phase-5 suites assert
   * directly rather than infer.
   */
  createProfile(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly kind: ProfileKind;
    },
  ): Promise<PersonDetail>;

  /** Moves one facet between draft, active and archived. Never deletes it. */
  setProfileStatus(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly kind: ProfileKind;
      readonly status: ProfileStatus;
    },
  ): Promise<PersonDetail>;

  /**
   * Writes one facet's localised prose for one locale.
   *
   * Fields not carried by that kind are ignored rather than rejected, because
   * the alternative is four near-identical methods differing only in which
   * strings they accept. Which fields a kind HAS is fixed by the schema: an
   * AuthorProfile has no translation table at all, so there is nothing for a
   * stray value to be written into.
   */
  setProfileTranslation(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly kind: ProfileKind;
      readonly locale: Locale;
      readonly qualifications: string | null;
      readonly expertise: string | null;
      readonly biography: string | null;
      readonly subjects: string | null;
    },
  ): Promise<PersonDetail>;

  /**
   * Replaces the content languages one facet lists, as a whole set.
   *
   * A SET, WRITTEN WHOLE, because that is what it is: a language is listed or
   * it is not, and there is no third state for a membership row to be moved
   * into. Bounded by the accepted maximum, and refused above it.
   */
  setProfileLanguages(
    input: PeopleActorInput & {
      readonly personId: string;
      readonly kind: ProfileKind;
      readonly languages: readonly string[];
    },
  ): Promise<PersonDetail>;
}
