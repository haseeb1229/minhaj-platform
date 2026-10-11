import 'server-only';

import { cache } from 'react';
import type { Metadata } from 'next';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { quranReadRuntime } from '@/composition/quran-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';
import {
  READING_LAYERS,
  type ReadingChoice,
  type ReadingLayer,
  type ReadingRequest,
} from './presentation';

/**
 * The public Quran reads a request shares, and the ONE metadata rule every
 * Quran page follows.
 *
 * READ ONCE PER REQUEST. `generateMetadata` and the page body ask the same
 * questions — is the corpus active, which Surah is this — so each is wrapped in
 * React's request cache and answered by the reader once.
 *
 * SESSION-FREE BY CONSTRUCTION. Everything here reaches `quranReadRuntime()`,
 * whose reader takes no actor and returns only what is public now; nothing in
 * this graph reaches Identity, a session or a cookie (ARCHITECTURE.md §8.1).
 */

export const quranAvailability = cache((): Promise<QuranAvailability> =>
  quranReadRuntime().reader.availability(),
);

export const readSurah = cache((number: number) =>
  quranReadRuntime().reader.surah(number),
);

export const readSurahs = cache(() => quranReadRuntime().reader.surahs());

export const readJuz = cache((number: number) => quranReadRuntime().reader.juz(number));

/** Taxonomy's foundation slug for the Quran subject — a vocabulary key, not content. */
export const QURAN_TOPIC_SLUG = 'quran';

/**
 * The `quran` Topic Taxonomy seeded with its foundation data (Phase 3B), or
 * `null` when it is absent or archived. The related-material views filter the
 * Library's and Media's own public listings by it; without it there is nothing
 * truthful to filter by and those views do not exist.
 */
export const readQuranTopic = cache(async (locale: Locale) => {
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({
    slug: QURAN_TOPIC_SLUG,
    locale,
  });
  return topic !== null && topic.status === 'active' ? topic : null;
});

/**
 * The reading preferences a page can honour, resolved against the PUBLIC works.
 *
 * FOUR LIST READS, NOT ONE PER REQUESTED SLUG: the form needs every public work
 * as an option anyway, and a requested slug is resolved by finding it among
 * them. A slug that is malformed, repeated or not public now is reported as
 * UNAVAILABLE — the page says so and shows no layer for it. It is never widened
 * to another work, and a withheld work cannot be reached by naming it, because
 * the reader never lists one (Phase 18 §5).
 */
export async function readingContext(request: ReadingRequest) {
  const reader = quranReadRuntime().reader;
  const [translations, transliterations, tafsirs, recitations] = await Promise.all([
    reader.translations(),
    reader.transliterations(),
    reader.tafsirs(),
    reader.recitations(),
  ]);

  const pick = <T extends { readonly slug: string }>(
    wanted: ReadingRequest[ReadingLayer],
    list: readonly T[],
  ): T | null =>
    wanted.state === 'requested'
      ? (list.find((work) => work.slug === wanted.slug) ?? null)
      : null;

  const chosen = {
    translation: pick(request.translation, translations),
    transliteration: pick(request.transliteration, transliterations),
    tafsir: pick(request.tafsir, tafsirs),
    reciter: pick(request.reciter, recitations),
  };

  const unavailable = READING_LAYERS.filter(
    (layer) => request[layer].state !== 'none' && chosen[layer] === null,
  );

  const choice: ReadingChoice = {
    translation: chosen.translation?.slug ?? null,
    transliteration: chosen.transliteration?.slug ?? null,
    tafsir: chosen.tafsir?.slug ?? null,
    reciter: chosen.reciter?.slug ?? null,
    size: request.size,
  };

  return {
    options: { translations, transliterations, tafsirs, recitations },
    chosen,
    unavailable,
    choice,
  };
}

export type ReadingContext = Awaited<ReturnType<typeof readingContext>>;

/** Is this deployment's corpus showing non-authoritative fixture text? */
export function isFixture(availability: QuranAvailability): boolean {
  return availability.active && availability.mode === 'fixture';
}

/**
 * May a Quran page claim anything to a search engine?
 *
 * THREE CONDITIONS, ALL REQUIRED: the deployment may be indexed at all (the
 * pre-adoption origin may not, and the control fails closed); the corpus is
 * ACTIVE; and it is APPROVED. A fixture corpus is engineering proof text and is
 * never indexable, whatever the deployment says (Phase 18 §6).
 */
export function quranIndexable(availability: QuranAvailability): boolean {
  return (
    publicIndexingEnabled() && availability.active && availability.mode === 'approved'
  );
}

/** What a page that may not be indexed says: no canonical, no alternates. */
function withheld(title: string, description: string | undefined): Metadata {
  return {
    title,
    ...(description === undefined ? {} : { description }),
    robots: { index: false, follow: false },
  };
}

/**
 * Metadata for one Quran page.
 *
 * THE PAGE EXISTS IN EVERY INTERFACE LOCALE. A Quran page is the canonical
 * Arabic — identical in every locale — inside fully translated chrome, so each
 * locale's address is a genuine version of it and all three are listed, with
 * `x-default` resolved to the English one (ROUTE_MAP.md §9.2.1).
 *
 * `canonicalPath` is LOCALE-FREE. A view that mirrors another resource — the
 * Listen catalogue projection, a related-material view — passes the address it
 * canonicalises to; reading preferences are never part of any canonical.
 */
export function quranMetadata(input: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly canonicalPath: string;
  readonly title: string;
  readonly description?: string;
}): Metadata {
  if (!quranIndexable(input.availability))
    return withheld(input.title, input.description);

  const languages: Record<string, string> = {};
  for (const locale of localeSchema.options)
    languages[locale] = absoluteUrl(`/${locale}${input.canonicalPath}`);
  languages['x-default'] = absoluteUrl(`/en${input.canonicalPath}`);

  return {
    title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    robots: { index: true, follow: true },
    alternates: {
      canonical: absoluteUrl(`/${input.locale}${input.canonicalPath}`),
      languages,
    },
  };
}

/**
 * Metadata for a Quran page whose content exists in SOME locales only — a
 * Tajweed rule written in two languages, a reciter's profile — through the
 * shared content rule, and still never indexable unless the corpus is approved.
 */
export function quranContentMetadata(
  availability: QuranAvailability,
  input: Parameters<typeof contentMetadata>[0],
): Metadata {
  if (!quranIndexable(availability)) return withheld(input.title, input.description);
  return contentMetadata(input);
}

/**
 * The search page's directive: `noindex` always, `follow` only on an indexable
 * deployment with an approved corpus (ROUTE_MAP.md §9.5).
 */
export function quranSearchRobots(availability: QuranAvailability): Metadata['robots'] {
  return { index: false, follow: quranIndexable(availability) };
}
