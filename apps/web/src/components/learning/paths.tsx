import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { LEARNING_PAGE, type PathDetail } from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Prose,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { CourseGrid, learnTrail, PathGrid } from './parts';
import {
  courseLabel,
  learnPageLinks,
  learningLocales,
  learningPathHref,
  learnPath,
  offsetHref,
} from './presentation';

/**
 * `/learn/paths` and `/learn/paths/{slug}` — LearningPaths (ROUTE_MAP.md §3.5).
 *
 * A PATH IS AN ORDER, NOT AN ENROLMENT. It names published Courses in the order
 * to study them; nobody enrols on a path, and a signed-in learner's standing on
 * one is derived from their own Course enrolments in My Learning. Only
 * PUBLISHED member Courses are listed — the reader returns no other — so a path
 * never leads to a draft.
 */

/** `/learn/paths` — every published LearningPath, `?offset=` paged. */
export async function PathListingPage({
  locale,
  offset,
}: {
  readonly locale: Locale;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const page = await learningReadRuntime().paths(offset);
  const title = t('sections.paths');
  const path = learnPath(locale, 'paths');
  const links = learnPageLinks(offset, LEARNING_PAGE, page.hasMore);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.learn, { text: title }]}
        />
        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('sectionBody.paths')}
          </p>
        </div>
        {page.items.length === 0 ? (
          <EmptyState>{t('pathsEmpty')}</EmptyState>
        ) : (
          <PathGrid locale={locale} paths={page.items} label={title} />
        )}
        <Pagination
          label={title}
          previous={links.previous === null ? null : offsetHref(path, links.previous)}
          next={links.next === null ? null : offsetHref(path, links.next)}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
      </div>
    </Container>
  );
}

/** `/learn/paths/{slug}` — one published LearningPath and its Courses, in order. */
export async function PathDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PathDetail;
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const parts = await learnTrail(locale);
  const label = courseLabel(record, locale);
  const direction = directionOf(label.locale);
  const pathsTitle = t('sections.paths');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.learn.text, path: parts.learn.href },
    { name: pathsTitle, path: learnPath(locale, 'paths') },
    { name: label.title, path: learningPathHref(locale, record.slug) },
  ];

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={parts.label}
          trail={[
            ...trail
              .slice(0, -1)
              .map((entry) => ({ href: entry.path, text: entry.name })),
            { text: label.title },
          ]}
        />

        <Prose>
          <p className="text-sm font-medium text-[color:var(--color-foreground-muted)]">
            {t('path.type')}
          </p>
          {label.locale === locale ? null : (
            <Alert tone="info">
              {t('path.fallback', { language: endonymOf(label.locale) })}
            </Alert>
          )}
          <div className="flex flex-col gap-4" lang={label.locale} dir={direction}>
            <h1 className="text-3xl leading-tight font-semibold tracking-tight wrap-anywhere">
              {label.title}
            </h1>
            {label.summary === '' ? null : (
              <p className="text-lg wrap-anywhere text-[color:var(--color-foreground-muted)]">
                {label.summary}
              </p>
            )}
            {paragraphsOf(label.description).map((paragraph, index) => (
              <p key={index} className="wrap-anywhere">
                {paragraph}
              </p>
            ))}
          </div>
        </Prose>

        <section className="flex flex-col gap-4" aria-labelledby="path-courses">
          <div className="flex flex-col gap-2">
            <h2 id="path-courses" className="text-lg font-semibold">
              {t('path.courses')}
            </h2>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('path.coursesNote')}
            </p>
          </div>
          {record.members.length === 0 ? (
            <EmptyState>{t('path.empty')}</EmptyState>
          ) : (
            <CourseGrid
              locale={locale}
              courses={record.members}
              label={t('path.courses')}
              headingLevel="h3"
              ordered
            />
          )}
        </section>

        <BreadcrumbData contentLocales={learningLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}
