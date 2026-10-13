import 'server-only';

import { cache } from 'react';
import type { Metadata } from 'next';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { FatwaAvailability, PublicFatwa } from '@minhaj/contracts/fatwa';

import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';
import { fatwaContentLocales, rulingDescription, rulingPathOf } from './presentation';

/**
 * The public Fatwa reads a request shares, and the ONE metadata rule every
 * public Fatwa page follows.
 *
 * READ ONCE PER REQUEST. `generateMetadata` and the page body ask the same
 * questions — is the service activated, which ruling or category is this — so
 * each is wrapped in React's request cache and answered by the reader once.
 *
 * SESSION-FREE BY CONSTRUCTION. Everything here reaches `fatwaReadRuntime()`,
 * whose reader takes no actor and returns only rulings public now; nothing in
 * this graph reaches Identity, a session, a cookie or a private question
 * (ARCHITECTURE.md §8.1).
 */

export const fatwaAvailability = cache((): Promise<FatwaAvailability> =>
  fatwaReadRuntime().reader.availability(),
);

export const readFatwaCategories = cache(() => fatwaReadRuntime().reader.categories());

export const readFatwaCategory = cache((slug: string) =>
  fatwaReadRuntime().reader.category(slug),
);

export const readFatwa = cache((slug: string) => fatwaReadRuntime().reader.fatwa(slug));

/** An ACTIVE Topic by slug, or `null` — Taxonomy decides, never this section. */
export const readActiveTopic = cache(async (locale: Locale, slug: string) => {
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({ slug, locale });
  return topic !== null && topic.status === 'active' ? topic : null;
});

/** Is this deployment showing non-authoritative fixture rulings? */
export function isFatwaFixture(availability: FatwaAvailability): boolean {
  return availability.active && availability.mode === 'fixture';
}

/**
 * May a Fatwa page claim anything to a search engine?
 *
 * THREE CONDITIONS, ALL REQUIRED: the deployment may be indexed at all (the
 * pre-adoption origin may not, and the control fails closed); the service is
 * ACTIVE; and its activation is APPROVED. A fixture activation is engineering
 * proof text and is never indexable, whatever the deployment says.
 */
export function fatwaIndexable(availability: FatwaAvailability): boolean {
  return (
    publicIndexingEnabled() && availability.active && availability.mode === 'approved'
  );
}

/**
 * The locales a Fatwa page's `BreadcrumbList` may be claimed in: the content's
 * own locales when the page is indexable, and NONE otherwise — so fixture text
 * and an inactive service emit no structured data at all. Nothing but the
 * breadcrumb is ever claimed: no `FAQPage`, no `Article`, no author, no rating
 * (ROUTE_MAP.md §9.6).
 */
export function fatwaStructuredLocales(
  availability: FatwaAvailability,
  contentLocales: readonly Locale[],
): readonly Locale[] {
  return fatwaIndexable(availability) ? contentLocales : [];
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
 * Metadata for a Fatwa page whose chrome exists in every interface locale —
 * the landing, the categories and the process page. `canonicalPath` is
 * LOCALE-FREE and never carries a query: a sorted, filtered or paged view
 * canonicalises to its base (ROUTE_MAP.md §2.3).
 */
export function fatwaMetadata(input: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly canonicalPath: string;
  readonly title: string;
  readonly description?: string;
}): Metadata {
  if (!fatwaIndexable(input.availability))
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
 * Metadata for a Fatwa page whose content exists in SOME locales only — a
 * ruling written in one language, a topic view canonical to its hub — through
 * the shared content rule, and still never indexable unless the activation is
 * approved.
 */
export function fatwaContentMetadata(
  availability: FatwaAvailability,
  input: Parameters<typeof contentMetadata>[0],
): Metadata {
  if (!fatwaIndexable(availability)) return withheld(input.title, input.description);
  return contentMetadata(input);
}

/**
 * Metadata for one published ruling — the ONE rule `/fatwa/{slug}` follows.
 *
 * ONE CONTENT LANGUAGE: the canonical is that language's address and no other
 * alternate is listed; a ruling in a language that is not an interface locale
 * claims no canonical at all (ROUTE_MAP.md §9.2, §9.3). The title is the
 * ruling's and the description the opening of its separately written,
 * anonymised PUBLIC question — the reader holds no private question to leak.
 */
export function rulingMetadata(
  locale: Locale,
  availability: FatwaAvailability,
  fatwa: Pick<PublicFatwa, 'slug' | 'current'>,
): Metadata {
  const contentLocales = fatwaContentLocales(fatwa.current.language);
  return fatwaContentMetadata(availability, {
    locale,
    contentLocales,
    primaryLocale: contentLocales[0] ?? locale,
    pathFor: (target) => `/${target}${rulingPathOf(fatwa.slug)}`,
    title: fatwa.current.title,
    description: rulingDescription(fatwa.current.publicQuestion),
  });
}

/**
 * The search page's directive: `noindex` always, `follow` only on an indexable
 * deployment with an approved activation (ROUTE_MAP.md §9.5).
 */
export function fatwaSearchRobots(availability: FatwaAvailability): Metadata['robots'] {
  return { index: false, follow: fatwaIndexable(availability) };
}
