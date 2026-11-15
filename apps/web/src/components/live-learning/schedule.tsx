import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { CLASS_PAGE } from '@minhaj/contracts/learning';

import { publicSchedule } from '@/composition/learning-teachers';
import { contentLanguages } from '@/composition/public-references';
import { learnTrail, LevelSteps } from '@/components/learning/parts';
import {
  courseHref,
  learnPageLinks,
  learnPath,
  outlineLabel,
} from '@/components/learning/presentation';
import { readCourse, readPublicPerson } from '@/components/learning/read';
import { Pagination } from '@/components/media/parts';
import { ActiveFilters, ExploreFilters, ExploreHero } from '@/components/topic-hub/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  MetaRow,
  SectionHeader,
  Select,
  TextLink,
  type IconName,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { ClassTime, LiveFixtureNotice, TeacherName } from './parts';
import { ScheduleDays, type ScheduleDayLabels } from './schedule-days';
import {
  classDay,
  isFilteredSchedule,
  isInvalidSchedule,
  scheduleHref,
  scheduleViewOf,
  type ScheduleQuery,
  type ScheduleView,
} from './presentation';

/**
 * `/learn/live` — the public schedule of upcoming classes (ROUTE_MAP.md §3.5;
 * DELIVERY_PLAN.md Phase 23; Learn Part 2).
 *
 * WHAT IS SHOWN IS WHAT IS PUBLIC: a class's Course, its teacher's PUBLIC name
 * where People publishes one, and its time in the zone it was scheduled in —
 * never a participant, a booking, a window or a meeting address. The meeting
 * link is a learner's, shown only in their own My classes; the page says so in
 * its "how to join" steps. The page reads through the public roots only, so it
 * has no session, no identity service and nothing that could read a cookie.
 *
 * DAY BY DAY (Learn Part 2). The classes are grouped by the day they start on —
 * in each class's own zone on the server, regrouped in the reader's own zone by
 * the browser once it has hydrated (`./schedule-days`), every class naming its
 * own zone beside its time.
 *
 * FILTERS WITH COUNTS (Learn Part 2): a Course, a teacher (their People slug,
 * matched at Layer 4 to the accounts teaching a matching class) and a content
 * language, each option counted by Learning's own schedule aggregates leaving
 * its own filter out. A filter is offered only while it can narrow. A value
 * that is malformed, or names no published Course, no public Person or no known
 * language, lists NOTHING and says why — it never broadens.
 *
 * HONEST WHILE SWITCHED OFF. With no activation in force the page says live
 * learning is not available, in words, rather than showing an empty week; a
 * fixture activation carries a visible banner. Both states are kept out of
 * indexing by the route's own metadata.
 */

/** How joining a class works, in order. */
const JOIN = [
  { key: 'enrol', icon: 'book' },
  { key: 'classes', icon: 'calendar' },
  { key: 'meet', icon: 'video' },
] as const satisfies readonly { key: string; icon: IconName }[];

export async function LiveSchedulePage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: ScheduleQuery;
}) {
  const [t, learn, trail, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'learnLive' }),
    getTranslations({ locale, namespace: 'learn' }),
    learnTrail(locale),
    contentLanguages(),
  ]);
  const view = scheduleViewOf(query);
  const malformed = isInvalidSchedule(query);
  const filtered = isFilteredSchedule(query);

  // The owners decide what the address names: Learning the Course, People the
  // Person, Taxonomy the language.
  const [course, person] = await Promise.all([
    view.course === null ? Promise.resolve(null) : readCourse(view.course),
    view.teacher === null
      ? Promise.resolve(null)
      : readPublicPerson(locale, view.teacher),
  ]);
  const unknown =
    (view.course !== null && course === null) ||
    (view.teacher !== null && person === null) ||
    (view.language !== null && !languages.has(view.language));
  const invalid = malformed || unknown;

  const result = await publicSchedule(locale, {
    courseId: invalid ? null : (course?.id ?? null),
    teacherSlug: invalid ? null : view.teacher,
    language: invalid ? null : view.language,
    offset: invalid ? 0 : view.offset,
  });
  const { mode, facets, profiles } = result;
  const items = invalid ? [] : result.page.items;
  const links = learnPageLinks(view.offset, CLASS_PAGE, !invalid && result.page.hasMore);
  const href = (change: Partial<ScheduleView>) =>
    scheduleHref(locale, { ...view, offset: 0, ...change });
  const base = scheduleHref(locale);

  // Every option is a count of the classes choosing it would show.
  const courseOptions = facets.courses.map((facet) => {
    const words = outlineLabel(facet.course.labels, locale, facet.course.primaryLocale);
    return { value: facet.course.slug, name: words.title, classes: facet.classes };
  });
  const teacherOptions = facets.teachers.flatMap((facet) => {
    const profile = profiles.get(facet.accountId);
    return profile === undefined
      ? []
      : [{ value: profile.slug, name: profile.name, classes: facet.classes }];
  });
  const languageOptions = facets.languages.map((facet) => ({
    value: facet.code,
    name: languages.get(facet.code)?.name ?? facet.code,
    classes: facet.classes,
  }));
  const showCourse = courseOptions.length > 1 || view.course !== null;
  const showTeacher = teacherOptions.length > 1 || view.teacher !== null;
  const showLanguage = languageOptions.length > 1 || view.language !== null;
  const option = (entry: { name: string; classes: number }) =>
    t('filter.option', { name: entry.name, count: entry.classes });

  const courseName =
    course === null ? null : outlineLabel(course.labels, locale, course.primaryLocale);
  const active = [
    ...(view.course === null
      ? []
      : [
          {
            key: 'course',
            text: courseName?.title ?? view.course,
            removeHref: href({ course: null }),
          },
        ]),
    ...(view.teacher === null
      ? []
      : [
          {
            key: 'teacher',
            text: person?.label.name ?? view.teacher,
            removeHref: href({ teacher: null }),
          },
        ]),
    ...(view.language === null
      ? []
      : [
          {
            key: 'language',
            text: languages.get(view.language)?.name ?? view.language,
            removeHref: href({ language: null }),
          },
        ]),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('filter.remove', { name: filter.text }),
  }));

  const dayLabels: ScheduleDayLabels = {
    list: t('listLabel'),
    dayList: t.raw('days.dayList') as string,
    today: t('days.today'),
    tomorrow: t('days.tomorrow'),
    yourZone: t.raw('days.yourZone') as string,
    classZones: t('days.classZones'),
    yourTime: t.raw('days.yourTime') as string,
  };

  const stats =
    mode === null || facets.upcoming === 0
      ? []
      : [
          {
            value: facets.upcoming,
            label: t('statClasses', { count: facets.upcoming }),
            ...(filtered ? { href: base } : {}),
          },
          ...(filtered
            ? []
            : [
                {
                  value: facets.courses.length,
                  label: t('statCourses', { count: facets.courses.length }),
                },
                ...(facets.teachers.length === 0
                  ? []
                  : [
                      {
                        value: facets.teachers.length,
                        label: t('statTeachers', { count: facets.teachers.length }),
                      },
                    ]),
              ]),
        ];

  return (
    <Container>
      <div className="flex flex-col gap-[var(--space-section)] pt-6 pb-[var(--space-section)]">
        <div className="flex flex-col gap-6">
          <LiveFixtureNotice mode={mode} text={t('fixture')} />
          <Breadcrumbs
            label={trail.label}
            trail={[trail.home, trail.learn, { text: t('title') }]}
          />
          <ExploreHero
            eyebrow={learn('title')}
            title={t('title')}
            lede={t('intro')}
            stats={stats}
            actions={[
              { href: learnPath(locale, 'teachers'), text: t('findTeacher') },
              { href: learnPath(locale, 'trial'), text: t('trialLink') },
            ]}
          />
        </div>

        {mode === null ? (
          <div className="flex flex-col gap-3">
            <Alert tone="info">{t('unavailable.body')}</Alert>
            <p>
              <TextLink href={localizedPath(locale, '/learn/courses')}>
                {t('unavailable.browse')}
              </TextLink>
            </p>
          </div>
        ) : (
          <section className="flex flex-col gap-5" aria-labelledby="live-classes">
            <SectionHeader id="live-classes" heading={t('listHeading')} />
            {showCourse || showTeacher || showLanguage ? (
              <ExploreFilters
                action={base}
                label={t('filter.label')}
                hidden={[]}
                submit={t('filter.apply')}
                reset={filtered ? { href: base, text: learn('filter.clear') } : null}
              >
                {showCourse ? (
                  <Field id="live-filter-course" label={t('filter.course')}>
                    {(props) => (
                      <Select {...props} name="course" defaultValue={view.course ?? ''}>
                        <option value="">{t('filter.any')}</option>
                        {courseOptions.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {option(entry)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {showTeacher ? (
                  <Field id="live-filter-teacher" label={t('filter.teacher')}>
                    {(props) => (
                      <Select {...props} name="teacher" defaultValue={view.teacher ?? ''}>
                        <option value="">{t('filter.any')}</option>
                        {teacherOptions.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {option(entry)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {showLanguage ? (
                  <Field id="live-filter-language" label={t('filter.language')}>
                    {(props) => (
                      <Select
                        {...props}
                        name="language"
                        defaultValue={view.language ?? ''}
                      >
                        <option value="">{t('filter.any')}</option>
                        {languageOptions.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {option(entry)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
              </ExploreFilters>
            ) : null}
            <ActiveFilters label={t('filter.active')} filters={active} />

            {invalid ? (
              <div className="flex flex-col gap-2">
                <Alert tone="info">{t('filter.invalid')}</Alert>
                <p>
                  <TextLink href={base}>{learn('filter.clear')}</TextLink>
                </p>
              </div>
            ) : items.length === 0 ? (
              <EmptyState>
                {filtered ? (
                  <span className="flex flex-col gap-2">
                    <span>{t('filter.noResults')}</span>
                    <TextLink href={base}>{learn('filter.clear')}</TextLink>
                  </span>
                ) : view.offset === 0 ? (
                  t('empty')
                ) : (
                  t('beyond')
                )}
              </EmptyState>
            ) : (
              <ScheduleDays
                locale={locale}
                labels={dayLabels}
                items={items.map((session) => {
                  const label = outlineLabel(
                    session.course.labels,
                    locale,
                    session.course.primaryLocale,
                  );
                  const language = languages.get(session.course.languageCode);
                  return {
                    id: session.id,
                    startsAt: session.startsAt.toISOString(),
                    endsAt: session.endsAt.toISOString(),
                    timeZone: session.timeZone,
                    classDay: classDay(session.startsLocal),
                    card: (
                      <div className="flex min-w-0 flex-col gap-2">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                          <Icon
                            name="calendar"
                            size={16}
                            className="shrink-0 text-accent"
                          />
                          <ClassTime
                            instant={session.startsAt}
                            local={session.startsLocal}
                            timeZone={session.timeZone}
                            locale={locale}
                            date={false}
                          />
                          <span aria-hidden="true">–</span>
                          <ClassTime
                            instant={session.endsAt}
                            local={session.endsLocal}
                            timeZone={session.timeZone}
                            locale={locale}
                            date={false}
                          />
                        </p>
                        <h3
                          className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
                          lang={label.locale}
                          dir={directionOf(label.locale)}
                        >
                          <TextLink href={courseHref(locale, session.course.slug)}>
                            {label.title}
                          </TextLink>
                        </h3>
                        <p className="flex flex-wrap gap-x-2 text-sm">
                          <span className="text-foreground-muted">{t('teacher')}</span>
                          <TeacherName
                            profile={profiles.get(session.teacherAccountId)}
                            locale={locale}
                            fallback={t('teacherUnnamed')}
                          />
                        </p>
                        <MetaRow
                          items={[
                            session.course.level === null ? null : (
                              <span
                                key="level"
                                className="inline-flex items-center gap-2"
                              >
                                <LevelSteps level={session.course.level} />
                                {learn(`level.${session.course.level}`)}
                              </span>
                            ),
                            <span
                              key="language"
                              lang={session.course.languageCode}
                              dir={language?.direction ?? 'auto'}
                            >
                              {language?.name ?? session.course.languageCode}
                            </span>,
                            t('zone', { zone: session.timeZone }),
                          ]}
                        />
                      </div>
                    ),
                  };
                })}
              />
            )}

            {invalid ? null : (
              <Pagination
                label={t('title')}
                previous={
                  links.previous === null ? null : href({ offset: links.previous })
                }
                next={links.next === null ? null : href({ offset: links.next })}
                previousLabel={learn('previous')}
                nextLabel={learn('next')}
              />
            )}
          </section>
        )}

        {mode === null ? null : (
          <section className="flex flex-col gap-5" aria-labelledby="live-join">
            <SectionHeader
              id="live-join"
              heading={t('join.heading')}
              intro={t('join.intro')}
            />
            <ol className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
              {JOIN.map((step, index) => (
                <li
                  key={step.key}
                  className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accent-rule bg-accent-surface text-accent"
                    >
                      <Icon name={step.icon} size={20} />
                    </span>
                    <span
                      aria-hidden="true"
                      className="font-serif text-heading font-semibold text-accent-rule tabular-nums"
                    >
                      {new Intl.NumberFormat(locale).format(index + 1)}
                    </span>
                  </div>
                  <h3 className="text-subheading font-semibold">
                    {t(`join.steps.${step.key}.title`)}
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {t(`join.steps.${step.key}.body`)}
                  </p>
                </li>
              ))}
            </ol>
            <p className="text-sm">
              <TextLink href={localizedPath(locale, '/my/classes')}>
                {t('join.myClasses')}
              </TextLink>
            </p>
          </section>
        )}
      </div>
    </Container>
  );
}
