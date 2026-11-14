import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  TOPIC_COURSE_PATHS,
  type CourseLevel,
  type CourseListing,
  type TopicCoursePage,
} from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
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
  byLevel,
  catalogueReadQuery,
  coursesFiltered,
  coursesHref,
  coursesPageCount,
  coursesRange,
  coursesReadQuery,
  levelSteps,
  type CoursesQuery,
  type CoursesScope,
} from './courses-view';
import type { HubDomain, HubLink } from './domain';
import { ActiveFilters, ExploreFilters, ExploreHero, languageName } from './parts';

/**
 * A SUBJECT'S COURSES HUB (Quran Part 13; shared with Hadith since Hadith Part
 * 1) — `/quran/courses`, `/hadith/courses` — AND, since Learn Part 1, LEARN'S
 * OWN CATALOGUE, `/learn/courses`: the same listing without a Topic scope.
 *
 * LAYER-4 COMPOSITION OF LEARNING'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §13.4): the courses are Learning's — its published Courses on the subject's
 * Taxonomy Topic, or every published Course in the catalogue — read through
 * Learning's public `topicCourses`, `topicCourseFacets` and `topicCoursePaths`
 * (the catalogue asks the first two with `scope: 'catalogue'`, where the Topic
 * is a filter, and names the latest learning paths); the names of their
 * teachers are People's, of their Topics and content languages Taxonomy's. No
 * subject context imports Learning; only this presentation layer composes
 * them.
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
 * In the level order — the listing's own — it reads from the first steps to
 * the most advanced, grouped by level. The published LearningPaths follow, and
 * then the surfaces a course is read alongside.
 *
 * ONE ADDRESS PER VIEW (`./courses-view`): a format, a Topic (the catalogue's),
 * a level, a content language, a teacher, an order and a page, each a GET
 * parameter, so the listing works without script and every view can be
 * shared. In the catalogue a filter that is malformed or names nothing lists
 * nothing and says why — it never broadens.
 */

/** What a listing says about itself, in its own words. */
export interface CoursesCopy {
  /** Above the title; a hub's is "Learn · Courses". */
  readonly eyebrow?: string;
  readonly lede: string;
  /** "12 courses on Hadith". */
  readonly stat: (count: number) => string;
  /** What the listing holds with every format. */
  readonly listIntro: string;
  readonly emptyTitle: string;
  readonly empty: string;
  readonly noResults: string;
  readonly pathsIntro: string;
  readonly alongsideIntro: string;
}

/** One of the surfaces a course is read alongside. */
export interface AlongsideEntry {
  readonly key: string;
  readonly href: string;
  readonly title: string;
  readonly body: string;
}

/** A Topic or a Person an address named, as its owner resolved it. */
export interface NamedReference {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/**
 * THE CATALOGUE'S VIEW (Learn Part 1): the Topic and the teacher its address
 * names, resolved at Layer 4 by Taxonomy and People; whether a filter was
 * malformed or named nothing; and its own ways onward.
 */
export interface CatalogueView {
  readonly topic: NamedReference | null;
  readonly teacher: NamedReference | null;
  readonly invalid: boolean;
  readonly invalidTitle: string;
  readonly invalidText: string;
  readonly actions: readonly HubLink[];
}

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;
type LearnTranslator = Awaited<ReturnType<typeof getTranslations<'learn'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

const EMPTY_PAGE: TopicCoursePage = { items: [], total: 0, hasMore: false };

/**
 * A level as three steps, the stated ones filled — beside the level's NAME,
 * which carries the meaning; the steps are decoration and hidden.
 */
const STEP_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5'] as const;

export function LevelSteps({ level }: { readonly level: CourseLevel }) {
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
  readonly t: HubTranslator;
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
          aria-label={t('courses.viewCourseNamed', { title: label.title })}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
        >
          {t('courses.viewCourse')}
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

/**
 * A row of Course cards outside a listing — the Learn landing's newest, a
 * Course page's related Courses — every teacher on it resolved in ONE People
 * call and the content languages in ONE Taxonomy call. Nothing when empty.
 */
export async function CourseShelf({
  locale,
  courses,
  label,
  heading = 'h3',
}: {
  readonly locale: Locale;
  readonly courses: readonly CourseListing[];
  readonly label: string;
  readonly heading?: 'h3' | 'h4';
}) {
  if (courses.length === 0) return null;
  const [t, l, names, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'learn' }),
    referenceNames(
      { personIds: courses.flatMap((course) => course.teacherIds), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
  return (
    <CourseList
      label={label}
      courses={courses}
      locale={locale}
      people={names.people}
      languages={languages}
      heading={heading}
      t={t}
      l={l}
    />
  );
}

export async function CoursesHub({
  domain,
  scope,
  query,
  copy,
  alongside,
  catalogue,
}: {
  readonly domain: HubDomain;
  readonly scope: CoursesScope;
  readonly query: CoursesQuery;
  readonly copy: CoursesCopy;
  /** The surfaces a course is read alongside; none, no section. */
  readonly alongside: readonly AlongsideEntry[];
  /** Present for the catalogue only (Learn Part 1). */
  readonly catalogue?: CatalogueView;
}) {
  const { locale } = domain;
  const [t, l] = await Promise.all([
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'learn' }),
  ]);
  const learning = learningReadRuntime();
  const invalid = catalogue?.invalid === true;
  const read =
    catalogue === undefined
      ? coursesReadQuery(query, domain.topicId, locale)
      : catalogueReadQuery(
          query,
          { topic: catalogue.topic?.id ?? null, teacher: catalogue.teacher?.id ?? null },
          locale,
        );
  const [page, facets, paths, languages] = await Promise.all([
    // A filter that names nothing lists nothing; the figures stay the whole
    // catalogue's, and nothing is broadened.
    invalid ? EMPTY_PAGE : learning.topicCourses(read),
    learning.topicCourseFacets(invalid ? { scope: 'catalogue' } : read),
    catalogue === undefined
      ? learning.topicCoursePaths(domain.topicId)
      : learning.paths(0).then((result) => result.items.slice(0, TOPIC_COURSE_PATHS)),
    contentLanguages(),
  ]);
  const names = await referenceNames(
    {
      personIds: [
        ...page.items.flatMap((course) => course.teacherIds),
        ...facets.teachers.items.map((facet) => facet.id),
        ...(catalogue === undefined && query.teacher !== null ? [query.teacher] : []),
      ],
      topicIds: facets.topics.items.map((facet) => facet.id),
    },
    locale,
  );

  const LIST_ID = `${domain.key}-courses-list`;
  const PATHS_ID = `${domain.key}-courses-paths`;
  const ALONGSIDE_ID = `${domain.key}-courses-alongside`;
  const title = domain.title;
  const hub = facets.hub;
  const filtered = coursesFiltered(query);
  const neutral = {
    format: null,
    topic: null,
    level: null,
    language: null,
    teacher: null,
  } as const;
  const base = coursesHref(scope, locale, query, neutral);
  const pages = coursesPageCount(page.total);
  const range = coursesRange(query.page, page.items.length);
  const card = { locale, people: names.people, languages, t, l };

  // A hub's teacher is a People identifier; the catalogue's a People slug.
  const teacherOptions = facets.teachers.items.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined
      ? []
      : [
          {
            value: catalogue === undefined ? facet.id : person.slug,
            name: person.name,
            courses: facet.courses,
          },
        ];
  });
  const teacherName =
    catalogue === undefined
      ? query.teacher === null
        ? null
        : (names.people.get(query.teacher)?.name ?? null)
      : (catalogue.teacher?.name ?? null);
  // A chosen teacher none of the other filters leaves stays chosen, at nought.
  if (
    query.teacher !== null &&
    teacherName !== null &&
    !teacherOptions.some((option) => option.value === query.teacher)
  )
    teacherOptions.push({ value: query.teacher, name: teacherName, courses: 0 });
  const topicOptions = facets.topics.items.flatMap((facet) => {
    const topic = names.topics.get(facet.id);
    return topic === undefined
      ? []
      : [{ value: topic.slug, name: topic.name, courses: facet.courses }];
  });
  const chosenTopic = catalogue?.topic ?? null;
  if (chosenTopic !== null && !topicOptions.some((o) => o.value === chosenTopic.slug))
    topicOptions.push({ value: chosenTopic.slug, name: chosenTopic.name, courses: 0 });

  const levelOptions = (['beginner', 'intermediate', 'advanced'] as const).filter(
    (level) => facets.levels[level] > 0 || query.level === level,
  );
  const showTopic =
    catalogue !== undefined && (topicOptions.length > 0 || query.topic !== null);
  const showLevel = levelOptions.length > 1 || query.level !== null;
  const showLanguage = facets.languages.items.length > 1 || query.language !== null;
  const showTeacher = teacherOptions.length > 0 || query.teacher !== null;
  const showFormats =
    !invalid && ((hub.live > 0 && hub.selfPaced > 0) || query.format !== null);
  const formatKey = query.format ?? 'all';
  // The catalogue names its learning paths beside the whole catalogue only: a
  // filtered or explained-empty view is about the filters, and the paths are
  // not narrowed by them (a hub's are its Topic's, so it always names them).

  const active = [
    ...(chosenTopic === null
      ? []
      : [
          {
            key: 'topic',
            text: chosenTopic.name,
            removeHref: coursesHref(scope, locale, query, { topic: null }),
          },
        ]),
    ...(query.level === null
      ? []
      : [
          {
            key: 'level',
            text: l(`level.${query.level}`),
            removeHref: coursesHref(scope, locale, query, { level: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeHref: coursesHref(scope, locale, query, { language: null }),
          },
        ]),
    ...(query.teacher === null
      ? []
      : [
          {
            key: 'teacher',
            text: teacherName ?? t('courses.unknownTeacher'),
            removeHref: coursesHref(scope, locale, query, { teacher: null }),
          },
        ]),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('common.remove', { name: filter.text }),
  }));

  // In the level order the page reads as steps, grouped by level.
  const grouped = query.sort === 'level';
  const groups = grouped ? byLevel(page.items) : [];

  const actions =
    catalogue === undefined
      ? [
          { href: courseBrowseHref(locale), text: t('courses.catalogue') },
          ...(hub.live === 0
            ? []
            : [{ href: learnPath(locale, 'trial'), text: l('course.trialLink') }]),
        ]
      : catalogue.actions;

  return domain.frame(
    <>
      <ExploreHero
        eyebrow={copy.eyebrow ?? t('courses.eyebrow')}
        title={title}
        lede={copy.lede}
        stats={[
          ...(hub.courses === 0
            ? []
            : [
                {
                  value: hub.courses,
                  label: copy.stat(hub.courses),
                  href: `#${LIST_ID}`,
                },
              ]),
          ...(hub.live === 0 || hub.selfPaced === 0
            ? []
            : [
                {
                  value: hub.live,
                  label: t('courses.statLive', { count: hub.live }),
                  href: coursesHref(scope, locale, query, { ...neutral, format: 'live' }),
                },
                {
                  value: hub.selfPaced,
                  label: t('courses.statSelfPaced', { count: hub.selfPaced }),
                  href: coursesHref(scope, locale, query, {
                    ...neutral,
                    format: 'self-paced',
                  }),
                },
              ]),
          ...(hub.lessons === 0
            ? []
            : [
                {
                  value: hub.lessons,
                  label: t('courses.statLessons', { count: hub.lessons }),
                },
              ]),
          ...(hub.teachers === 0
            ? []
            : [
                {
                  value: hub.teachers,
                  label: t('courses.statTeachers', { count: hub.teachers }),
                },
              ]),
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('common.statLanguages', { count: hub.languages }),
                },
              ]),
        ]}
        actions={actions}
      />

      {hub.courses === 0 ? (
        <EmptyState
          icon="book"
          title={copy.emptyTitle}
          {...(catalogue === undefined
            ? { action: { href: courseBrowseHref(locale), text: t('courses.catalogue') } }
            : {})}
        >
          {copy.empty}
        </EmptyState>
      ) : (
        <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
          <SectionHeader
            id={LIST_ID}
            heading={t('courses.listHeading')}
            intro={
              formatKey === 'all' ? copy.listIntro : t(`courses.formatHelp.${formatKey}`)
            }
          />

          {showFormats ? (
            <LinkTabs
              label={t('courses.formats')}
              tabs={(['all', 'live', 'self-paced'] as const).map((format) => ({
                href: coursesHref(scope, locale, query, {
                  format: format === 'all' ? null : format,
                }),
                text: format === 'all' ? t('courses.allFormats') : l(`format.${format}`),
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
            action={localizedPath(locale, scope.path)}
            label={t('courses.filters')}
            hidden={
              query.format === null || invalid
                ? []
                : [{ name: 'format', value: query.format }]
            }
            submit={t('courses.apply')}
            reset={filtered || invalid ? { href: base, text: t('common.reset') } : null}
          >
            {showTopic ? (
              <Field id="courses-topic" label={l('filter.topic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={query.topic ?? ''}>
                    <option value="">{l('filter.anyTopic')}</option>
                    {topicOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t('common.option', {
                          name: option.name,
                          count: option.courses,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showLevel ? (
              <Field id="courses-level" label={l('filter.level')}>
                {(props) => (
                  <Select {...props} name="level" defaultValue={query.level ?? ''}>
                    <option value="">{t('courses.anyLevel')}</option>
                    {levelOptions.map((level) => (
                      <option key={level} value={level}>
                        {t('common.option', {
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
              <Field id="courses-language" label={t('common.filterLanguage')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={query.language ?? ''}>
                    <option value="">{t('common.anyLanguage')}</option>
                    {facets.languages.items.map((facet) => (
                      <option key={facet.id} value={facet.id}>
                        {t('common.option', {
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
                    <option value="">{t('courses.anyTeacher')}</option>
                    {teacherOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t('common.option', {
                          name: option.name,
                          count: option.courses,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field id="courses-sort" label={t('common.filterSort')}>
              {(props) => (
                <Select {...props} name="sort" defaultValue={query.sort}>
                  <option value="level">{t('courses.sortLevel')}</option>
                  <option value="newest">{t('common.sort.newest')}</option>
                  <option value="title">{t('common.sort.title')}</option>
                </Select>
              )}
            </Field>
          </ExploreFilters>

          {invalid ? null : <ActiveFilters label={t('common.active')} filters={active} />}

          {range === null ? null : (
            <p className="text-sm text-foreground-muted">
              {t('courses.summary', {
                from: range.from,
                to: range.to,
                total: page.total,
              })}
            </p>
          )}

          {invalid ? (
            <EmptyState
              icon="search"
              title={catalogue?.invalidTitle}
              action={{ href: base, text: t('common.reset') }}
            >
              {catalogue?.invalidText}
            </EmptyState>
          ) : page.items.length === 0 ? (
            query.page > 1 && page.total > 0 ? (
              <EmptyState
                title={t('common.pastEndTitle')}
                action={{
                  href: coursesHref(scope, locale, query, { page: 1 }),
                  text: t('common.firstPage'),
                }}
              >
                {t('courses.pastEnd', { page: query.page })}
              </EmptyState>
            ) : (
              <EmptyState
                title={t('courses.noResultsTitle')}
                action={{ href: base, text: t('common.reset') }}
              >
                {copy.noResults}
              </EmptyState>
            )
          ) : grouped ? (
            <div className="flex flex-col gap-8">
              {groups.map((group, index) => {
                const id = `${domain.key}-courses-level-${String(index)}`;
                const key = group.level ?? 'unstated';
                const name =
                  group.level === null
                    ? t('courses.levelUnstated')
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
                        {t(`courses.levelHelp.${key}`)}
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
              label={t('courses.pages')}
              previous={
                query.page > 1
                  ? coursesHref(scope, locale, query, { page: query.page - 1 })
                  : null
              }
              next={
                page.hasMore
                  ? coursesHref(scope, locale, query, { page: query.page + 1 })
                  : null
              }
              previousLabel={domain.previous}
              nextLabel={domain.next}
              pages={{
                current: query.page,
                total: pages,
                href: (number) => coursesHref(scope, locale, query, { page: number }),
                label: (number) => t('common.pageLabel', { page: number }),
                format: (number) => new Intl.NumberFormat(locale).format(number),
              }}
            />
          )}
        </section>
      )}

      {paths.length === 0 || (catalogue !== undefined && (filtered || invalid)) ? null : (
        <section aria-labelledby={PATHS_ID} className="flex flex-col gap-5">
          <SectionHeader
            id={PATHS_ID}
            heading={t('courses.pathsHeading')}
            intro={copy.pathsIntro}
            action={{ href: learnPath(locale, 'paths'), text: t('courses.allPaths') }}
          />
          <PathGrid
            locale={locale}
            paths={paths}
            label={t('courses.pathsHeading')}
            headingLevel="h3"
          />
        </section>
      )}

      {alongside.length === 0 ? null : (
        <section aria-labelledby={ALONGSIDE_ID} className="flex flex-col gap-4">
          <SectionHeader
            id={ALONGSIDE_ID}
            heading={t('courses.alongsideHeading')}
            intro={copy.alongsideIntro}
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
                  {entry.title}
                  <Icon name="arrow-end" size={16} className="text-accent" />
                </a>
                <p className="text-sm text-foreground-muted">{entry.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="max-w-[var(--measure-prose)] border-t border-border pt-4 text-sm text-foreground-muted">
        {t('courses.about')}
      </p>
    </>,
  );
}
