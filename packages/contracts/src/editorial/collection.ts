import { z } from 'zod';

import { NEWS_KINDS, newsPathOf, type NewsKind } from './news.ts';

/**
 * Collection — Phase 15, inside Editorial (DOMAIN_MODEL.md §7.1, §7.3).
 *
 * A PUBLIC, CURATED, ORDERED, DESCRIBED SET THAT REFERENCES EXISTING CONTENT.
 * It shares Editorial's workflow, translations, typed Topic and Person
 * references and slug history, and owns what is genuinely its own: WHICH
 * records it gathers and in WHAT ORDER. It never owns, copies or publishes the
 * content it names — a member's title, address and availability are its
 * owner's answer at render time.
 *
 * NOT A PRIVATE COLLECTION. A visitor's own saved list is Personalisation's
 * future `PrivateCollection` (§11, §18); nothing here is user-owned, private or
 * shared with it.
 *
 * MEMBERSHIP IS REVISION STATE. The ordered members belong to an immutable
 * Collection revision, exactly like its translations and topics, so adding,
 * removing or reordering a member is an ordinary edit: a new revision, back to
 * draft, the old approval and any publication schedule cleared, fresh
 * independent review.
 *
 * TYPED, NEVER POLYMORPHIC. Each member is one of the content types the
 * phase's prerequisites delivered (DELIVERY_PLAN.md Phase 15: 6, 8, 10 and 13),
 * stored in its own typed, foreign-keyed column. A later domain adds its own
 * member type, and its own column, when it arrives.
 */

/* ===========================================================================
 * The member inventory — exactly the prerequisites' content records
 * ========================================================================= */

/**
 * The member types, in the order an editor meets them.
 *
 *   article          — Phase 6's long-form Article.
 *   news families    — Phase 13's NewsArticle, PressRelease, Statement and
 *                      MediaCoverage: the campaign, conference and statement
 *                      archives §7.3 names are made of exactly these.
 *   work             — Phase 8's Work, the canonical book (`/library/books`).
 *   video            — Phase 10's Video, the canonical watchable unit.
 *
 * DELIBERATELY ABSENT: a Page (organisational and legal destinations, not
 * curated material); an Edition or BookTranslation (a manifestation of the Work
 * that is the canonical book); a Series or Playlist (themselves groupings of
 * Videos); and every type no prerequisite delivered — Event, Photo, Gallery,
 * audio, Phase-9 research and publications, Quran, Hadith, Fatwa, Learning,
 * Centres, People and private collections.
 */
export const COLLECTION_MEMBER_KINDS = Object.freeze([
  'article',
  ...NEWS_KINDS,
  'work',
  'video',
] as const);

export type CollectionMemberKind = (typeof COLLECTION_MEMBER_KINDS)[number];
export const collectionMemberKindSchema = z.enum(COLLECTION_MEMBER_KINDS);

/** The member types Editorial itself owns, resolved by its own reads. */
export type EditorialMemberKind = 'article' | NewsKind;

export function isEditorialMemberKind(
  kind: CollectionMemberKind,
): kind is EditorialMemberKind {
  return kind !== 'work' && kind !== 'video';
}

/* ===========================================================================
 * Bounds and addresses
 * ========================================================================= */

export const COLLECTION_LIMITS = Object.freeze({
  /**
   * Members one revision may hold. A Collection is read as ONE page — no
   * member pagination — and resolved with one bounded owner read per member
   * type, so its size is what one page and one batch per owner comfortably
   * carry. A larger archive is several Collections, each a curated set.
   */
  members: 100,
});

/** One page of the public Collection listing. */
export const COLLECTION_PAGE = 20;
/** The deepest offset the public listing accepts. */
export const COLLECTION_MAX_OFFSET = 25_000;
/** A topic hub's Collection section previews at most this many. */
export const COLLECTION_PREVIEW = 6;
/** How many choices of ONE member type an editor's selector offers at once. */
export const COLLECTION_MEMBER_CHOICES = 10;

/** The locale-free canonical address of one Collection. */
export function collectionPathOf(slug: string): string {
  return `/collections/${encodeURIComponent(slug)}`;
}

/**
 * The locale-free canonical address of a member — ITS OWNER'S address, never a
 * second one under the Collection.
 */
export function collectionMemberPathOf(kind: CollectionMemberKind, slug: string): string {
  const segment = encodeURIComponent(slug);
  if (kind === 'article') return `/library/articles/${segment}`;
  if (kind === 'work') return `/library/books/${segment}`;
  if (kind === 'video') return `/watch/videos/${segment}`;
  return newsPathOf(kind, slug);
}

/* ===========================================================================
 * Membership as an editor submits it
 * ========================================================================= */

export const collectionMemberSchema = z.strictObject({
  kind: collectionMemberKindSchema,
  id: z.uuid(),
});

export type CollectionMember = z.infer<typeof collectionMemberSchema>;

/**
 * ONE ordered list across every type — the order is the list's — with at least
 * one member, at most the bound, and no record twice. An empty curated set is
 * not a Collection, so it can never be saved, reviewed or published.
 */
export const collectionMembersSchema = z
  .array(collectionMemberSchema)
  .min(1)
  .max(COLLECTION_LIMITS.members)
  .refine(
    (members) =>
      new Set(members.map((member) => `${member.kind}:${member.id}`)).size ===
      members.length,
    { message: 'A record is a member once.' },
  );

/** `kind:id` — the one form a member travels in through a form field. */
export function memberToken(member: CollectionMember): string {
  return `${member.kind}:${member.id}`;
}

/** The member a `kind:id` token names, or `null` when it names none. */
export function memberOfToken(token: string): CollectionMember | null {
  const separator = token.indexOf(':');
  if (separator < 1) return null;
  const parsed = collectionMemberSchema.safeParse({
    kind: token.slice(0, separator),
    id: token.slice(separator + 1),
  });
  return parsed.success ? parsed.data : null;
}

/* ===========================================================================
 * Read models
 * ========================================================================= */

/**
 * What an owner says about ONE public member: its current address and its
 * titles. Only currently public records are ever described; a withdrawn one is
 * simply absent from the answer.
 */
export interface CollectionMemberTarget {
  readonly id: string;
  readonly slug: string;
  readonly titles: readonly {
    readonly languageCode: string;
    readonly title: string;
  }[];
}

/** One card: what the listing and the topic hub show of a Collection. */
export interface CollectionSummary {
  readonly slug: string;
  readonly primaryLanguage: 'en' | 'ur' | 'ar';
  readonly translations: readonly {
    readonly languageCode: 'en' | 'ur' | 'ar';
    readonly title: string;
    readonly excerpt: string;
  }[];
  readonly topicIds: readonly string[];
}

export interface CollectionPage {
  readonly items: readonly CollectionSummary[];
  readonly more: boolean;
}
