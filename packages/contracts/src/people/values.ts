import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';

/**
 * People & Contributors value types, and the schemas that validate
 * administrative input at a trust boundary (SECURITY_BASELINE.md §9.1).
 *
 * Layer 0 and browser-safe: types and schemas only. No persistence, no policy,
 * no reach. The People context owns what these MEAN; this module fixes their
 * SHAPE so the context, its adapter and the admin forms cannot describe the
 * same value three different ways.
 *
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT. A Person is a PUBLIC
 * contributor record and a User is a private ACCOUNT. DOMAIN_MODEL.md §5.2
 * requires Person, User and the four profiles to stay six distinct models, so
 * nothing here describes an account: there is no email schema, no account
 * status, no display name borrowed from Identity, and the optional link is an
 * opaque identifier that never appears on a public shape.
 *
 * WHAT IS DELIBERATELY ABSENT. Any shape describing a CONTRIBUTION to a work.
 * DOMAIN_MODEL.md §5.3 puts the relationship row in the context that owns the
 * TARGET, and no such context has shipped. `CONTRIBUTION_ROLES` below is the
 * stable vocabulary those future junctions will carry; it is a list of strings,
 * and there is deliberately no `ContributorReference`, no `targetType` and no
 * generic contribution type for one to be hung on.
 *
 * ALSO ABSENT: a capability boolean. `canTeach` and its three siblings are
 * projections of Identity grants (DOMAIN_MODEL.md §4.5); they live in
 * `../identity/authorization.ts`, where the authority they describe lives, and
 * no shape in this file stores one.
 */

/* ===========================================================================
 * Person
 * ========================================================================= */

/**
 * A Person's stable, URL-safe public identity.
 *
 * LOWERCASE ASCII, digits and single hyphens — the same narrow rule a Topic
 * slug follows, for the same two reasons: `/people/{slug}` is built from it,
 * and it is compared for uniqueness by a database index under the database's
 * own collation, where a permissive rule would let two slugs the index treats
 * as one be accepted by the application as two.
 *
 * NOT DERIVED FROM A NAME, and here that matters more than it does for a Topic.
 * A contributor's name is localised and frequently written in a non-Latin
 * script; a slug transliterated from it would depend on who transliterated it
 * and in which locale they happened to be working.
 *
 * IMMUTABLE ONCE CHOSEN. There is no slug-history table and no native 301 in
 * this phase, and DOMAIN_MODEL.md §19.7 is explicit that an EDITABLE canonical
 * slug requires both, delivered by the phase that makes it editable. Phase 5
 * takes the other branch of that rule: the slug is fixed at creation, enforced
 * by the application contract AND by a column-level DENY on the runtime
 * principal, exactly as `Topic.slug` is.
 */
export const personSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'A slug is lowercase letters, digits and single hyphens.',
  );

/**
 * A Person's display name in ONE interface locale.
 *
 * Generous at 200 characters because a full scholarly name with honorifics,
 * patronymics and a nisba is long, and truncating one is a way of getting
 * somebody's name wrong.
 */
export const personNameSchema = z.string().trim().min(1).max(200);

/**
 * A Person's biography in one interface locale.
 *
 * OPTIONAL, and empty means absent. A contributor record with no biography is
 * the normal case — especially for a historical author, about whom this
 * platform may hold nothing but a name — and a non-null column would be filled
 * with placeholder prose about real people, which is exactly what nobody should
 * invent (OPEN_DECISIONS.md §6.3).
 */
export const personBiographySchema = z.string().trim().max(4_000);

/**
 * Which interface locale a Person translation is written for.
 *
 * DERIVED FROM THE PLATFORM'S LOCALE VOCABULARY, not redeclared. A second list
 * here would drift from `localeSchema` silently.
 */
export const personLocaleSchema = localeSchema;

/**
 * A Person's lifecycle.
 *
 * THREE STATES, and each has an operation behind it.
 *
 * `draft` is the state a record is created in, and it is why this is not a
 * two-state lifecycle: a contributor record is entered before anybody has
 * confirmed it is right, and OPEN_DECISIONS.md §6.3 leaves authoritative
 * contributor records gated on an acceptance this project has not been given. A
 * draft Person is invisible to every public surface and to every sitemap.
 *
 * `published` is the only publicly visible state.
 *
 * `archived` is a record withdrawn from public view without being destroyed —
 * the runtime principal holds no DELETE on the table, so a later content
 * context's typed contributor reference can never be orphaned by an
 * administrator pressing a button.
 *
 * THIS IS NOT AN EDITORIAL WORKFLOW. There is no submit, no review queue and no
 * approver: Phase 6 owns the shared editorial workflow, and inventing a second
 * one here would leave two that have to agree (DOMAIN_MODEL.md §7.2).
 */
export const personStatusSchema = z.enum(['draft', 'published', 'archived']);
export type PersonStatus = z.infer<typeof personStatusSchema>;

/**
 * How many name variants one Person may hold per locale.
 *
 * AN ENGINEERING BOUND, NOT A PRODUCT RESTRICTION. No accepted document limits
 * how many ways a name may be written; what the bound does is give the read a
 * known ceiling, so an "also known as" list cannot become an unbounded column
 * of text on a public page. It is enforced in one place — the database trigger
 * — rather than by each writer remembering it.
 */
export const MAX_NAME_VARIANTS_PER_LOCALE = 8;

/**
 * One alternative way a Person's name is written, in one locale.
 *
 * WHY THIS IS A ROW AND NOT A DELIMITED COLUMN. A historical author is
 * routinely known by several names, and the public profile lists them. A
 * delimited string is a list the database cannot count, cannot index and cannot
 * de-duplicate, so every one of those jobs would move into application code
 * where a concurrent writer can step around it.
 */
export const personNameVariantSchema = z.string().trim().min(1).max(200);

/**
 * How a name variant is compared for duplication.
 *
 * CASE-FOLDED, WHITESPACE-COLLAPSED, AND NOTHING ELSE. Deliberately not
 * transliteration, not diacritic stripping and not compatibility decomposition:
 * removing the diacritics from a name written in Arabic script can change which
 * name it is, and a "duplicate" rule that merged two genuinely different names
 * would silently discard one of them.
 *
 * NFC, because the same Urdu or Arabic string can arrive from two keyboards as
 * two byte sequences, and a duplicate check comparing bytes would accept both.
 *
 * The normalised form is STORED, in its own column, so the uniqueness index is
 * over the value actually compared — an application that normalised at write
 * time and indexed the raw value would be enforcing a different rule from the
 * one it documented.
 */
export function normaliseNameVariant(value: string): string {
  return value.normalize('NFC').trim().replaceAll(/\s+/gu, ' ').toLowerCase();
}

/* ===========================================================================
 * Content language — a scalar, and NOT a Taxonomy reference
 * ========================================================================= */

/**
 * A language a scholar or teacher works in.
 *
 * A PEOPLE-OWNED SCALAR, DELIBERATELY. Taxonomy owns the administered content
 * language catalogue (DOMAIN_MODEL.md §6.3), and People may not depend on
 * Taxonomy — its allowlist row is "Layer 0; Identity & Access" and nothing else
 * (§3.1). A foreign key to `Language` would be precisely the edge that row
 * excludes, and importing Taxonomy's schema to validate a string would be the
 * same edge wearing a contract's clothes.
 *
 * So this validates the SHAPE of a BCP-47 style tag and claims nothing about a
 * catalogue. The duplication against Taxonomy's `languageCodeSchema` is real,
 * it is two regular expressions rather than a shared abstraction, and it is the
 * cheaper of the two mistakes available: the alternative was an architecture
 * edge taken during feature work.
 *
 * The private-use form is accepted for the same reason Taxonomy accepts it —
 * `qaa-x-local` is how a private agreement is written, and this repository's own
 * recovery rehearsal uses one.
 */
export const contributorLanguageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(16)
  .regex(
    /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:-x(?:-[a-z0-9]{1,8})+)?$/,
    'A language code is a lowercase BCP-47 style tag, e.g. `ur`, `pa-arab` or `qaa-x-local`.',
  );

/** How many languages one profile may list. Bounded for the same reason. */
export const MAX_PROFILE_LANGUAGES = 12;

/* ===========================================================================
 * Profiles — four distinct aggregates
 * ========================================================================= */

/**
 * The four profile kinds, as a value the interface can iterate.
 *
 * A LIST OF NAMES, NOT A DISCRIMINATOR COLUMN. Each kind is its own table, its
 * own aggregate and its own lifecycle (DOMAIN_MODEL.md §5.2), and nothing in
 * this repository stores one of these strings in a `type` column beside a
 * shared row. The list exists so an admin surface can render four sections and
 * an audit row can name which aggregate changed, without either writing the
 * four names out by hand and getting one wrong.
 */
export const PROFILE_KINDS = Object.freeze([
  'author',
  'speaker',
  'scholar',
  'teacher',
] as const);

export type ProfileKind = (typeof PROFILE_KINDS)[number];

/**
 * A profile's lifecycle.
 *
 * DESCRIPTION, NEVER AUTHORITY. An `active` TeacherProfile does not mean the
 * person may teach: `canTeach` is projected from the `teaching.perform` grant
 * and from nothing else (DOMAIN_MODEL.md §4.5). These three states say whether
 * a facet has been entered, whether it should appear on the public profile, and
 * whether it has been withdrawn. They say nothing about what anybody may do.
 *
 * INDEPENDENT PER PROFILE, which is the point of four aggregates: a person's
 * author facet stays active while their teacher facet is archived, and neither
 * transition touches the other or the Person.
 */
export const profileStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

/**
 * The localised prose fields the profile aggregates carry.
 *
 * FOUR FIELDS, EACH NAMED BY DOMAIN_MODEL.md §5.2's own table:
 * ScholarProfile holds "Qualifications, expertise, languages"; TeacherProfile
 * holds "Teaching subjects, languages, public biography".
 *
 * AUTHOR AND SPEAKER HAVE NONE, and that is not an oversight. §5.2 names no
 * field for either, so neither gets one: they are distinct aggregates because
 * they have distinct LIFECYCLES and distinct meanings, not because they have
 * distinct columns. Inventing a field apiece to make the four look symmetrical
 * would be modelling by table layout.
 *
 * FREE TEXT RATHER THAN STRUCTURED LISTS, for expertise and subjects
 * specifically, and the reason is an ownership boundary rather than laziness. A
 * structured subject vocabulary is a taxonomy, Taxonomy owns taxonomies, and
 * People may not depend on it. When a later phase gives a content context a
 * typed link between a teacher and a Topic, that junction belongs to the
 * context that owns the target (§6.2) — not to a shadow vocabulary grown here.
 */
export type ProfileTextField = 'qualifications' | 'expertise' | 'biography' | 'subjects';

/** A scholar's qualifications, in one interface locale. Optional; empty is absent. */
export const scholarQualificationsSchema = z.string().trim().max(2_000);

/** A scholar's areas of expertise, in one interface locale. */
export const scholarExpertiseSchema = z.string().trim().max(2_000);

/** A teacher's public biography, in one interface locale. */
export const teacherBiographySchema = z.string().trim().max(2_000);

/** The subjects a teacher teaches, in one interface locale. */
export const teacherSubjectsSchema = z.string().trim().max(2_000);

/* ===========================================================================
 * Contribution roles
 * ========================================================================= */

/**
 * THE contribution-role vocabulary (DOMAIN_MODEL.md §5.3).
 *
 * People owns the stable role VALUES. It does not own — and this phase does not
 * create — the rows that use them: "the contributor is referenced from People &
 * Contributors; the relationship row belongs to the owning content context".
 *
 * WHAT A LATER OWNER BUILDS, stated here because this list is the only part of
 * it that exists yet. A content context with contributors creates its OWN
 * junction at its OWN phase, with a real foreign key to its target, a real
 * foreign key to `Person`, and one of these strings as the role. What it must
 * NOT create is a `targetType` + `targetId` pair, which is the polymorphic
 * reference DOMAIN_MODEL.md §6.2 prohibits — and which is why no generic
 * contribution type exists anywhere in this contract for one to be built on.
 *
 * The seven names are transcribed from §5.3 and are not this implementation's
 * to extend: a new capacity is a domain decision, never a convenience taken
 * while wiring up a content type.
 */
export const CONTRIBUTION_ROLES = Object.freeze([
  'author',
  'translator',
  'editor',
  'compiler',
  'narrator',
  'reciter',
  'speaker',
] as const);

export type ContributionRole = (typeof CONTRIBUTION_ROLES)[number];

/* ===========================================================================
 * Read models
 * ========================================================================= */

/**
 * One Person's localised representation, resolved for one interface locale.
 *
 * REPORTS WHICH LOCALE IT CAME FROM, because ROUTE_MAP.md §9.3 requires a
 * VISIBLE language notice when content is shown in a language other than the
 * one requested — and a view model that hid the difference would make that
 * notice impossible to render honestly.
 */
export interface PersonLabel {
  readonly name: string;
  readonly biography: string | null;
  /** The locale the values above actually came from. */
  readonly resolvedLocale: Locale;
  /** True when `resolvedLocale` is not the locale that was asked for. */
  readonly fallback: boolean;
}

/** One stored Person translation, as the administrative editor shows it. */
export interface PersonTranslationView {
  readonly locale: Locale;
  readonly name: string;
  readonly biography: string | null;
}

/** One alternative name, as stored. */
export interface PersonNameVariantView {
  readonly id: string;
  readonly locale: Locale;
  readonly value: string;
}

/**
 * A Person as a listing shows it.
 *
 * NO ACCOUNT FIELDS. Not the linked account's address, not its name, not its
 * status — only WHETHER a link exists, which is what an administrator managing
 * the link needs to see. A projection carrying account data would hand
 * `people.administer` an Identity directory it was never granted
 * (SECURITY_BASELINE.md §19.1).
 */
export interface PersonView {
  readonly id: string;
  readonly slug: string;
  readonly status: PersonStatus;
  /**
   * The locale this Person's content was originally written in.
   *
   * NOT ASSUMED TO BE ENGLISH. Much of this corpus is Urdu-original or
   * Arabic-original, and both `x-default` resolution and canonical selection
   * depend on knowing which existing version is the genuine one
   * (ROUTE_MAP.md §9.2.1).
   */
  readonly primaryLocale: Locale;
  readonly label: PersonLabel;
  /** Which interface locales this Person has been translated into. */
  readonly translatedLocales: readonly Locale[];
  /** Whether an account is linked. NEVER which account. */
  readonly linked: boolean;
  /** The profile kinds that exist for this Person, whatever their status. */
  readonly profileKinds: readonly ProfileKind[];
  readonly updatedAt: Date;
}

/** One labelled piece of localised profile prose, resolved for one locale. */
export interface ProfileDetail {
  /** Which field this is, so the interface labels it in the reader's locale. */
  readonly field: ProfileTextField;
  readonly value: string;
  readonly resolvedLocale: Locale;
  readonly fallback: boolean;
}

/** One profile facet, resolved for one interface locale. */
export interface ProfileFacetView {
  readonly kind: ProfileKind;
  readonly status: ProfileStatus;
  /**
   * The facet's own localised prose, resolved with the same honesty
   * `PersonLabel` applies. Empty for Author and Speaker, which have no
   * canonically justified fields of their own.
   */
  readonly details: readonly ProfileDetail[];
  /** Content languages this facet lists. Empty for Author and Speaker. */
  readonly languages: readonly string[];
}

/** A Person with everything a PUBLIC profile page renders. */
export interface PublicPersonProfile {
  /**
   * The PERSON's own identifier — never an account's. It is the typed reference
   * later owners hold (a Video's speaker, a Work's contributor), so Layer 4 can
   * compose "this person's videos" from Media's public read without Media ever
   * reading People's tables.
   */
  readonly id: string;
  readonly slug: string;
  readonly label: PersonLabel;
  readonly nameVariants: readonly string[];
  /** Only the facets that are genuinely active. */
  readonly facets: readonly ProfileFacetView[];
  /**
   * The interface locales in which this Person's content GENUINELY exists.
   *
   * What `hreflang` is built from, and the reason it is a field rather than a
   * computation at the page: "untranslated content is never listed as an
   * alternate", and a page deriving alternates from the platform's locale list
   * would announce three versions of a Person who has one (ROUTE_MAP.md §9.2).
   */
  readonly contentLocales: readonly Locale[];
  readonly primaryLocale: Locale;
  /** Genuine content modification, for `lastmod`. Never build time. */
  readonly updatedAt: Date;
}

/** One profile's stored prose in one locale, as the admin editor shows it. */
export interface ProfileTranslationView {
  readonly locale: Locale;
  readonly qualifications: string | null;
  readonly expertise: string | null;
  readonly biography: string | null;
  readonly subjects: string | null;
}

/**
 * One profile aggregate as the administrative editor shows it.
 *
 * PRESENT FOR ALL FOUR KINDS EVEN WHEN THE ROW DOES NOT EXIST, with `id` and
 * `status` null. The editor needs to offer "add a scholar facet" beside the
 * three that already exist, and an absent entry would make the surface unable
 * to distinguish "no scholar profile" from "a scholar profile it failed to
 * load".
 */
export interface ProfileRecordView {
  readonly kind: ProfileKind;
  /** Null when this Person holds no profile of this kind. */
  readonly id: string | null;
  readonly status: ProfileStatus | null;
  readonly translations: readonly ProfileTranslationView[];
  readonly languages: readonly string[];
}

/** A Person with every stored translation and profile, for the admin editor. */
export interface PersonDetail extends PersonView {
  readonly translations: readonly PersonTranslationView[];
  readonly nameVariants: readonly PersonNameVariantView[];
  /** All four kinds' state, including the ones that do not exist yet. */
  readonly profiles: readonly ProfileRecordView[];
  /**
   * The linked account's opaque identifier, for the admin link control ONLY.
   *
   * PRESENT HERE AND ON NO PUBLIC SHAPE. `PersonView` carries a boolean and
   * `PublicPersonProfile` carries nothing, so the identifier cannot reach a
   * public page by riding on a type that is rendered there.
   */
  readonly linkedAccountId: string | null;
}

/**
 * One page of a bounded Person listing.
 *
 * Stated CONCRETELY rather than as a generic `Page<T>`, exactly as the Identity
 * and Taxonomy contracts state theirs: a generic page type may be instantiated
 * with anything, including a client or a delegate, so a surface built on one
 * cannot be SHOWN to be narrow (ARCHITECTURE.md §6.3 rule 13).
 */
export interface PersonPage {
  readonly items: readonly PersonView[];
  readonly more: boolean;
}

/**
 * One Person URL a sitemap may advertise.
 *
 * SLUG AND GENUINE LOCALES ONLY. Never a draft, never an archived record, and
 * never a locale the Person has no translation in — a sitemap advertising
 * either would be a false signal rather than a missing one (ROUTE_MAP.md §9.4).
 */
export interface PersonSitemapEntry {
  readonly slug: string;
  readonly contentLocales: readonly Locale[];
  /** Genuine content modification. */
  readonly updatedAt: Date;
}
