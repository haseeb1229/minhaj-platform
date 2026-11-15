import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { teacherDirectory } from '@/composition/learning-teachers';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import { learnTrail, LevelSteps } from '@/components/learning/parts';
import {
  courseHref,
  filterValue,
  learnPath,
  outlineLabel,
} from '@/components/learning/presentation';
import { portraitPath } from '@/components/people/portrait';
import { ActiveFilters, ExploreFilters, ExploreHero } from '@/components/topic-hub/parts';
import {
  Alert,
  Badge,
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  Portrait,
  SectionHeader,
  Select,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { LiveFixtureNotice, TeacherName } from './parts';
import {
  isFilteredTeacherDirectory,
  isInvalidTeacherDirectory,
  liveSchedulePath,
  teacherDirectoryHref,
  type TeacherDirectoryQuery,
  type TeacherDirectoryView,
} from './presentation';

/**
 * `/learn/teachers` — Find a Teacher, `?subject, language, availability`
 * (ROUTE_MAP.md §3.5; DELIVERY_PLAN.md Phase 23; Learn Part 2).
 *
 * A LISTED TEACHER IS CURRENT ON EVERY AXIS AT ONCE — Learning's current scope
 * on a published live Course while live learning is activated, Identity's live
 * `teaching.perform`, People's published TeacherProfile — and Layer 4
 * intersects the three (`teacherDirectory`). A PROFILE ALONE GRANTS NOTHING:
 * a published TeacherProfile with no live role, or no current scope, is not
 * listed. This page renders that answer and adds nothing: no rating, no
 * price, no window, no schedule, no account.
 *
 * EACH CARD is People's public face of the teacher — the published portrait
 * (served only through People's own route), the public name linked to their
 * profile, the profile's own subjects and languages — and Learning's
 * operational facts: the live Courses they teach now and whether they have an
 * open time. Nothing private is read, so nothing private can be shown.
 *
 * EVERY FILTER IS VALIDATED, COUNTED, AND NONE CAN BROADEN (Learn Part 2). The
 * subject is an ACTIVE Topic slug Taxonomy resolves; the language a
 * content-language code Taxonomy knows; availability the one word Learning
 * admits. Each option counts the teachers choosing it would show, leaving its
 * own filter out; a filter is offered only while it can narrow. A value that is
 * malformed, repeated or names nothing lists NOTHING and says why.
 *
 * A REAL GET FORM: every filter works without JavaScript and every view is a
 * shareable address — one per view — canonical to this listing.
 */
export async function TeacherDirectoryPage({
  locale,
  filters,
}: {
  readonly locale: Locale;
  readonly filters: TeacherDirectoryQuery;
}) {
  const [t, learn, trail, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'learnTeachers' }),
    getTranslations({ locale, namespace: 'learn' }),
    learnTrail(locale),
    contentLanguages(),
  ]);
  const malformed = isInvalidTeacherDirectory(filters);
  const filtered = isFilteredTeacherDirectory(filters);
  const view: Required<TeacherDirectoryView> = {
    subject: filterValue(filters.subject),
    language: filterValue(filters.language),
    availability: filterValue(filters.availability),
  };

  const result = await teacherDirectory(
    locale,
    malformed ? { subject: null, language: null, availability: null } : view,
  );
  const invalid = malformed || result.invalid;
  const { facets } = result;
  const topicNames = (
    await referenceNames(
      {
        personIds: [],
        topicIds: [
          ...facets.subjects.map((facet) => facet.value),
          ...(result.subject === null ? [] : [result.subject.id]),
        ],
      },
      locale,
    )
  ).topics;
  const base = teacherDirectoryHref(locale);
  const href = (change: Partial<TeacherDirectoryView>) =>
    teacherDirectoryHref(locale, { ...view, ...change });
  const teachers = invalid ? [] : result.teachers;

  const subjectOptions = facets.subjects.flatMap((facet) => {
    const topic = topicNames.get(facet.value);
    return topic === undefined
      ? []
      : [{ value: topic.slug, name: topic.name, teachers: facet.teachers }];
  });
  if (
    result.subject !== null &&
    !subjectOptions.some((entry) => entry.value === result.subject?.slug)
  ) {
    const topic = topicNames.get(result.subject.id);
    if (topic !== undefined)
      subjectOptions.push({ value: topic.slug, name: topic.name, teachers: 0 });
  }
  const languageOptions = facets.languages.map((facet) => ({
    value: facet.value,
    name: languages.get(facet.value)?.name ?? facet.value,
    teachers: facet.teachers,
  }));
  if (
    view.language !== null &&
    !invalid &&
    !languageOptions.some((entry) => entry.value === view.language)
  )
    languageOptions.push({
      value: view.language,
      name: languages.get(view.language)?.name ?? view.language,
      teachers: 0,
    });
  const showSubject = subjectOptions.length > 1 || view.subject !== null;
  const showLanguage = languageOptions.length > 1 || view.language !== null;
  // Open times are offered whenever any teacher is listed: it is the one way to
  // find a teacher who can be asked for a trial now.
  const showAvailability = facets.available > 0 || view.availability !== null;
  const option = (entry: { name: string; teachers: number }) =>
    t('filter.option', { name: entry.name, count: entry.teachers });

  const active = [
    ...(view.subject === null
      ? []
      : [
          {
            key: 'subject',
            text:
              subjectOptions.find((entry) => entry.value === view.subject)?.name ??
              view.subject,
            removeHref: href({ subject: null }),
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
    ...(view.availability === null
      ? []
      : [
          {
            key: 'availability',
            text: t('filter.available'),
            removeHref: href({ availability: null }),
          },
        ]),
  ].map((entry) => ({ ...entry, removeLabel: t('filter.remove', { name: entry.text }) }));

  const stats =
    result.mode === null || facets.listed === 0
      ? []
      : [
          { value: facets.listed, label: t('statTeachers', { count: facets.listed }) },
          { value: facets.courses, label: t('statCourses', { count: facets.courses }) },
          ...(facets.available === 0
            ? []
            : [
                {
                  value: facets.available,
                  label: t('statAvailable', { count: facets.available }),
                  href: href({
                    subject: null,
                    language: null,
                    availability: 'available',
                  }),
                },
              ]),
        ];

  return (
    <Container>
      <div className="flex flex-col gap-[var(--space-section)] pt-6 pb-[var(--space-section)]">
        <div className="flex flex-col gap-6">
          <LiveFixtureNotice mode={result.mode} text={t('fixture')} />
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
              { href: liveSchedulePath(locale), text: t('schedule') },
              { href: learnPath(locale, 'trial'), text: t('trialLink') },
            ]}
          />
        </div>

        {result.mode === null && !invalid ? (
          <div className="flex flex-col gap-3">
            <Alert tone="info">{t('unavailable.body')}</Alert>
            <p>
              <TextLink href={localizedPath(locale, '/learn/courses')}>
                {t('unavailable.browse')}
              </TextLink>
            </p>
          </div>
        ) : (
          <section className="flex flex-col gap-5" aria-labelledby="teachers-list">
            <SectionHeader
              id="teachers-list"
              heading={t('listHeading')}
              intro={t('listIntro')}
            />
            {showSubject || showLanguage || showAvailability ? (
              <ExploreFilters
                action={base}
                label={t('filter.label')}
                hidden={[]}
                submit={learn('filter.apply')}
                reset={filtered ? { href: base, text: learn('filter.clear') } : null}
              >
                {showSubject ? (
                  <Field id="teachers-filter-subject" label={t('filter.subject')}>
                    {(props) => (
                      <Select {...props} name="subject" defaultValue={view.subject ?? ''}>
                        <option value="">{learn('filter.any')}</option>
                        {subjectOptions.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {option(entry)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {showLanguage ? (
                  <Field id="teachers-filter-language" label={t('filter.language')}>
                    {(props) => (
                      <Select
                        {...props}
                        name="language"
                        defaultValue={view.language ?? ''}
                      >
                        <option value="">{learn('filter.any')}</option>
                        {languageOptions.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {option(entry)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {showAvailability ? (
                  <Field
                    id="teachers-filter-availability"
                    label={t('filter.availability')}
                  >
                    {(props) => (
                      <Select
                        {...props}
                        name="availability"
                        defaultValue={view.availability ?? ''}
                      >
                        <option value="">{learn('filter.any')}</option>
                        <option value="available">
                          {option({
                            name: t('filter.available'),
                            teachers: facets.available,
                          })}
                        </option>
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
            ) : teachers.length === 0 ? (
              <EmptyState>
                {filtered ? (
                  <span className="flex flex-col gap-2">
                    <span>{t('filter.empty')}</span>
                    <TextLink href={base}>{learn('filter.clear')}</TextLink>
                  </span>
                ) : (
                  t('empty')
                )}
              </EmptyState>
            ) : (
              <ul
                aria-label={t('title')}
                className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-3"
              >
                {teachers.map((teacher) => {
                  const { profile } = teacher;
                  return (
                    <li
                      key={profile.slug}
                      className="flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:p-5"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="w-16 shrink-0">
                          {profile.portrait === null ? (
                            <span
                              aria-hidden="true"
                              className="flex size-16 items-center justify-center rounded-full border border-accent-rule bg-accent-surface text-accent"
                            >
                              <Icon name="user" size={24} />
                            </span>
                          ) : (
                            <Portrait
                              shape="round"
                              path={portraitPath(
                                profile.personId,
                                profile.portrait.assetId,
                              )}
                              width={profile.portrait.width}
                              height={profile.portrait.height}
                              sizes="4rem"
                              alt=""
                            />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <h2 className="text-subheading font-semibold wrap-anywhere">
                            <TeacherName
                              profile={profile}
                              locale={locale}
                              fallback={t('teacherUnnamed')}
                            />
                          </h2>
                          {teacher.available ? (
                            <p>
                              <StatusBadge tone="positive">{t('available')}</StatusBadge>
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {profile.subjects === null ? null : (
                        <p className="text-sm wrap-anywhere" dir="auto">
                          <span className="text-foreground-muted">{t('subjects')} </span>
                          {profile.subjects}
                        </p>
                      )}
                      {profile.languages.length === 0 ? null : (
                        <div className="flex flex-col gap-1.5 text-sm">
                          <span className="text-foreground-muted">{t('languages')}</span>
                          <ul className="flex list-none flex-wrap gap-2 p-0">
                            {profile.languages.map((code) => {
                              const entry = languages.get(code);
                              return (
                                <li key={code}>
                                  <Badge>
                                    <span lang={code} dir={entry?.direction ?? 'auto'}>
                                      {entry?.name ?? code}
                                    </span>
                                  </Badge>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
                        <span className="text-foreground-muted">
                          {t('coursesCount', { count: teacher.courses.length })}
                        </span>
                        <ul className="flex list-none flex-col gap-2 p-0">
                          {teacher.courses.map((course) => {
                            const label = outlineLabel(
                              course.labels,
                              locale,
                              course.primaryLocale,
                            );
                            return (
                              <li
                                key={course.id}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1"
                              >
                                <span
                                  className="min-w-0 font-medium wrap-anywhere"
                                  lang={label.locale}
                                  dir={directionOf(label.locale)}
                                >
                                  <TextLink href={courseHref(locale, course.slug)}>
                                    {label.title}
                                  </TextLink>
                                </span>
                                {course.level === null ? null : (
                                  <span className="inline-flex items-center gap-1.5 text-caption text-foreground-muted">
                                    <LevelSteps level={course.level} />
                                    {learn(`level.${course.level}`)}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <section className="flex flex-col gap-5" aria-labelledby="teachers-how">
          <SectionHeader id="teachers-how" heading={t('how.heading')} />
          <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
            {(['profile', 'course', 'trial'] as const).map((key) => (
              <li
                key={key}
                className="flex min-w-0 gap-3 rounded-panel border border-border bg-surface-raised p-5"
              >
                <Icon name="check" size={20} className="mt-0.5 shrink-0 text-accent" />
                <p className="min-w-0 text-sm">{t(`how.${key}`)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Container>
  );
}
