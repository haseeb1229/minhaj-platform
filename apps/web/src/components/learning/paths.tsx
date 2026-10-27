import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { LEARNING_PAGE, type PathDetail } from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, MediaPageHeader, Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  MetaRow,
  Prose,
  SectionHeader,
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
      <div className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.learn, { text: title }],
          }}
          eyebrow={t('title')}
          title={title}
          lede={t('sectionBody.paths')}
        />
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
  const description = paragraphsOf(label.description);

  return (
    <Container>
      <article className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <header className="flex flex-col gap-6 border-b border-[color:var(--color-border)] pb-8">
          <Breadcrumbs
            label={parts.label}
            trail={[
              ...trail
                .slice(0, -1)
                .map((entry) => ({ href: entry.path, text: entry.name })),
              { text: label.title },
            ]}
          />
          <div className="flex max-w-3xl min-w-0 flex-col gap-4">
            <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
              {t('path.type')}
            </p>
            {/* The path's own words, marked with their language as ONE block. */}
            <div className="flex flex-col gap-3" lang={label.locale} dir={direction}>
              <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
                {label.title}
              </h1>
              {label.summary === '' ? null : (
                <p className="text-lede max-w-[var(--measure-prose)] wrap-anywhere text-[color:var(--color-foreground-muted)]">
                  {label.summary}
                </p>
              )}
            </div>
            <MetaRow items={[t('card.courses', { count: record.members.length })]} />
            {label.locale === locale ? null : (
              <Alert tone="info">
                {t('path.fallback', { language: endonymOf(label.locale) })}
              </Alert>
            )}
          </div>
        </header>

        {description.length === 0 ? null : (
          <Prose>
            <div
              className="flex flex-col gap-4 wrap-anywhere"
              lang={label.locale}
              dir={direction}
            >
              {description.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </Prose>
        )}

        <section className="flex flex-col gap-5" aria-labelledby="path-courses">
          <SectionHeader
            id="path-courses"
            heading={t('path.courses')}
            intro={t('path.coursesNote')}
          />
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
