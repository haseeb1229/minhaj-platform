import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';

/**
 * Taxonomy value types and the schemas that validate administrative input at a
 * trust boundary (SECURITY_BASELINE.md §9.1).
 *
 * Layer 0 and browser-safe: types and schemas only. No persistence, no policy,
 * no reach. The Taxonomy context owns what these MEAN; this module fixes their
 * SHAPE so the context, its adapter and the admin forms cannot describe the
 * same value three different ways.
 *
 * THE ONE DISTINCTION THIS FILE EXISTS TO PROTECT. A Topic's localised name is
 * keyed by INTERFACE LOCALE — the language the administrative and public
 * interface is being read in. A `Language` record is a CONTENT language — what
 * a work is written in. DOMAIN_MODEL.md §18 names conflating the two as a
 * modelling error, so they do not share a key, a table or a schema here:
 * `topicLocaleSchema` derives from the platform's interface-locale vocabulary,
 * and `languageCodeSchema` is an independent free-form code with no
 * relationship to it (DOMAIN_MODEL.md §6.3, §19.1).
 */

/* ===========================================================================
 * Topic
 * ========================================================================= */

/**
 * How deep the Topic tree may go, counting a root as depth 1.
 *
 * AN ENGINEERING BOUND, NOT A PRODUCT RESTRICTION. No accepted document limits
 * the shape of the subject taxonomy; what this number does is give the
 * hierarchy's recursive read and its cycle-detection trigger a known ceiling,
 * so "hierarchy query complexity understood" is a fact rather than a hope. The
 * canonical seed is one level deep, so the bound is
 * generous by a wide margin and is enforced in exactly one place — the
 * database trigger — rather than by each writer remembering it.
 */
export const MAX_TOPIC_DEPTH = 8;

/**
 * A Topic's stable, URL-safe identity.
 *
 * LOWERCASE ASCII, digits and single hyphens. Deliberately narrow: the slug is
 * what `/topics/{slug}` will be built from, it is compared for uniqueness by a
 * database index under the database's own collation, and a permissive rule
 * would let two slugs that a case-insensitive index treats as one be accepted
 * by the application as two.
 *
 * NOT NORMALISED FROM THE NAME. A slug derived from a localised name would
 * change meaning with the locale it was derived in, and a canonical identifier
 * that depends on who typed it is not canonical. It is entered and it is
 * stable.
 */
export const topicSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'A slug is lowercase letters, digits and single hyphens.',
  );

/** A Topic's localised display name, in one interface locale. */
export const topicNameSchema = z.string().trim().min(1).max(200);

/**
 * A Topic's localised description.
 *
 * OPTIONAL, and empty means absent. A taxonomy whose every description had to
 * be non-null the moment a topic was created would be filled with placeholder
 * prose, and placeholder prose about religious subject matter is exactly what
 * nobody should invent to satisfy a column.
 */
export const topicDescriptionSchema = z.string().trim().max(500);

/**
 * Which interface locale a Topic translation is written for.
 *
 * DERIVED FROM THE PLATFORM'S LOCALE VOCABULARY, not redeclared. `localeSchema`
 * in `../env/shared.ts` is the single definition of the supported interface
 * locales (ROUTE_MAP.md §1.2), and a second list here would drift from it
 * silently.
 */
export const topicLocaleSchema = localeSchema;

/**
 * THE locale a Topic's representation falls back to.
 *
 * `en`, because ROUTE_MAP.md §1.1 fixes it as the final step of locale
 * resolution. It is a contract, not configuration.
 *
 * TWO MECHANISMS KEEP IT PRESENT, and neither covers the other's half: the
 * Taxonomy adapter writes a Topic and its fallback translation in ONE
 * transaction, and the `TaxonomyTopicFallback` database trigger refuses any
 * write that would REMOVE one. Together they mean no path this application has
 * produces a Topic without a name to render.
 */
export const TOPIC_FALLBACK_LOCALE: Locale = 'en';

/**
 * A Topic's lifecycle.
 *
 * TWO STATES, and no more. DOMAIN_MODEL.md §6.1 requires a status; it does not
 * require the editorial publication workflow of §19.2, which belongs to the
 * contexts that publish content. A canonical subject either classifies things
 * or it has been retired from use, and inventing `draft`, `in-review` and
 * `scheduled` for a taxonomy nobody drafts would be four states with no
 * operation behind three of them.
 *
 * ARCHIVED IS NOT DELETED. A Topic is never hard-deleted at runtime — the
 * database principal holds no DELETE on the table — because a later context's
 * typed assignment may reference it and because the canonical seed's identity
 * is meant to be stable for the platform's life.
 */
export const topicStatusSchema = z.enum(['active', 'archived']);
export type TopicStatus = z.infer<typeof topicStatusSchema>;

/* ===========================================================================
 * Language — CONTENT language, not interface locale
 * ========================================================================= */

/**
 * A content language's stable code.
 *
 * BCP-47 SHAPED, lowercase: `ar`, `ur`, `en`, `pa-arab`, `zh-hans`. Stored and
 * compared in one canonical case so a database index and the application agree
 * about what a duplicate is.
 *
 * THE PRIVATE-USE FORM IS ACCEPTED, and it has to be. BCP-47 writes private
 * agreements as the SINGLETON `x` followed by subtags — `qaa-x-manuscript` —
 * and a singleton is one character, which the two-to-eight rule for ordinary
 * subtags refuses. Leaving it out made the recovery rehearsal's own synthetic
 * language unenterable through the interface that administers it: a validator
 * strict enough to reject a form this repository itself uses.
 *
 * INDEPENDENT OF `localeSchema`, deliberately and structurally. The platform's
 * interface locales are three; the languages its content is written in are
 * however many the organisation publishes in, and the catalogue below is
 * administered rather than compiled in. Deriving this from the interface
 * locales would make adding a content language require a code change, and
 * would make retiring one change the interface — which is precisely the
 * conflation DOMAIN_MODEL.md §18 names.
 */
export const languageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(16)
  .regex(
    /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:-x(?:-[a-z0-9]{1,8})+)?$/,
    'A language code is a lowercase BCP-47 style tag, e.g. `ur`, `pa-arab` or `qaa-x-local`.',
  );

/** The language's name in English, for an administrative listing. */
export const languageEnglishNameSchema = z.string().trim().min(1).max(120);

/**
 * The language's name in its own language and script.
 *
 * Required, not optional. A content-language catalogue that can only name a
 * language in English is unusable to the readers the language exists for, and
 * the endonym is what a public language filter will show them.
 */
export const languageNativeNameSchema = z.string().trim().min(1).max(120);

/**
 * Writing direction — DOMAIN DATA, not the interface's direction.
 *
 * The interface's direction comes from the interface locale and is Phase 3A's.
 * This one is a property of the language a work is written in: a book in Urdu
 * renders right-to-left inside an English page, and nothing but the content
 * language can say so (DOMAIN_MODEL.md §19.1).
 */
export const languageDirectionSchema = z.enum(['ltr', 'rtl']);
export type LanguageDirection = z.infer<typeof languageDirectionSchema>;

/**
 * A content language's lifecycle.
 *
 * `retired` rather than deleted, for the same reason a Topic is archived: a
 * language a work was recorded in stays true after the organisation stops
 * publishing in it, and a delete would either break that record or be blocked
 * by it.
 */
export const languageStatusSchema = z.enum(['active', 'retired']);
export type LanguageStatus = z.infer<typeof languageStatusSchema>;

/* ===========================================================================
 * Tag — free-form, and nothing like a Topic
 * ========================================================================= */

/**
 * A Tag's stable identity.
 *
 * Same shape as a Topic slug and a completely different promise. It exists so
 * "the same tag" means something under concurrency — two editors typing
 * `peace-conference` produce one row — and NOT because a Tag is a canonical
 * subject. DOMAIN_MODEL.md §6.4: tags have no hierarchy, no curation and no
 * cross-context guarantees, and are never a substitute for the taxonomy.
 */
export const tagSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'A slug is lowercase letters, digits and single hyphens.',
  );

/**
 * A Tag's display label. Free-form, in whatever script the editor uses.
 *
 * ONE LABEL, NOT A TRANSLATION SET. A Topic is localised because it is the
 * canonical, curated vocabulary the platform navigates by; a Tag is an
 * editorial convenience. Giving Tag a translation table would make it look
 * like a Topic in the one place the distinction matters most — the screen an
 * editor works on.
 */
export const tagLabelSchema = z.string().trim().min(1).max(120);

export const tagStatusSchema = z.enum(['active', 'retired']);
export type TagStatus = z.infer<typeof tagStatusSchema>;

/* ===========================================================================
 * Read models
 * ========================================================================= */

/** One Topic's localised representation, resolved for one interface locale. */
export interface TopicLabel {
  readonly name: string;
  readonly description: string | null;
  /**
   * The locale the values above actually came from.
   *
   * Reported rather than hidden, so an administrator can SEE that a topic is
   * showing English inside an Urdu page instead of wondering why it reads the
   * way it does — and so a translation-coverage surface needs no second query.
   */
  readonly resolvedLocale: Locale;
  /** True when `resolvedLocale` is not the locale that was asked for. */
  readonly fallback: boolean;
}

/** A Topic, with its localised representation for one interface locale. */
export interface TopicView {
  readonly id: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly position: number;
  readonly status: TopicStatus;
  /** Canonical seed data: protected, and not ordinary administrative content. */
  readonly system: boolean;
  /** Depth in the tree, counting a root as 1. */
  readonly depth: number;
  readonly label: TopicLabel;
  /** Which interface locales this Topic has been translated into. */
  readonly translatedLocales: readonly Locale[];
}

/** One stored translation row, as the administrative editor shows it. */
export interface TopicTranslationView {
  readonly locale: Locale;
  readonly name: string;
  readonly description: string | null;
}

/** A Topic with every stored translation, for the administrative editor. */
export interface TopicDetail extends TopicView {
  readonly translations: readonly TopicTranslationView[];
}

export interface LanguageView {
  readonly code: string;
  readonly englishName: string;
  readonly nativeName: string;
  readonly direction: LanguageDirection;
  readonly status: LanguageStatus;
}

export interface TagView {
  readonly id: string;
  readonly slug: string;
  readonly label: string;
  readonly status: TagStatus;
}

/**
 * One page of a bounded Tag listing.
 *
 * Stated CONCRETELY rather than as a generic `Page<T>`, exactly as the Identity
 * contract states its three: a generic page type may be instantiated with
 * anything, including a client or a delegate, so a surface built on one cannot
 * be SHOWN to be narrow (ARCHITECTURE.md §6.3 rule 13).
 */
export interface TagPage {
  readonly items: readonly TagView[];
  readonly more: boolean;
}

/**
 * ONE typed topic-assignment relationship the DATABASE actually enforces.
 *
 * Read from the database's own foreign-key catalogue, never from a list this
 * repository declares. That is the whole point: a declared registry would say
 * what somebody intended, and this says what the database will refuse to
 * violate (DOMAIN_MODEL.md §6.2).
 */
export interface TopicAssignmentStatus {
  /** Relationships whose real foreign key to Topic exists in the database. */
  readonly enforcedRelationships: number;
  /**
   * Relationships that point to Topic but have no second real target foreign
   * key. Non-zero means a later owner shipped a half-typed assignment.
   */
  readonly incompleteRelationships: number;
}
