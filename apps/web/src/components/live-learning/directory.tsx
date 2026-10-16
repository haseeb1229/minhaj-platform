import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { teacherDirectory } from '@/composition/learning-teachers';
import { contentLanguages } from '@/composition/public-references';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { learnTrail } from '@/components/learning/parts';
import {
  courseHref,
  filterValue,
  outlineLabel,
} from '@/components/learning/presentation';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Prose,
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
  readTeacherDirectoryQuery,
  teacherDirectoryHref,
} from './presentation';

/**
 * `/learn/teachers` — Find a Teacher, `?subject, language, availability`
 * (ROUTE_MAP.md §3.5; DELIVERY_PLAN.md Phase 23).
 *
 * A LISTED TEACHER IS CURRENT ON EVERY AXIS AT ONCE — Learning's current scope
 * on a published live Course, Identity's live `teaching.perform`, People's
 * published TeacherProfile — and Layer 4 intersects the three
 * (`teacherDirectory`). This page renders that answer and adds nothing: no
 * rating, no price, no window, no schedule, no account.
 *
 * EVERY FILTER IS VALIDATED, AND NONE CAN BROADEN. The subject is an ACTIVE
 * Topic slug Taxonomy resolves; the language a content-language code Taxonomy
 * knows; availability the one word Learning admits. A value that is malformed
 * or names nothing lists NOTHING and says why.
 *
 * A REAL GET FORM: every filter works without JavaScript and every view is a
 * shareable address canonical to this listing.
 */

type Query = Record<string, string | string[] | undefined>;

export async function TeacherDirectoryPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'learnTeachers' });
  const learn = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const filters = readTeacherDirectoryQuery(query);
  const malformed = isInvalidTeacherDirectory(filters);
  const filtered = isFilteredTeacherDirectory(filters);
  const subject = filterValue(filters.subject);
  const language = filterValue(filters.language);
  const availability = filterValue(filters.availability);

  const [result, languages, topics] = await Promise.all([
    malformed
      ? { mode: null, teachers: [], invalid: true }
      : teacherDirectory(locale, { subject, language, availability }),
    contentLanguages(),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
  ]);
  const invalid = malformed || result.invalid;
  const base = teacherDirectoryHref(locale);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <LiveFixtureNotice mode={result.mode} text={t('fixture')} />
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.learn, { text: t('title') }]}
        />
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('intro')}</p>
        </Prose>

        <Panel>
          <form
            method="get"
            action={base}
            className="flex flex-col gap-4"
            aria-label={t('filter.label')}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field id="teachers-filter-subject" label={t('filter.subject')}>
                {(props) => (
                  <Select {...props} name="subject" defaultValue={subject ?? ''}>
                    <option value="">{learn('filter.any')}</option>
                    {topics.map((entry) => (
                      <option key={entry.id} value={entry.slug}>
                        {entry.label.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="teachers-filter-language" label={t('filter.language')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={language ?? ''}>
                    <option value="">{learn('filter.any')}</option>
                    {[...languages.values()].map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="teachers-filter-availability" label={t('filter.availability')}>
                {(props) => (
                  <Select
                    {...props}
                    name="availability"
                    defaultValue={availability ?? ''}
                  >
                    <option value="">{learn('filter.any')}</option>
                    <option value="available">{t('filter.available')}</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button tone="secondary">{learn('filter.apply')}</Button>
              {filtered ? <TextLink href={base}>{learn('filter.clear')}</TextLink> : null}
            </div>
          </form>
        </Panel>

        {result.mode === null && !invalid ? (
          <div className="flex flex-col gap-3">
            <Alert tone="info">{t('unavailable.body')}</Alert>
            <p>
              <TextLink href={`/${locale}/learn/courses`}>
                {t('unavailable.browse')}
              </TextLink>
            </p>
          </div>
        ) : invalid ? (
          <div className="flex flex-col gap-2">
            <Alert tone="info">{t('filter.invalid')}</Alert>
            <p>
              <TextLink href={base}>{learn('filter.clear')}</TextLink>
            </p>
          </div>
        ) : result.teachers.length === 0 ? (
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
          <ul aria-label={t('title')} className="grid gap-4 sm:grid-cols-2">
            {result.teachers.map((teacher) => (
              <Panel key={teacher.profile.slug} as="li">
                <div className="flex min-w-0 flex-col gap-3">
                  <h2 className="text-lg font-semibold">
                    <TeacherName
                      profile={teacher.profile}
                      locale={locale}
                      fallback={t('teacherUnnamed')}
                    />
                  </h2>
                  {teacher.available ? (
                    <p>
                      <StatusBadge tone="positive">{t('available')}</StatusBadge>
                    </p>
                  ) : null}
                  {teacher.profile.subjects === null ? null : (
                    <p className="text-sm wrap-anywhere" dir="auto">
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t('subjects')}{' '}
                      </span>
                      {teacher.profile.subjects}
                    </p>
                  )}
                  {teacher.profile.languages.length === 0 ? null : (
                    <p className="flex flex-wrap gap-x-2 text-sm">
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t('languages')}
                      </span>
                      {teacher.profile.languages.map((code) => {
                        const entry = languages.get(code);
                        return (
                          <span key={code} lang={code} dir={entry?.direction ?? 'auto'}>
                            {entry?.name ?? code}
                          </span>
                        );
                      })}
                    </p>
                  )}
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="text-[color:var(--color-foreground-muted)]">
                      {t('courses')}
                    </span>
                    <ul className="flex flex-col gap-1 ps-4">
                      {teacher.courses.map((course) => {
                        const label = outlineLabel(
                          course.labels,
                          locale,
                          course.primaryLocale,
                        );
                        return (
                          <li
                            key={course.id}
                            className="list-disc wrap-anywhere"
                            lang={label.locale}
                            dir={directionOf(label.locale)}
                          >
                            <TextLink href={courseHref(locale, course.slug)}>
                              {label.title}
                            </TextLink>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </Panel>
            ))}
          </ul>
        )}

        <p className="text-sm">
          <TextLink href={liveSchedulePath(locale)}>{t('schedule')}</TextLink>
        </p>
      </div>
    </Container>
  );
}
