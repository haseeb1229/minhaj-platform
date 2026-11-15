import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { CourseDetail, CourseRelations } from '@minhaj/contracts/learning';

import type { PublicCourseSchedule } from '@/contexts/learning';
import { teacherProfilesFor } from '@/composition/learning-teachers';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import {
  ClassTime,
  LiveFixtureNotice,
  TeacherName,
} from '@/components/live-learning/parts';
import { BreadcrumbData } from '@/components/media/parts';
import { CourseShelf } from '@/components/topic-hub/courses';
import {
  Alert,
  Badge,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Icon,
  MetaRow,
  Prose,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { learnTrail, LevelSteps } from './parts';
import {
  courseBrowseHref,
  courseHref,
  courseLabel,
  learningLocales,
  learningPathHref,
  learnPath,
  outlineLabel,
} from './presentation';

/**
 * `/learn/courses/{slug}` — one published Course, as its landing page
 * (ROUTE_MAP.md §3.5; Learn Part 1).
 *
 * WHAT ANYBODY MAY READ, SIGNED OUT. The Course's words, its format, level and
 * content language, the People attributed as its teachers, its topics, and
 * its PUBLIC SYLLABUS: modules and lessons, their titles, summaries and counts.
 * A lesson's BODY is never part of the record this page receives — it is an
 * enrolled learner's, read only through My Learning. Beside it: what signing in
 * adds (stated, never gated), the published learning paths holding the Course
 * with its step on each, the Courses studied with it, and — for a Course taught
 * live, while live learning is on — its next public classes.
 *
 * TEACHERS ARE ATTRIBUTION. A name here links to the Person's public profile
 * and confers nothing (DOMAIN_MODEL.md §13.2); a teacher People cannot name is
 * not printed.
 *
 * THE CALL TO ACTION FOLLOWS THE VISITOR, BUT THE DOCUMENT DOES NOT. What a
 * signed-in visitor can do — enrol, continue with their progress, ask for a
 * trial class — arrives through `controls`, the private island the route
 * places at the head of the page, which loads after it; so this render is the
 * same for every visitor (ARCHITECTURE.md §8.1) and every mutation stays the
 * island's, through its existing same-origin POST handlers.
 *
 * NO `Course` STRUCTURED DATA. ROUTE_MAP.md §9.6 withholds it without genuine
 * pricing and provider completeness, which a free catalogue does not have; the
 * page claims a `BreadcrumbList` and nothing else.
 */
export async function CourseDetailPage({
  locale,
  record,
  relations,
  schedule,
  controls,
}: {
  readonly locale: Locale;
  readonly record: CourseDetail;
  readonly relations: CourseRelations;
  /** The Course's next public classes; `null` for a self-paced Course. */
  readonly schedule: PublicCourseSchedule | null;
  readonly controls: ReactNode;
}) {
  const [t, live, parts, references, languages, profiles] = await Promise.all([
    getTranslations({ locale, namespace: 'learn' }),
    getTranslations({ locale, namespace: 'learnLive' }),
    learnTrail(locale),
    referenceNames({ personIds: record.teacherIds, topicIds: record.topicIds }, locale),
    contentLanguages(),
    teacherProfilesFor(
      (schedule?.sessions ?? []).map((session) => session.teacherAccountId),
      locale,
    ),
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
  const isLive = record.format === 'live';
  const personHref = (slug: string) =>
    localizedPath(locale, `/people/${encodeURIComponent(slug)}`);

  const languageLabel = (
    <span lang={record.languageCode} dir={language?.direction ?? 'auto'}>
      {language?.name ?? record.languageCode}
    </span>
  );
  const benefits = [
    'benefitEnrol',
    'benefitProgress',
    ...(isLive ? (['benefitTrial', 'benefitClasses'] as const) : []),
  ] as const;

  return (
    <Container>
      <article className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <header className="flex flex-col gap-6">
          <Breadcrumbs
            label={parts.label}
            trail={[
              ...trail
                .slice(0, -1)
                .map((entry) => ({ href: entry.path, text: entry.name })),
              { text: label.title },
            ]}
          />
          <div className="grid min-w-0 gap-6 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-control border border-accent-rule bg-surface-raised text-accent"
                >
                  <Icon name={isLive ? 'calendar' : 'book'} size={16} />
                </span>
                <Badge>{t(`format.${record.format}`)}</Badge>
                {record.level === null ? null : (
                  <span className="inline-flex items-center gap-2 text-caption font-medium text-foreground-muted">
                    <LevelSteps level={record.level} />
                    {t(`level.${record.level}`)}
                  </span>
                )}
              </div>
              {/* The Course's own words, marked with their language as ONE block. */}
              <div className="flex flex-col gap-3" lang={label.locale} dir={direction}>
                <h1 className="text-display font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
                  {label.title}
                </h1>
                {label.summary === '' ? null : (
                  <p className="text-lede max-w-[var(--measure-prose)] wrap-anywhere text-foreground-muted">
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
                  <span className="text-foreground-muted">{t('course.teachers')}: </span>
                  {teachers.map((person, index) => (
                    <span key={person.slug}>
                      {index === 0 ? null : ' · '}
                      <TextLink href={personHref(person.slug)}>{person.name}</TextLink>
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
            {/*
             * The private island — the call to action that matches the visitor —
             * and, the same for everybody, what an account adds.
             */}
            <div className="flex min-w-0 flex-col gap-4">
              {controls}
              <div className="flex flex-col gap-3 rounded-panel border border-accent-rule bg-surface-raised p-5">
                <h2 className="text-subheading font-semibold">{t('course.benefits')}</h2>
                <ul className="flex list-none flex-col gap-2.5 p-0 text-sm">
                  {benefits.map((key) => (
                    <li key={key} className="flex gap-2.5">
                      <Icon
                        name="check"
                        size={16}
                        className="mt-0.5 shrink-0 text-accent"
                      />
                      <span>{t(`course.${key}`)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-caption text-foreground-muted">
                  {t('course.benefitsFree')}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
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
              <div className="flex flex-col gap-1.5 border-b border-border pb-3">
                <h2 id="course-syllabus" className="text-heading font-semibold">
                  {t('course.syllabus')}
                </h2>
                <p className="text-sm font-medium">
                  {t('course.syllabusCount', {
                    modules: record.modules,
                    lessons: record.lessons,
                  })}
                </p>
                <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
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
                      <li
                        key={module.id}
                        className="flex min-w-0 gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:p-5"
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent-rule bg-accent-surface text-sm font-semibold text-accent tabular-nums"
                        >
                          {new Intl.NumberFormat(locale).format(index + 1)}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-3">
                          <h3 className="flex flex-col gap-1">
                            <span className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
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
                          <p className="text-caption text-foreground-muted">
                            {t('card.lessons', { count: module.lessons.length })}
                          </p>
                          {words.summary === '' ? null : (
                            <p
                              className="max-w-[var(--measure-prose)] text-sm wrap-anywhere text-foreground-muted"
                              lang={words.locale}
                              dir={moduleDirection}
                            >
                              {words.summary}
                            </p>
                          )}
                          {module.lessons.length === 0 ? null : (
                            <ol
                              aria-label={t('course.lessonsIn', { title: words.title })}
                              className="flex list-decimal flex-col gap-3 border-t border-border ps-6 pt-3 marker:text-foreground-muted"
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
                                        className="wrap-anywhere text-foreground-muted"
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
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {schedule === null || schedule.mode === null ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="course-classes">
                <SectionHeader
                  id="course-classes"
                  heading={t('course.classes')}
                  intro={t('course.classesIntro')}
                  action={{
                    href: learnPath(locale, 'live'),
                    text: t('course.allClasses'),
                  }}
                />
                <LiveFixtureNotice mode={schedule.mode} text={live('fixture')} />
                {schedule.sessions.length === 0 ? (
                  <EmptyState>{t('course.classesEmpty')}</EmptyState>
                ) : (
                  <ol
                    aria-label={t('course.classes')}
                    className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
                  >
                    {schedule.sessions.map((session) => (
                      <li
                        key={session.id}
                        className="flex min-w-0 flex-col gap-1.5 rounded-panel border border-border bg-surface-raised p-4 text-sm"
                      >
                        <p className="font-semibold">
                          <ClassTime
                            instant={session.startsAt}
                            local={session.startsLocal}
                            timeZone={session.timeZone}
                            locale={locale}
                          />
                        </p>
                        <p className="flex flex-wrap gap-x-2">
                          <span className="text-foreground-muted">{live('ends')}</span>
                          <ClassTime
                            instant={session.endsAt}
                            local={session.endsLocal}
                            timeZone={session.timeZone}
                            locale={locale}
                          />
                        </p>
                        <p className="flex flex-wrap gap-x-2">
                          <span className="text-foreground-muted">{live('teacher')}</span>
                          <TeacherName
                            profile={profiles.get(session.teacherAccountId)}
                            locale={locale}
                            fallback={live('teacherUnnamed')}
                          />
                        </p>
                        <p className="text-caption text-foreground-muted">
                          {live('zone', { zone: session.timeZone })}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {teachers.length === 0 ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="course-teachers">
                <h2 id="course-teachers" className="text-heading font-semibold">
                  {t('course.teachersHeading')}
                </h2>
                <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
                  {teachers.map((person) => (
                    <li
                      key={person.slug}
                      className="card-surface relative flex min-w-0 items-center gap-3 rounded-panel border border-border bg-surface-raised p-4 hover:border-accent"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-surface text-accent"
                      >
                        <Icon name="user" size={20} />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <h3 className="font-semibold wrap-anywhere" dir="auto">
                          <a
                            href={personHref(person.slug)}
                            className="card-link text-foreground no-underline"
                          >
                            {person.name}
                          </a>
                        </h3>
                        <span className="text-caption text-foreground-muted">
                          {t('course.teacherProfile')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

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

          <aside aria-label={t('course.facts')} className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-4 rounded-panel border border-border bg-surface-raised p-5 shadow-panel">
              <h2 className="text-subheading font-semibold">{t('course.facts')}</h2>
              <dl className="flex flex-col divide-y divide-border">
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
              {isLive ? (
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

        {relations.paths.length === 0 ? null : (
          <section className="flex flex-col gap-5" aria-labelledby="course-paths">
            <SectionHeader
              id="course-paths"
              heading={t('course.paths')}
              intro={t('course.pathsIntro')}
              action={{ href: learnPath(locale, 'paths'), text: t('landing.allPaths') }}
            />
            <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {relations.paths.map(({ path, step }) => {
                const words = outlineLabel(path.labels, locale, path.primaryLocale);
                return (
                  <li
                    key={path.id}
                    className="card-surface relative flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-surface-raised p-4 hover:border-accent sm:p-5"
                  >
                    <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
                      {t('course.pathStep', { step, total: path.courses })}
                    </p>
                    <h3
                      className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
                      lang={words.locale}
                      dir={directionOf(words.locale)}
                    >
                      <a
                        href={learningPathHref(locale, path.slug)}
                        className="card-link text-foreground no-underline"
                      >
                        {words.title}
                      </a>
                    </h3>
                    {words.summary === '' ? null : (
                      <p
                        className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
                        lang={words.locale}
                        dir={directionOf(words.locale)}
                      >
                        {words.summary}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {relations.related.length === 0 ? null : (
          <section className="flex flex-col gap-5" aria-labelledby="course-related">
            <SectionHeader
              id="course-related"
              heading={t('course.related')}
              intro={t('course.relatedIntro')}
              action={{ href: courseBrowseHref(locale), text: t('landing.allCourses') }}
            />
            <CourseShelf
              locale={locale}
              courses={relations.related}
              label={t('course.related')}
            />
          </section>
        )}

        <BreadcrumbData contentLocales={learningLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}
