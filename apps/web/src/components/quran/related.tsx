import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { LEARNING_PAGE } from '@minhaj/contracts/learning';
import type { QuranAvailability } from '@minhaj/contracts/quran';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { learningReadRuntime } from '@/composition/learning-read';
import {
  courseBrowseHref,
  courseHref,
  LEARNING_MAX_OFFSET,
  outlineLabel,
} from '@/components/learning/presentation';
import { Pagination } from '@/components/media/parts';
import { EmptyState, PageHeading, Panel, TextLink } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { QuranFrame, quranTrail } from './parts';
import { offsetPathOf, quranPath } from './presentation';

/**
 * Related material — `/quran/courses` (ROUTE_MAP.md §3.3: "related material,
 * canonical to their domain collections"). `/quran/books`, `/quran/videos`
 * and `/quran/research` were related views too until Quran Parts 10, 11 and
 * 12 made them the Quran Books, Videos and Research hubs (`./books.tsx`,
 * `./videos.tsx`, `./research.tsx`), each canonical to itself — so this
 * module now holds Courses alone.
 *
 * LAYER-4 COMPOSITION OF THE OWNER'S OWN PUBLIC READ. The view is ONE bounded,
 * topic-filtered page of Learning's published Courses for Taxonomy's `quran`
 * Topic (since Phase 22) — never the search index and never a Quran read.
 * Quran itself imports nothing of Learning; only this presentation layer
 * composes it. Each Course links to its canonical address, and the page
 * canonicalises to Learning's catalogue.
 *
 * WHAT IS ABSENT IS ABSENT. `/quran/articles` has no view because Editorial
 * exposes no public by-topic Article read, and `/quran/teachers` has no
 * deterministic owner read — a Course's teachers are attribution, not a
 * teacher directory, which is Phase 23's. Neither is routed or linked
 * (ROUTE_MAP.md §5.2).
 */

/** The LOCALE-FREE owner catalogue the view canonicalises to. */
export const COURSES_CANONICAL = '/learn/courses';

export async function QuranCoursesPage({
  locale,
  availability,
  topic,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly topic: TopicView;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  // Learning's own public catalogue for the Topic, by its identifier; the
  // address it links to names the Topic by slug, as the catalogue does.
  const page = await learningReadRuntime().courses({
    topic: topic.id,
    offset: Math.min(offset, LEARNING_MAX_OFFSET),
  });
  const title = t('sections.courses');
  const path = quranPath(locale, 'courses');

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-foreground-muted">{t('sectionBody.courses')}</p>
      </div>
      {page.items.length === 0 ? (
        <EmptyState>{t('relatedEmpty.courses')}</EmptyState>
      ) : (
        <ul aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {page.items.map((course) => {
            const label = outlineLabel(course.labels, locale, course.primaryLocale);
            return (
              <Panel key={course.id} as="li">
                <p
                  className="font-semibold break-words"
                  lang={label.locale}
                  dir={directionOf(label.locale)}
                >
                  <TextLink href={courseHref(locale, course.slug)}>
                    {label.title}
                  </TextLink>
                </p>
              </Panel>
            );
          })}
        </ul>
      )}
      <Pagination
        label={title}
        previous={
          offset > 0 ? offsetPathOf(path, Math.max(0, offset - LEARNING_PAGE)) : null
        }
        next={page.hasMore ? offsetPathOf(path, offset + LEARNING_PAGE) : null}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
      <p>
        <TextLink href={courseBrowseHref(locale, { topic: topic.slug })}>
          {t('relatedOwner.courses')}
        </TextLink>
      </p>
    </QuranFrame>
  );
}
