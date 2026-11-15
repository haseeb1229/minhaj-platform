import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  LEARNING_PAGE,
  type CourseListing,
  type PathDetail,
} from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import {
  PathProgressIsland,
  type PathProgressLabels,
} from '@/components/learning-island/path-progress';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import { ExploreHero } from '@/components/topic-hub/parts';
import {
  ActionLink,
  Alert,
  Badge,
  Breadcrumbs,
  Container,
  EmptyState,
  Icon,
  MetaRow,
  Prose,
  SectionHeader,
  TextLink,
  type IconName,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { learnTrail, levelSpan, LevelSteps, PathGrid } from './parts';
import {
  courseBrowseHref,
  courseHref,
  courseLabel,
  learningLocales,
  learningPathHref,
  learnPageLinks,
  learnPath,
  offsetHref,
  outlineLabel,
} from './presentation';

/**
 * `/learn/paths` and `/learn/paths/{slug}` — LearningPaths (ROUTE_MAP.md §3.5;
 * Learn Part 2).
 *
 * A PATH IS AN ORDER, NOT AN ENROLMENT. It names published Courses in the order
 * to study them; nobody enrols on a path, and a signed-in learner's standing on
 * one is derived from their own Course enrolments — shown on the path's page
 * by its private island, after the shared document has rendered, and in My
 * Learning. Only PUBLISHED member Courses are listed — the reader returns no
 * other — so a path never leads to a draft.
 *
 * THE CATALOGUE (Learn Part 2) states its own figures — the published paths,
 * the distinct Courses they hold and those Courses' lessons — and each card
 * what its Courses hold together: how many, their lessons, the span of their
 * levels and how they are studied. Every figure is Learning's own count
 * (`pathSummaries`); nothing is rated, estimated or "featured".
 *
 * THE PATH PAGE IS A JOURNEY: each Course as "Course n of m" with its level,
 * format, lessons and teachers, the whole path's totals and teachers, and one
 * way in — the first Course. Every teacher is People's public name, linked to
 * their profile; attribution grants nothing (DOMAIN_MODEL.md §13.2).
 */

/** How a path is used, in the order a newcomer meets it. */
const HOW = [
  { key: 'order', icon: 'list' },
  { key: 'enrol', icon: 'book' },
  { key: 'progress', icon: 'check' },
] as const satisfies readonly { key: string; icon: IconName }[];

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
  const page = await learningReadRuntime().pathSummaries(offset);
  const title = t('sections.paths');
  const path = learnPath(locale, 'paths');
  const links = learnPageLinks(offset, LEARNING_PAGE, page.hasMore);
  const { figures } = page;
  const stats = [
    ...(figures.paths === 0
      ? []
      : [
          { value: figures.paths, label: t('paths.statPaths', { count: figures.paths }) },
        ]),
    ...(figures.courses === 0
      ? []
      : [
          {
            value: figures.courses,
            label: t('paths.statCourses', { count: figures.courses }),
          },
        ]),
    ...(figures.lessons === 0
      ? []
      : [
          {
            value: figures.lessons,
            label: t('paths.statLessons', { count: figures.lessons }),
          },
        ]),
  ];

  return (
    <Container>
      <div className="flex flex-col gap-[var(--space-section)] pt-6 pb-[var(--space-section)]">
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            label={trail.label}
            trail={[trail.home, trail.learn, { text: title }]}
          />
          <ExploreHero
            eyebrow={t('title')}
            title={title}
            lede={t('paths.lede')}
            stats={stats}
            actions={[
              { href: courseBrowseHref(locale), text: t('landing.browseCourses') },
            ]}
          />
        </div>

        <section className="flex flex-col gap-5" aria-labelledby="paths-list">
          <SectionHeader
            id="paths-list"
            heading={t('paths.listHeading')}
            intro={t('paths.listIntro')}
          />
          {page.items.length === 0 ? (
            <EmptyState>{offset === 0 ? t('pathsEmpty') : t('paths.beyond')}</EmptyState>
          ) : (
            <PathGrid
              locale={locale}
              paths={page.items}
              label={title}
              headingLevel="h3"
            />
          )}
          <Pagination
            label={title}
            previous={links.previous === null ? null : offsetHref(path, links.previous)}
            next={links.next === null ? null : offsetHref(path, links.next)}
            previousLabel={t('previous')}
            nextLabel={t('next')}
          />
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="paths-how">
          <SectionHeader id="paths-how" heading={t('paths.how')} />
          <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
            {HOW.map((step) => (
              <li
                key={step.key}
                className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accent-rule bg-accent-surface text-accent"
                >
                  <Icon name={step.icon} size={20} />
                </span>
                <h3 className="text-subheading font-semibold">
                  {t(`paths.howSteps.${step.key}.title`)}
                </h3>
                <p className="text-sm text-foreground-muted">
                  {t(`paths.howSteps.${step.key}.body`)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Container>
  );
}

/** The distinct stated levels and formats of a path's Courses, in their own orders. */
function heldTogether(courses: readonly CourseListing[]) {
  return {
    levels: COURSE_LEVELS.filter((level) =>
      courses.some((course) => course.level === level),
    ),
    formats: COURSE_FORMATS.filter((format) =>
      courses.some((course) => course.format === format),
    ),
    lessons: courses.reduce((sum, course) => sum + course.lessons, 0),
  };
}

/** `/learn/paths/{slug}` — one published LearningPath as an ordered journey. */
export async function PathDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PathDetail;
}) {
  const courses = record.members;
  const [t, island, parts, references, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'learn' }),
    getTranslations({ locale, namespace: 'learningIsland' }),
    learnTrail(locale),
    referenceNames(
      { personIds: courses.flatMap((course) => course.teacherIds), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
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
  const together = heldTogether(courses);
  const span = levelSpan(together.levels, t);
  const top = together.levels.at(-1);
  const first = courses[0];
  const firstTitle =
    first === undefined ? null : outlineLabel(first.labels, locale, first.primaryLocale);
  // Every teacher on the path, once, in the order the journey first names them.
  const teachers = [
    ...new Map(
      courses
        .flatMap((course) => course.teacherIds)
        .flatMap((id) => {
          const person = references.people.get(id);
          return person === undefined ? [] : [[person.slug, person] as const];
        }),
    ).values(),
  ];
  const personHref = (slug: string) =>
    localizedPath(locale, `/people/${encodeURIComponent(slug)}`);
  const encoded = encodeURIComponent(record.slug);
  const myPath = localizedPath(locale, `/my/learning/paths/${encoded}`);

  const progressLabels: PathProgressLabels = {
    heading: island('path.heading'),
    privacy: island('privacy'),
    signedOut: island('path.signedOut'),
    signIn: island('path.signIn'),
    enrolled: island.raw('path.enrolled') as string,
    lessons: island.raw('progress') as string,
    allComplete: island('path.allComplete'),
    notStarted: island('path.notStarted'),
    next: island.raw('path.next') as string,
    open: island('path.open'),
  };

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
              <p className="inline-flex items-center gap-2 text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
                <Icon name="list" size={16} />
                {t('path.type')}
              </p>
              {/* The path's own words, marked with their language as ONE block. */}
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
                  t('card.courses', { count: courses.length }),
                  together.lessons === 0
                    ? null
                    : t('card.lessons', { count: together.lessons }),
                  span === null || top === undefined ? null : (
                    <span key="levels" className="inline-flex items-center gap-2">
                      <LevelSteps level={top} />
                      {span}
                    </span>
                  ),
                ]}
              />
              {together.formats.length === 0 ? null : (
                <p className="flex flex-wrap gap-2">
                  {together.formats.map((format) => (
                    <Badge key={format}>{t(`format.${format}`)}</Badge>
                  ))}
                </p>
              )}
              {first === undefined || firstTitle === null ? null : (
                <p className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <ActionLink href={courseHref(locale, first.slug)}>
                    {t('path.start')}
                  </ActionLink>
                  <span className="text-sm text-foreground-muted">
                    {t('path.startWith')}{' '}
                    <span
                      className="font-medium text-foreground wrap-anywhere"
                      lang={firstTitle.locale}
                      dir={directionOf(firstTitle.locale)}
                    >
                      {firstTitle.title}
                    </span>
                  </span>
                </p>
              )}
              {label.locale === locale ? null : (
                <Alert tone="info">
                  {t('path.fallback', { language: endonymOf(label.locale) })}
                </Alert>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <PathProgressIsland
                pathSlug={record.slug}
                locale={locale}
                courses={courses.map((course) => {
                  const words = outlineLabel(course.labels, locale, course.primaryLocale);
                  return {
                    id: course.id,
                    title: words.title,
                    lang: words.locale,
                    href: courseHref(locale, course.slug),
                    lessons: course.lessons,
                  };
                })}
                signInHref={localizedPath(
                  locale,
                  `/signin?returnTo=${encodeURIComponent(myPath)}`,
                )}
                myPathHref={myPath}
                labels={progressLabels}
              />
              <div className="flex flex-col gap-3 rounded-panel border border-accent-rule bg-surface-raised p-5">
                <h2 className="text-subheading font-semibold">{t('path.howHeading')}</h2>
                <ul className="flex list-none flex-col gap-2.5 p-0 text-sm">
                  {(['howOrder', 'howEnrol', 'howProgress'] as const).map((key) => (
                    <li key={key} className="flex gap-2.5">
                      <Icon
                        name="check"
                        size={16}
                        className="mt-0.5 shrink-0 text-accent"
                      />
                      <span>{t(`path.${key}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </header>

        {description.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="path-about">
            <h2 id="path-about" className="text-heading font-semibold">
              {t('path.about')}
            </h2>
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
          </section>
        )}

        <section className="flex flex-col gap-5" aria-labelledby="path-courses">
          <SectionHeader
            id="path-courses"
            heading={t('path.courses')}
            intro={t('path.coursesNote')}
          />
          {courses.length === 0 ? (
            <EmptyState>{t('path.empty')}</EmptyState>
          ) : (
            <ol
              aria-label={t('path.courses')}
              className="flex max-w-4xl list-none flex-col p-0"
            >
              {courses.map((course, index) => {
                const words = outlineLabel(course.labels, locale, course.primaryLocale);
                const content = { lang: words.locale, dir: directionOf(words.locale) };
                const language = languages.get(course.languageCode);
                const names = course.teacherIds.flatMap((id) => {
                  const person = references.people.get(id);
                  return person === undefined ? [] : [person];
                });
                const last = index === courses.length - 1;
                return (
                  <li key={course.id} className="flex min-w-0 gap-4">
                    {/* The journey's spine: a numbered stop, and the line to the next. */}
                    <div
                      aria-hidden="true"
                      className="flex shrink-0 flex-col items-center"
                    >
                      <span className="flex size-10 items-center justify-center rounded-full border border-accent-rule bg-accent-surface text-sm font-semibold text-accent tabular-nums">
                        {new Intl.NumberFormat(locale).format(index + 1)}
                      </span>
                      {last ? null : <span className="w-px flex-1 bg-accent-rule" />}
                    </div>
                    <div
                      className={`card-surface relative flex min-w-0 flex-1 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 hover:border-accent sm:p-5 ${
                        last ? '' : 'mb-4'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <span className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
                          {t('path.step', { step: index + 1, total: courses.length })}
                        </span>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <Badge>{t(`format.${course.format}`)}</Badge>
                          {course.level === null ? null : (
                            <span className="inline-flex items-center gap-2 text-caption font-medium text-foreground-muted">
                              <LevelSteps level={course.level} />
                              {t(`level.${course.level}`)}
                            </span>
                          )}
                        </span>
                      </div>
                      <h3
                        className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
                        {...content}
                      >
                        <a
                          href={courseHref(locale, course.slug)}
                          className="card-link text-foreground no-underline"
                        >
                          {words.title}
                        </a>
                      </h3>
                      {words.summary === '' ? null : (
                        <p
                          className="line-clamp-3 text-sm leading-relaxed wrap-anywhere text-foreground-muted"
                          {...content}
                        >
                          {words.summary}
                        </p>
                      )}
                      <MetaRow
                        items={[
                          <span
                            key="language"
                            lang={course.languageCode}
                            dir={language?.direction ?? 'auto'}
                          >
                            {language?.name ?? course.languageCode}
                          </span>,
                          t('card.modules', { count: course.modules }),
                          t('card.lessons', { count: course.lessons }),
                          names.length === 0 ? null : (
                            <span key="teachers" dir="auto">
                              {t('card.teachers')}:{' '}
                              {names.map((person) => person.name).join(' · ')}
                            </span>
                          ),
                        ]}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {teachers.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="path-teachers">
            <h2 id="path-teachers" className="text-heading font-semibold">
              {t('path.teachers')}
            </h2>
            <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
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

        <p className="text-sm">
          <TextLink href={learnPath(locale, 'paths')}>{t('landing.allPaths')}</TextLink>
        </p>

        <BreadcrumbData contentLocales={learningLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}
