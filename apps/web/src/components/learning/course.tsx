import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { CourseDetail } from '@minhaj/contracts/learning';

import { contentLanguages, referenceNames } from '@/composition/public-references';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  MetaRow,
  Panel,
  Prose,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { courseKind, learnTrail } from './parts';
import {
  courseBrowseHref,
  courseHref,
  courseLabel,
  learningLocales,
  learnPath,
  outlineLabel,
} from './presentation';

/**
 * `/learn/courses/{slug}` — one published Course (ROUTE_MAP.md §3.5).
 *
 * WHAT ANYBODY MAY READ, SIGNED OUT. The Course's words, its format, level and
 * content language, the People attributed as its teachers, its topics, and
 * its PUBLIC SYLLABUS: module and lesson titles and summaries. A lesson's BODY
 * is never part of the record this page receives — it is an enrolled learner's,
 * read only through My Learning.
 *
 * TEACHERS ARE ATTRIBUTION. A name here links to the Person's public profile
 * and confers nothing (DOMAIN_MODEL.md §13.2); a teacher People cannot name is
 * not printed.
 *
 * WHAT A SIGNED-IN VISITOR CAN DO arrives through `controls` — the private
 * island the route places, which loads after the page — so this render is the
 * same for every visitor (ARCHITECTURE.md §8.1).
 *
 * NO `Course` STRUCTURED DATA. ROUTE_MAP.md §9.6 withholds it without genuine
 * pricing and provider completeness, which a free catalogue does not have; the
 * page claims a `BreadcrumbList` and nothing else.
 */
export async function CourseDetailPage({
  locale,
  record,
  controls,
}: {
  readonly locale: Locale;
  readonly record: CourseDetail;
  readonly controls: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const parts = await learnTrail(locale);
  const [references, languages] = await Promise.all([
    referenceNames({ personIds: record.teacherIds, topicIds: record.topicIds }, locale),
    contentLanguages(),
  ]);

  const label = courseLabel(record, locale);
  const direction = directionOf(label.locale);
  const language = languages.get(record.languageCode);
  const teachers = record.teacherIds.flatMap((id) => {
    const person = references.people.get(id);
    return person === undefined ? [] : [person];
  });
  const topics = record.topicIds.flatMap((id) => {
    const topic = references.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const coursesTitle = t('sections.courses');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.learn.text, path: parts.learn.href },
    { name: coursesTitle, path: courseBrowseHref(locale) },
    { name: label.title, path: courseHref(locale, record.slug) },
  ];

  const languageLabel = (
    <span lang={record.languageCode} dir={language?.direction ?? 'auto'}>
      {language?.name ?? record.languageCode}
    </span>
  );

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
              {courseKind(record, t)}
            </p>
            {/* The Course's own words, marked with their language as ONE block. */}
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
            <MetaRow
              items={[
                languageLabel,
                t('card.modules', { count: record.modules }),
                t('card.lessons', { count: record.lessons }),
              ]}
            />
            {teachers.length === 0 ? null : (
              <p className="text-sm wrap-anywhere" dir="auto">
                <span className="text-[color:var(--color-foreground-muted)]">
                  {t('course.teachers')}:{' '}
                </span>
                {teachers.map((person, index) => (
                  <span key={person.slug}>
                    {index === 0 ? null : ' · '}
                    <TextLink
                      href={`/${locale}/people/${encodeURIComponent(person.slug)}`}
                    >
                      {person.name}
                    </TextLink>
                  </span>
                ))}
              </p>
            )}
            {label.locale === locale ? null : (
              <Alert tone="info">
                {t('course.fallback', { language: endonymOf(label.locale) })}
              </Alert>
            )}
          </div>
        </header>

        {controls}

        <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14">
          <div className="flex min-w-0 flex-col gap-10">
            {label.description === '' ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="course-about">
                <h2 id="course-about" className="text-heading font-semibold">
                  {t('course.about')}
                </h2>
                <Prose>
                  <div
                    className="flex flex-col gap-4 wrap-anywhere"
                    lang={label.locale}
                    dir={direction}
                  >
                    {paragraphsOf(label.description).map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                  </div>
                </Prose>
              </section>
            )}

            <section className="flex flex-col gap-5" aria-labelledby="course-syllabus">
              <div className="flex flex-col gap-1.5 border-b border-[color:var(--color-border)] pb-3">
                <h2 id="course-syllabus" className="text-heading font-semibold">
                  {t('course.syllabus')}
                </h2>
                <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
                  {t('course.syllabusNote')}
                </p>
              </div>
              {record.outline.length === 0 ? (
                <EmptyState>{t('course.syllabusEmpty')}</EmptyState>
              ) : (
                <ol className="flex list-none flex-col gap-4 p-0">
                  {record.outline.map((module, index) => {
                    const words = outlineLabel(
                      module.labels,
                      locale,
                      record.primaryLocale,
                    );
                    const moduleDirection = directionOf(words.locale);
                    return (
                      <Panel key={module.id} as="li">
                        <div className="flex min-w-0 flex-col gap-3">
                          <h3 className="flex flex-col gap-1">
                            <span className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
                              {t('course.module', { number: index + 1 })}
                            </span>
                            <span
                              className="text-subheading font-semibold wrap-anywhere"
                              lang={words.locale}
                              dir={moduleDirection}
                            >
                              {words.title}
                            </span>
                          </h3>
                          {words.summary === '' ? null : (
                            <p
                              className="max-w-[var(--measure-prose)] text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
                              lang={words.locale}
                              dir={moduleDirection}
                            >
                              {words.summary}
                            </p>
                          )}
                          {module.lessons.length === 0 ? null : (
                            <ol
                              aria-label={t('course.lessonsIn', { title: words.title })}
                              className="flex list-decimal flex-col gap-3 border-t border-[color:var(--color-border)] ps-6 pt-3 marker:text-[color:var(--color-foreground-muted)]"
                            >
                              {module.lessons.map((lesson) => {
                                const lessonWords = outlineLabel(
                                  lesson.labels,
                                  locale,
                                  record.primaryLocale,
                                );
                                const lessonDirection = directionOf(lessonWords.locale);
                                return (
                                  <li key={lesson.id} className="text-sm">
                                    <p
                                      className="font-medium wrap-anywhere"
                                      lang={lessonWords.locale}
                                      dir={lessonDirection}
                                    >
                                      {lessonWords.title}
                                    </p>
                                    {lessonWords.summary === '' ? null : (
                                      <p
                                        className="wrap-anywhere text-[color:var(--color-foreground-muted)]"
                                        lang={lessonWords.locale}
                                        dir={lessonDirection}
                                      >
                                        {lessonWords.summary}
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                          )}
                        </div>
                      </Panel>
                    );
                  })}
                </ol>
              )}
            </section>

            {topics.length === 0 ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="course-topics">
                <h2 id="course-topics" className="text-heading font-semibold">
                  {t('course.topics')}
                </h2>
                <TopicChips
                  label={t('course.topics')}
                  topics={topics.map((topic) => ({
                    href: courseBrowseHref(locale, { topic: topic.slug }),
                    text: topic.name,
                  }))}
                />
              </section>
            )}
          </div>

          <aside aria-labelledby="course-facts" className="min-w-0">
            <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]">
              <h2 id="course-facts" className="text-subheading font-semibold">
                {t('course.facts')}
              </h2>
              <dl className="flex flex-col divide-y divide-[color:var(--color-border)]">
                <DetailRow term={t('course.format')}>
                  {t(`format.${record.format}`)}
                </DetailRow>
                {record.level === null ? null : (
                  <DetailRow term={t('course.level')}>
                    {t(`level.${record.level}`)}
                  </DetailRow>
                )}
                <DetailRow term={t('course.language')}>{languageLabel}</DetailRow>
                <DetailRow term={t('course.length')}>
                  {t('card.modules', { count: record.modules })}
                  {' · '}
                  {t('card.lessons', { count: record.lessons })}
                </DetailRow>
              </dl>
              {record.format === 'live' ? (
                <p className="text-sm">
                  {t('course.trialNote')}{' '}
                  <TextLink href={learnPath(locale, 'trial')}>
                    {t('course.trialLink')}
                  </TextLink>
                </p>
              ) : null}
            </div>
          </aside>
        </div>

        <BreadcrumbData contentLocales={learningLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}
