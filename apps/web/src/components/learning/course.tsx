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
  Panel,
  Prose,
  TextLink,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { CourseBadges, learnTrail } from './parts';
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
          <CourseBadges course={record} t={t} />
          {label.locale === locale ? null : (
            <Alert tone="info">
              {t('course.fallback', { language: endonymOf(label.locale) })}
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
          </div>
          {teachers.length === 0 ? null : (
            <p className="text-sm wrap-anywhere" dir="auto">
              <span className="text-[color:var(--color-foreground-muted)]">
                {t('course.teachers')}:{' '}
              </span>
              {teachers.map((person, index) => (
                <span key={person.slug}>
                  {index === 0 ? null : ' · '}
                  <TextLink href={`/${locale}/people/${encodeURIComponent(person.slug)}`}>
                    {person.name}
                  </TextLink>
                </span>
              ))}
            </p>
          )}
          {record.format === 'live' ? (
            <p className="text-sm">
              {t('course.trialNote')}{' '}
              <TextLink href={learnPath(locale, 'trial')}>
                {t('course.trialLink')}
              </TextLink>
            </p>
          ) : null}
        </Prose>

        {controls}

        {label.description === '' ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="course-about">
            <h2 id="course-about" className="text-lg font-semibold">
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

        <section className="flex flex-col gap-3" aria-labelledby="course-facts">
          <h2 id="course-facts" className="text-lg font-semibold">
            {t('course.facts')}
          </h2>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <DetailRow term={t('course.format')}>
              {t(`format.${record.format}`)}
            </DetailRow>
            {record.level === null ? null : (
              <DetailRow term={t('course.level')}>{t(`level.${record.level}`)}</DetailRow>
            )}
            <DetailRow term={t('course.language')}>
              <span lang={record.languageCode} dir={language?.direction ?? 'auto'}>
                {language?.name ?? record.languageCode}
              </span>
            </DetailRow>
            <DetailRow term={t('course.length')}>
              {t('card.modules', { count: record.modules })}
              {' · '}
              {t('card.lessons', { count: record.lessons })}
            </DetailRow>
          </dl>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="course-syllabus">
          <div className="flex flex-col gap-2">
            <h2 id="course-syllabus" className="text-lg font-semibold">
              {t('course.syllabus')}
            </h2>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('course.syllabusNote')}
            </p>
          </div>
          {record.outline.length === 0 ? (
            <EmptyState>{t('course.syllabusEmpty')}</EmptyState>
          ) : (
            <ol className="flex flex-col gap-4">
              {record.outline.map((module, index) => {
                const words = outlineLabel(module.labels, locale, record.primaryLocale);
                const moduleDirection = directionOf(words.locale);
                return (
                  <Panel key={module.id} as="li">
                    <div className="flex min-w-0 flex-col gap-3">
                      <h3 className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-[color:var(--color-foreground-muted)]">
                          {t('course.module', { number: index + 1 })}
                        </span>
                        <span
                          className="text-base font-semibold wrap-anywhere"
                          lang={words.locale}
                          dir={moduleDirection}
                        >
                          {words.title}
                        </span>
                      </h3>
                      {words.summary === '' ? null : (
                        <p
                          className="text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
                          lang={words.locale}
                          dir={moduleDirection}
                        >
                          {words.summary}
                        </p>
                      )}
                      {module.lessons.length === 0 ? null : (
                        <ol
                          aria-label={t('course.lessonsIn', { title: words.title })}
                          className="flex list-decimal flex-col gap-2 ps-6"
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
          <section className="flex flex-col gap-3" aria-labelledby="course-topics">
            <h2 id="course-topics" className="text-lg font-semibold">
              {t('course.topics')}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {topics.map((topic) => (
                <li key={topic.slug}>
                  <TextLink href={courseBrowseHref(locale, { topic: topic.slug })}>
                    {topic.name}
                  </TextLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        <BreadcrumbData contentLocales={learningLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}
