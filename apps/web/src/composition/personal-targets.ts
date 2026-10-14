import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  collectionMemberPathOf,
  type CollectionMemberTarget,
} from '@minhaj/contracts/editorial';
import {
  PERSONAL_LIMITS,
  targetKey,
  type PersonalTarget,
} from '@minhaj/contracts/personalisation';

import { editorialReadRuntime } from './editorial-read';
import { hadithReadRuntime } from './hadith-read';
import { libraryReadRuntime } from './library-read';
import { mediaReadRuntime } from './media-read';
import { quranReadRuntime } from './quran-read';

/**
 * A person's saved and read targets, resolved by their OWNERS — Layer 4
 * (DOMAIN_MODEL.md §3.3, §14.2).
 *
 * Personalisation holds typed identities and nothing else. What a target is
 * called, whether anybody may see it now, and where it lives are each owner's
 * answers, asked here through the owners' PUBLIC read roots: Editorial for
 * Articles, Library for Works, Media for Videos, Quran for Ayat and Hadith for
 * citations. A target its owner does not show to everybody now — a withdrawn
 * article, an archived book, an inactive corpus — resolves as `unavailable`:
 * the person's record of it survives and says so honestly, and no title of a
 * non-public record ever reaches the page.
 *
 * BATCHED BY OWNER, NEVER PER TARGET. Targets are grouped by kind and each
 * owner is asked once per bounded batch, all owners together.
 */

export type ResolvedTarget =
  | {
      readonly status: 'available';
      readonly title: string;
      /** The language the title is written in, for `lang` on the page. */
      readonly titleLanguage: string;
      readonly href: string;
    }
  | { readonly status: 'unavailable' }
  /** Its owner could not be asked just now — not a statement about the target. */
  | { readonly status: 'unknown' };

function chunks<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += PERSONAL_LIMITS.resolveBatch)
    out.push(values.slice(start, start + PERSONAL_LIMITS.resolveBatch));
  return out;
}

function pick<T extends { readonly language: string }>(
  options: readonly T[],
  locale: string,
) {
  return options.find((option) => option.language === locale) ?? options[0];
}

function byTitles(
  target: CollectionMemberTarget,
  locale: Locale,
  path: string,
): ResolvedTarget {
  const chosen = pick(
    target.titles.map((t) => ({ language: t.languageCode, title: t.title })),
    locale,
  );
  return chosen === undefined
    ? { status: 'unavailable' }
    : {
        status: 'available',
        title: chosen.title,
        titleLanguage: chosen.language,
        href: `/${locale}${path}`,
      };
}

function referenceOf(row: {
  readonly id: string;
  readonly slug: string;
  readonly labels: readonly { readonly locale: string; readonly title: string }[];
}): CollectionMemberTarget {
  return {
    id: row.id,
    slug: row.slug,
    titles: row.labels.map((label) => ({
      languageCode: label.locale,
      title: label.title,
    })),
  };
}

/**
 * Every target's owner answer. With `strict`, an owner that cannot be asked is
 * an error — the form a WRITE needs, where "could not ask" must never read as
 * "may".
 */
export async function resolvePersonalTargets(
  targets: readonly PersonalTarget[],
  locale: Locale,
  options: { readonly strict?: boolean } = {},
): Promise<ReadonlyMap<string, ResolvedTarget>> {
  const ids = (kind: 'article' | 'work' | 'video' | 'hadith') => [
    ...new Set(targets.flatMap((target) => (target.kind === kind ? [target.id] : []))),
  ];
  const ayat = [
    ...new Map(
      targets.flatMap((target) =>
        target.kind === 'ayah'
          ? [[targetKey(target), { surah: target.surah, ayah: target.ayah }] as const]
          : [],
      ),
    ).values(),
  ];
  const resolved = new Map<string, ResolvedTarget>();

  const guarded = async (keys: readonly string[], read: () => Promise<void>) => {
    try {
      await read();
    } catch (error) {
      if (options.strict) throw error;
      for (const key of keys) resolved.set(key, { status: 'unknown' });
    }
  };

  const articles = ids('article');
  const works = ids('work');
  const videos = ids('video');
  const citations = ids('hadith');

  await Promise.all([
    guarded(
      articles.map((id) => `article:${id}`),
      async () => {
        for (const batch of chunks(articles)) {
          const found = await editorialReadRuntime().memberTargets(
            batch.map((id) => ({ kind: 'article' as const, id })),
          );
          for (const [, target] of found)
            resolved.set(
              `article:${target.id}`,
              byTitles(target, locale, collectionMemberPathOf('article', target.slug)),
            );
        }
      },
    ),
    guarded(
      works.map((id) => `work:${id}`),
      async () => {
        for (const batch of chunks(works))
          for (const row of await libraryReadRuntime().workReferences(batch))
            resolved.set(
              `work:${row.id}`,
              byTitles(
                referenceOf(row),
                locale,
                collectionMemberPathOf('work', row.slug),
              ),
            );
      },
    ),
    guarded(
      videos.map((id) => `video:${id}`),
      async () => {
        for (const batch of chunks(videos))
          for (const row of await mediaReadRuntime().videoReferences(batch))
            resolved.set(
              `video:${row.id}`,
              byTitles(
                referenceOf(row),
                locale,
                collectionMemberPathOf('video', row.slug),
              ),
            );
      },
    ),
    guarded(
      ayat.map((ref) => `ayah:${ref.surah}:${ref.ayah}`),
      async () => {
        if (ayat.length === 0) return;
        const reader = quranReadRuntime().reader;
        const [found, surahs] = await Promise.all([
          Promise.all(chunks(ayat).map((batch) => reader.publicAyahTargets(batch))),
          reader.surahs(),
        ]);
        const names = new Map(surahs.map((surah) => [surah.number, surah]));
        for (const ref of found.flat()) {
          const surah = names.get(ref.surah);
          const localName = surah?.names[locale];
          const name = localName ?? surah?.nameArabic ?? String(ref.surah);
          resolved.set(`ayah:${ref.surah}:${ref.ayah}`, {
            status: 'available',
            title: `${name} ${ref.surah}:${ref.ayah}`,
            titleLanguage: localName !== undefined ? locale : 'ar',
            href: `/${locale}/quran/surah/${ref.surah}/${ref.ayah}`,
          });
        }
      },
    ),
    guarded(
      citations.map((id) => `hadith:${id}`),
      async () => {
        if (citations.length === 0) return;
        const reader = hadithReadRuntime().reader;
        const [found, collections] = await Promise.all([
          Promise.all(
            chunks(citations).map((batch) => reader.publicCitationTargets(batch)),
          ),
          reader.collections(),
        ]);
        const bySlug = new Map(
          collections.map((collection) => [collection.slug, collection]),
        );
        for (const citation of found.flat()) {
          const names = (bySlug.get(citation.collectionSlug)?.names ?? []).map((n) => ({
            language: n.locale as string,
            title: n.name,
          }));
          const chosen = pick(names, locale);
          resolved.set(`hadith:${citation.citationId}`, {
            status: 'available',
            title: `${chosen?.title ?? citation.collectionSlug} ${citation.number}`,
            titleLanguage: chosen?.language ?? locale,
            href: `/${locale}/hadith/${encodeURIComponent(citation.collectionSlug)}/${citation.number}`,
          });
        }
      },
    ),
  ]);

  for (const target of targets) {
    const key = targetKey(target);
    if (!resolved.has(key)) resolved.set(key, { status: 'unavailable' });
  }
  return resolved;
}

/** Whether one target is public now — strict, so an outage never reads as "yes". */
export async function isPublicTarget(target: PersonalTarget): Promise<boolean> {
  const resolved = await resolvePersonalTargets([target], 'en', { strict: true });
  return resolved.get(targetKey(target))?.status === 'available';
}
