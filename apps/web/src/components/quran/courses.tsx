import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { CourseLevel, CourseListing } from '@minhaj/contracts/learning';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { learningReadRuntime } from '@/composition/learning-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { quranReadRuntime } from '@/composition/quran-read';
import { PathGrid } from '@/components/learning/parts';
import {
  courseBrowseHref,
  courseHref,
  learnPath,
  outlineLabel,
} from '@/components/learning/presentation';
import {
  Badge,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  MetaRow,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  COURSES_PATH,
  byLevel,
  coursesFiltered,
  coursesHref,
  coursesPageCount,
  coursesRange,
  coursesReadQuery,
  levelSteps,
  type CoursesQuery,
} from './courses-view';
import { ActiveFilters, ExploreFilters, ExploreHero, languageName } from './explore';
import { QuranFrame, quranTrail } from './parts';
import { quranPath } from './presentation';
import { readQuranTopic, readTajweedOverlays } from './read';

/**
 * THE QURAN COURSES HUB (Quran Part 13) — `/quran/courses`.
 *
 * LAYER-4 COMPOSITION OF LEARNING'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §13.4): the courses are Learning's — its published Courses on Taxonomy's
 * `quran` Topic — read through Learning's public `topicCourses`,
 * `topicCourseFacets` and `topicCoursePaths`; the names of their teachers are
 * People's, the content languages' names and directions Taxonomy's. Quran
 * imports nothing of Learning; only this presentation layer composes them.
 *
 * FOR A LEARNER CHOOSING A COURSE. Each card states what the record has and
 * nothing more: how it is studied (taught live or self-paced), its level when
 * one is stated, its title and summary in their own language, the People
 * attributed as its teachers, its content language and how many modules and
 * lessons its syllabus holds — and the way to the course's own page, where the
 * syllabus is read and a signed-in learner enrols or asks for a trial class.
 * Learning records no cover, price, duration, rating or "featured" mark, so
 * none is shown; nothing here enrols or writes anything.
 *
 * In the level order — the hub's own — the list reads from the first steps to
 * the most advanced, grouped by level. The published LearningPaths that hold
 * one of these courses follow, and then the Quran's own study surfaces a
 * course is read alongside.
 *
 * ONE ADDRESS PER VIEW (`./courses-view`): a format, a level, a content
 * language, a teacher, an order and a page, each a GET parameter, so the hub
 * works without script and every view can be shared.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type LearnTranslator = Awaited<ReturnType<typeof getTranslations<'learn'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

const LIST_ID = 'quran-courses-list';
const PATHS_ID = 'quran-courses-paths';
const ALONGSIDE_ID = 'quran-courses-alongside';

/**
 * A level as three steps, the stated ones filled — beside the level's NAME,
 * which carries the meaning; the steps are decoration and hidden.
 */
const STEP_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5'] as const;

function LevelSteps({ level }: { readonly level: CourseLevel }) {
  const filled = levelSteps(level);
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-end gap-0.5">
      {STEP_HEIGHTS.map((height, index) => (
        <span
          key={height}
          className={`w-1 rounded-full ${height} ${
            index < filled ? 'bg-accent' : 'bg-border'
          }`}
        />
      ))}
    </span>
  );
}

function LevelMark({
  level,
  text,
}: {
  readonly level: CourseLevel;
  readonly text: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-caption font-medium text-foreground-muted">
      <LevelSteps level={level} />
      {text}
    </span>
  );
}

/**
 * ONE COURSE, as a learner weighs it. The title is the course's link to its
 * page; the action beneath is a second link to the same page, named with the
 * title so a list of links still says which course each opens.
 */
function CourseCard({
  locale,
  course,
  people,
  languages,
  heading,
  t,
  l,
}: {
  readonly locale: Locale;
  readonly course: CourseListing;
  readonly people: NameMap;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly heading: 'h3' | 'h4';
  readonly t: QuranTranslator;
  readonly l: LearnTranslator;
}) {
  const label = outlineLabel(course.labels, locale, course.primaryLocale);
  const content = { lang: label.locale, dir: directionOf(label.locale) };
  const href = courseHref(locale, course.slug);
  const language = languages.get(course.languageCode);
  const teachers = course.teacherIds.flatMap((id) => {
    const person = people.get(id);
    return person === undefined ? [] : [person.name];
  });
  const Heading = heading;

  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-control border border-accent-rule bg-accent-surface text-accent"
          >
            <Icon name={course.format === 'live' ? 'calendar' : 'book'} size={16} />
          </span>
          <Badge>{l(`format.${course.format}`)}</Badge>
        </span>
        {course.level === null ? null : (
          <LevelMark level={course.level} text={l(`level.${course.level}`)} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Heading
          className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
          {...content}
        >
          <a
            href={href}
            className="text-foreground underline decoration-accent-rule decoration-1 underline-offset-4 hover:decoration-accent active:text-action"
          >
            {label.title}
          </a>
        </Heading>
        {label.summary === '' ? null : (
          <p
            className="line-clamp-4 text-sm leading-relaxed wrap-anywhere text-foreground-muted"
            {...content}
          >
            {label.summary}
          </p>
        )}
      </div>
      {teachers.length === 0 ? null : (
        <p className="text-sm wrap-anywhere">
          <span className="text-foreground-muted">{l('card.teachers')}:</span>{' '}
          <span className="font-medium text-foreground" dir="auto">
            {teachers.join(' · ')}
          </span>
        </p>
      )}
      <MetaRow
        items={[
          <span
            key="language"
            lang={course.languageCode}
            dir={language?.direction ?? 'auto'}
          >
            {language?.name ?? languageName(course.languageCode, locale)}
          </span>,
          l('card.modules', { count: course.modules }),
          l('card.lessons', { count: course.lessons }),
        ]}
      />
      <p className="mt-auto border-t border-border pt-2">
        <a
          href={href}
          aria-label={t('coursesHub.viewCourseNamed', { title: label.title })}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
        >
          {t('coursesHub.viewCourse')}
          <Icon name="arrow-end" size={16} />
        </a>
      </p>
    </li>
  );
}

function CourseList({
  label,
  courses,
  ...card
}: {
  readonly label: string;
  readonly courses: readonly CourseListing[];
} & Omit<Parameters<typeof CourseCard>[0], 'course'>) {
  return (
    <ul
      aria-label={label}
      className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} {...card} />
      ))}
    </ul>
  );
}

export async function QuranCoursesPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: CoursesQuery;
}) {
  const [t, l, parts, topic] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    getTranslations({ locale, namespace: 'learn' }),
    quranTrail(locale),
    readQuranTopic(locale),
  ]);
  const learning = learningReadRuntime();
  const read = coursesReadQuery(query, topic?.id ?? null, locale);
  const [page, facets, paths, languages, tajweedRules, tajweedOverlays] =
    await Promise.all([
      learning.topicCourses(read),
      learning.topicCourseFacets(read),
      learning.topicCoursePaths(topic?.id ?? null),
      contentLanguages(),
      quranReadRuntime().reader.tajweedRules(),
      readTajweedOverlays(),
    ]);
  const names = await referenceNames(
    {
      personIds: [
        ...page.items.flatMap((course) => course.teacherIds),
        ...facets.teachers.items.map((facet) => facet.id),
        ...(query.teacher === null ? [] : [query.teacher]),
      ],
      topicIds: [],
    },
    locale,
  );

  const title = t('sections.courses');
  const hub = facets.hub;
  const filtered = coursesFiltered(query);
  const base = coursesHref(locale, query, {
    format: null,
    level: null,
    language: null,
    teacher: null,
  });
  const pages = coursesPageCount(page.total);
  const range = coursesRange(query.page, page.items.length);
  const card = { locale, people: names.people, languages, t, l };

  const teacherOptions = facets.teachers.items.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined
      ? []
      : [{ id: facet.id, name: person.name, courses: facet.courses }];
  });
  const levelOptions = (['beginner', 'intermediate', 'advanced'] as const).filter(
    (level) => facets.levels[level] > 0 || query.level === level,
  );
  const showLevel = levelOptions.length > 1 || query.level !== null;
  const showLanguage = facets.languages.items.length > 1 || query.language !== null;
  const showTeacher = teacherOptions.length > 0 || query.teacher !== null;
  const showFormats = (hub.live > 0 && hub.selfPaced > 0) || query.format !== null;
  const teacherName =
    query.teacher === null ? null : (names.people.get(query.teacher)?.name ?? null);
  const formatKey = query.format ?? 'all';

  const active = [
    ...(query.level === null
      ? []
      : [
          {
            key: 'level',
            text: l(`level.${query.level}`),
            removeHref: coursesHref(locale, query, { level: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeHref: coursesHref(locale, query, { language: null }),
          },
        ]),
    ...(query.teacher === null
      ? []
      : [
          {
            key: 'teacher',
            text: teacherName ?? t('coursesHub.unknownTeacher'),
            removeHref: coursesHref(locale, query, { teacher: null }),
          },
        ]),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('booksHub.remove', { name: filter.text }),
  }));

  // In the level order the page reads as steps, grouped by level.
  const grouped = query.sort === 'level';
  const groups = grouped ? byLevel(page.items) : [];
  const alongside: readonly {
    readonly key: 'read' | 'tafsir' | 'tajweed';
    readonly href: string;
  }[] = [
    { key: 'read', href: quranPath(locale, 'read') },
    { key: 'tafsir', href: quranPath(locale, 'tafsir') },
    ...(tajweedRules.length > 0 || tajweedOverlays.length > 0
      ? [{ key: 'tajweed' as const, href: quranPath(locale, 'tajweed') }]
      : []),
  ];

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <ExploreHero
        eyebrow={t('coursesHub.eyebrow')}
        title={title}
        lede={t('coursesHub.lede')}
        stats={[
          ...(hub.courses === 0
            ? []
            : [
                {
                  value: hub.courses,
                  label: t('coursesHub.statCourses', { count: hub.courses }),
                  href: `#${LIST_ID}`,
                },
              ]),
          ...(hub.live === 0 || hub.selfPaced === 0
            ? []
            : [
                {
                  value: hub.live,
                  label: t('coursesHub.statLive', { count: hub.live }),
                  href: coursesHref(locale, query, {
                    format: 'live',
                    level: null,
                    language: null,
                    teacher: null,
                  }),
                },
                {
                  value: hub.selfPaced,
                  label: t('coursesHub.statSelfPaced', { count: hub.selfPaced }),
                  href: coursesHref(locale, query, {
                    format: 'self-paced',
                    level: null,
                    language: null,
                    teacher: null,
                  }),
                },
              ]),
          ...(hub.lessons === 0
            ? []
            : [
                {
                  value: hub.lessons,
                  label: t('coursesHub.statLessons', { count: hub.lessons }),
                },
              ]),
          ...(hub.teachers === 0
            ? []
            : [
                {
                  value: hub.teachers,
                  label: t('coursesHub.statTeachers', { count: hub.teachers }),
                },
              ]),
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('booksHub.statLanguages', { count: hub.languages }),
                },
              ]),
        ]}
        actions={[
          { href: courseBrowseHref(locale), text: t('coursesHub.catalogue') },
          ...(hub.live === 0
            ? []
            : [{ href: learnPath(locale, 'trial'), text: l('course.trialLink') }]),
        ]}
      />

      {hub.courses === 0 ? (
        <EmptyState
          icon="book"
          title={t('coursesHub.emptyTitle')}
          action={{ href: courseBrowseHref(locale), text: t('coursesHub.catalogue') }}
        >
          {t('coursesHub.empty')}
        </EmptyState>
      ) : (
        <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
          <SectionHeader
            id={LIST_ID}
            heading={t('coursesHub.listHeading')}
            intro={t(`coursesHub.formatHelp.${formatKey}`)}
          />

          {showFormats ? (
            <LinkTabs
              label={t('coursesHub.formats')}
              tabs={(['all', 'live', 'self-paced'] as const).map((format) => ({
                href: coursesHref(locale, query, {
                  format: format === 'all' ? null : format,
                }),
                text:
                  format === 'all' ? t('coursesHub.allFormats') : l(`format.${format}`),
                current: formatKey === format,
                count: String(
                  format === 'all'
                    ? facets.formats.all
                    : format === 'live'
                      ? facets.formats.live
                      : facets.formats.selfPaced,
                ),
              }))}
            />
          ) : null}

          <ExploreFilters
            action={localizedPath(locale, COURSES_PATH)}
            label={t('coursesHub.filters')}
            hidden={
              query.format === null ? [] : [{ name: 'format', value: query.format }]
            }
            submit={t('coursesHub.apply')}
            reset={filtered ? { href: base, text: t('booksHub.reset') } : null}
          >
            {showLevel ? (
              <Field id="courses-level" label={l('filter.level')}>
                {(props) => (
                  <Select {...props} name="level" defaultValue={query.level ?? ''}>
                    <option value="">{t('coursesHub.anyLevel')}</option>
                    {levelOptions.map((level) => (
                      <option key={level} value={level}>
                        {t('booksHub.option', {
                          name: l(`level.${level}`),
                          count: facets.levels[level],
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showLanguage ? (
              <Field id="courses-language" label={t('booksHub.filterLanguage')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={query.language ?? ''}>
                    <option value="">{t('booksHub.anyLanguage')}</option>
                    {facets.languages.items.map((facet) => (
                      <option key={facet.id} value={facet.id}>
                        {t('booksHub.option', {
                          name: languageName(facet.id, locale),
                          count: facet.courses,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showTeacher ? (
              <Field id="courses-teacher" label={l('filter.teacher')}>
                {(props) => (
                  <Select {...props} name="teacher" defaultValue={query.teacher ?? ''}>
                    <option value="">{t('coursesHub.anyTeacher')}</option>
                    {teacherOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t('booksHub.option', {
                          name: option.name,
                          count: option.courses,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field id="courses-sort" label={t('booksHub.filterSort')}>
              {(props) => (
                <Select {...props} name="sort" defaultValue={query.sort}>
                  <option value="level">{t('coursesHub.sortLevel')}</option>
                  <option value="newest">{t('booksHub.sort.newest')}</option>
                  <option value="title">{t('booksHub.sort.title')}</option>
                </Select>
              )}
            </Field>
          </ExploreFilters>

          <ActiveFilters label={t('booksHub.active')} filters={active} />

          {range === null ? null : (
            <p className="text-sm text-foreground-muted">
              {t('coursesHub.summary', {
                from: range.from,
                to: range.to,
                total: page.total,
              })}
            </p>
          )}

          {page.items.length === 0 ? (
            query.page > 1 && page.total > 0 ? (
              <EmptyState
                title={t('booksHub.pastEndTitle')}
                action={{
                  href: coursesHref(locale, query, { page: 1 }),
                  text: t('booksHub.firstPage'),
                }}
              >
                {t('coursesHub.pastEnd', { page: query.page })}
              </EmptyState>
            ) : (
              <EmptyState
                title={t('coursesHub.noResultsTitle')}
                action={{ href: base, text: t('booksHub.reset') }}
              >
                {t('coursesHub.noResults')}
              </EmptyState>
            )
          ) : grouped ? (
            <div className="flex flex-col gap-8">
              {groups.map((group, index) => {
                const id = `quran-courses-level-${String(index)}`;
                const key = group.level ?? 'unstated';
                const name =
                  group.level === null
                    ? t('coursesHub.levelUnstated')
                    : l(`level.${group.level}`);
                return (
                  <section key={id} aria-labelledby={id} className="flex flex-col gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h3
                        id={id}
                        className="flex items-center gap-3 text-subheading font-semibold"
                      >
                        {group.level === null ? null : <LevelSteps level={group.level} />}
                        {name}
                      </h3>
                      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
                        {t(`coursesHub.levelHelp.${key}`)}
                      </p>
                    </div>
                    <CourseList
                      label={name}
                      courses={group.items}
                      heading="h4"
                      {...card}
                    />
                  </section>
                );
              })}
            </div>
          ) : (
            <CourseList label={title} courses={page.items} heading="h3" {...card} />
          )}

          {page.items.length === 0 ? null : (
            <Pager
              label={t('coursesHub.pages')}
              previous={
                query.page > 1
                  ? coursesHref(locale, query, { page: query.page - 1 })
                  : null
              }
              next={
                page.hasMore ? coursesHref(locale, query, { page: query.page + 1 }) : null
              }
              previousLabel={t('previous')}
              nextLabel={t('next')}
              pages={{
                current: query.page,
                total: pages,
                href: (number) => coursesHref(locale, query, { page: number }),
                label: (number) => t('booksHub.pageLabel', { page: number }),
                format: (number) => new Intl.NumberFormat(locale).format(number),
              }}
            />
          )}
        </section>
      )}

      {paths.length === 0 ? null : (
        <section aria-labelledby={PATHS_ID} className="flex flex-col gap-5">
          <SectionHeader
            id={PATHS_ID}
            heading={t('coursesHub.pathsHeading')}
            intro={t('coursesHub.pathsIntro')}
            action={{ href: learnPath(locale, 'paths'), text: t('coursesHub.allPaths') }}
          />
          <PathGrid
            locale={locale}
            paths={paths}
            label={t('coursesHub.pathsHeading')}
            headingLevel="h3"
          />
        </section>
      )}

      <section aria-labelledby={ALONGSIDE_ID} className="flex flex-col gap-4">
        <SectionHeader
          id={ALONGSIDE_ID}
          heading={t('coursesHub.alongsideHeading')}
          intro={t('coursesHub.alongsideIntro')}
        />
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {alongside.map((entry) => (
            <li
              key={entry.key}
              className="card-surface relative flex min-w-0 flex-col gap-1.5 rounded-panel border border-border bg-surface-raised p-4 hover:border-accent"
            >
              <a
                href={entry.href}
                className="card-link inline-flex items-center gap-1.5 font-semibold text-foreground no-underline"
              >
                {t(`sections.${entry.key}`)}
                <Icon name="arrow-end" size={16} className="text-accent" />
              </a>
              <p className="text-sm text-foreground-muted">
                {t(`sectionBody.${entry.key}`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <p className="max-w-[var(--measure-prose)] border-t border-border pt-4 text-sm text-foreground-muted">
        {t('coursesHub.about')}
      </p>
    </QuranFrame>
  );
}
