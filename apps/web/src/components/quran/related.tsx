import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { SCHOLARLY_PAGE } from '@minhaj/contracts/library';
import { MEDIA_PAGE } from '@minhaj/contracts/media';
import type { QuranAvailability } from '@minhaj/contracts/quran';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { labelFor, WORK_PAGE, workPath } from '@/components/library/presentation';
import { listingHref } from '@/components/library/scholarly';
import {
  scholarlyLabel,
  scholarlyListPath,
  scholarlyQueryPath,
} from '@/components/library/scholarly-presentation';
import { Pagination } from '@/components/media/parts';
import { mediaLabel, videoPath } from '@/components/media/presentation';
import { EmptyState, PageHeading, Panel, TextLink } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { QuranFrame, quranTrail } from './parts';
import { offsetPathOf, quranPath } from './presentation';

/**
 * Related material — `/quran/books`, `/quran/videos`, `/quran/research`
 * (ROUTE_MAP.md §3.3: "related material, canonical to their domain
 * collections").
 *
 * LAYER-4 COMPOSITION OF THE OWNERS' OWN PUBLIC READS. Each view is ONE bounded,
 * topic-filtered page of the owner's public listing for Taxonomy's `quran`
 * Topic — Library's Works and Research, Media's Videos — never the search index
 * and never a Quran read. Quran itself imports none of them; only this
 * presentation layer composes them. Each item links to its owner's canonical
 * address, and the page canonicalises to the owner's collection.
 *
 * WHAT IS ABSENT IS ABSENT. `/quran/articles` has no view because Editorial
 * exposes no public by-topic Article read; `/quran/courses` and
 * `/quran/teachers` belong to Learning, which has not shipped. None of them is
 * routed or linked (ROUTE_MAP.md §5.2).
 */

export const RELATED_KINDS = Object.freeze(['books', 'videos', 'research'] as const);
export type RelatedKind = (typeof RELATED_KINDS)[number];

/** The LOCALE-FREE owner collection each related view canonicalises to. */
export const RELATED_CANONICAL: Readonly<Record<RelatedKind, string>> = Object.freeze({
  books: '/library/books',
  videos: '/watch/videos',
  research: '/library/research',
});

interface RelatedRow {
  readonly key: string;
  readonly href: string;
  readonly title: string;
  readonly locale: Locale;
}

/** One page of the owner's listing for the Topic, as plain rows. */
async function relatedPage(
  kind: RelatedKind,
  locale: Locale,
  topic: TopicView,
  offset: number,
): Promise<{
  readonly rows: readonly RelatedRow[];
  readonly hasMore: boolean;
  readonly size: number;
  readonly owner: string;
}> {
  switch (kind) {
    case 'books': {
      const page = await libraryReadRuntime().works({ topic: topic.id, offset });
      return {
        rows: page.items.map((work) => {
          const label = labelFor(work, locale);
          return {
            key: work.id,
            href: workPath(locale, work.slug),
            title: label.title,
            locale: label.locale,
          };
        }),
        hasMore: page.hasMore,
        size: WORK_PAGE,
        owner: `/${locale}/library/books?topic=${encodeURIComponent(topic.id)}`,
      };
    }
    case 'videos': {
      const page = await mediaReadRuntime().videos({ topic: topic.id, offset });
      return {
        rows: page.items.map((video) => {
          const label = mediaLabel(video, locale);
          return {
            key: video.id,
            href: videoPath(locale, video.slug),
            title: label.title,
            locale: label.locale,
          };
        }),
        hasMore: page.hasMore,
        size: MEDIA_PAGE,
        owner: `/${locale}/watch/topics/${encodeURIComponent(topic.slug)}`,
      };
    }
    case 'research': {
      const page = await libraryReadRuntime().scholarlyList('research', {
        topic: topic.id,
        offset,
      });
      return {
        rows: page.items.map((row) => {
          const label = scholarlyLabel(row, locale);
          return {
            key: row.id,
            href: listingHref(locale, row),
            title: label.title,
            locale: label.locale,
          };
        }),
        hasMore: page.hasMore,
        size: SCHOLARLY_PAGE,
        owner: scholarlyQueryPath(scholarlyListPath(locale, 'research'), {
          offset: 0,
          language: null,
          topic: topic.id,
          from: null,
          to: null,
        }),
      };
    }
  }
}

export async function QuranRelatedPage({
  locale,
  availability,
  kind,
  topic,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly kind: RelatedKind;
  readonly topic: TopicView;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const page = await relatedPage(kind, locale, topic, offset);
  const title = t(`sections.${kind}`);
  const path = quranPath(locale, kind);

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t(`sectionBody.${kind}`)}
        </p>
      </div>
      {page.rows.length === 0 ? (
        <EmptyState>{t(`relatedEmpty.${kind}`)}</EmptyState>
      ) : (
        <ul aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {page.rows.map((row) => (
            <Panel key={row.key} as="li">
              <p
                className="font-semibold break-words"
                lang={row.locale}
                dir={directionOf(row.locale)}
              >
                <TextLink href={row.href}>{row.title}</TextLink>
              </p>
            </Panel>
          ))}
        </ul>
      )}
      <Pagination
        label={title}
        previous={offset > 0 ? offsetPathOf(path, Math.max(0, offset - page.size)) : null}
        next={page.hasMore ? offsetPathOf(path, offset + page.size) : null}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
      <p>
        <TextLink href={page.owner}>{t(`relatedOwner.${kind}`)}</TextLink>
      </p>
    </QuranFrame>
  );
}
