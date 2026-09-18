import type { Locale } from '@minhaj/contracts';
import type { TopicView } from '@minhaj/contracts/taxonomy';

/**
 * Taxonomy's pure domain rules.
 *
 * Layer 1, and deliberately tiny. Most of what a canonical taxonomy must
 * guarantee is a property of the DATA rather than of a calculation — slug
 * uniqueness, one translation per locale, no cycle, no orphan — and every one
 * of those is enforced by the database, where a concurrent writer cannot step
 * around it. What is left here is the reasoning the interface and the
 * application service genuinely share, and nothing has been invented to make
 * the folder look substantial.
 *
 * No infrastructure, no framework, no persistence: these are functions over
 * values (DOMAIN_MODEL.md §3.1).
 */

/**
 * Which interface locales a Topic has NOT been translated into.
 *
 * THE POINT OF THE CANONICAL SEED BEING ENGLISH-ONLY. The nineteen seeded
 * topics ship with a fallback name and no Urdu or Arabic, because inventing
 * wording for religious and scholarly subjects is editorial work for people
 * qualified to do it. That gap must therefore be VISIBLE — an administrative
 * surface that silently rendered the English fallback everywhere would turn a
 * known, deliberate omission into one nobody notices.
 *
 * Returned in the order the platform declares its locales, so a coverage
 * indicator reads the same way on every row.
 */
export function missingTranslations(
  topic: Pick<TopicView, 'translatedLocales'>,
  supported: readonly Locale[],
): readonly Locale[] {
  const present = new Set(topic.translatedLocales);
  return supported.filter((locale) => !present.has(locale));
}

/**
 * The position a newly created sibling takes.
 *
 * APPENDED, not inserted. A new topic goes after the ones already there, which
 * is both what an administrator expects and what avoids renumbering rows the
 * change has nothing to do with. Ordering is `position` then `slug`, so a
 * collision would still render deterministically — this only keeps the common
 * case tidy.
 */
export function nextPosition(siblings: readonly Pick<TopicView, 'position'>[]): number {
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((sibling) => sibling.position)) + 1;
}

/**
 * The ancestor chain of one topic, nearest ancestor last.
 *
 * Built from rows the caller ALREADY HAS rather than by querying upward one
 * generation at a time — the breadcrumb on a topic page would otherwise be a
 * query per level. A chain that cannot be completed from the supplied rows is
 * returned as far as it goes, because a partial breadcrumb is more useful than
 * none and an administrator can see it is partial.
 *
 * Bounded by the number of rows supplied, so data the hierarchy trigger somehow
 * let through cannot turn this into an unbounded loop.
 */
export function topicBreadcrumb(
  topic: Pick<TopicView, 'id' | 'parentId'>,
  known: readonly TopicView[],
): readonly TopicView[] {
  const byId = new Map(known.map((entry) => [entry.id, entry]));
  const chain: TopicView[] = [];
  const seen = new Set<string>([topic.id]);

  let cursor = topic.parentId;
  while (cursor !== null && !seen.has(cursor)) {
    const ancestor = byId.get(cursor);
    if (ancestor === undefined) break;

    seen.add(cursor);
    chain.unshift(ancestor);
    cursor = ancestor.parentId;
  }

  return chain;
}
