import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  COURSE_FORMATS,
  COURSE_LEVELS,
  LEARNING_PAGE,
  type CoursePage,
} from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Select,
  TextLink,
} from '@/components/ui';
import { CourseGrid, learnTrail } from './parts';
import {
  courseBrowseHref,
  filterValue,
  isFilteredCourseBrowse,
  isInvalidCourseBrowse,
  learnPageLinks,
  readCourseBrowse,
} from './presentation';
import { readActiveTopic, readPublicPerson } from './read';

/**
 * `/learn/courses` — the public Course catalogue,
 * `?topic, level, language, format, teacher` (ROUTE_MAP.md §3.5).
 *
 * EVERY FILTER IS VALIDATED, AND NONE CAN BROADEN. The topic is a Topic slug
 * Taxonomy resolves (and only an ACTIVE Topic resolves); the teacher is a
 * People slug People resolves; level and format are Learning's own
 * vocabularies; the language is a content-language code. A value that is
 * malformed, or that names nothing, lists NOTHING and says why — it never falls
 * back to every Course. Filters combine: each one narrows the reader's public
 * predicate further, and the order is the reader's.
 *
 * A REAL GET FORM: every filter works without JavaScript, every view is a
 * shareable address canonical to `/learn/courses` and never a sitemap entry
 * (ROUTE_MAP.md §2.3), and changing a filter returns to the first page. The
 * options are bounded vocabularies — active topics, the People attributed as
 * teachers on published Courses, Taxonomy's content languages — never the
 * catalogue itself.
 */

type Query = Record<string, string | string[] | undefined>;

const EMPTY: CoursePage = { items: [], hasMore: false };

/** The slugs and codes in the address, resolved through their owners first. */
async function resolveBrowse(locale: Locale, query: Query) {
  const browse = readCourseBrowse(query);
  const topicSlug = filterValue(browse.topic);
  const teacherSlug = filterValue(browse.teacher);
  const [topic, teacher] = await Promise.all([
    topicSlug === null ? null : readActiveTopic(locale, topicSlug),
    teacherSlug === null ? null : readPublicPerson(locale, teacherSlug),
  ]);
  const unresolved =
    (topicSlug !== null && topic === null) || (teacherSlug !== null && teacher === null);
  return {
    browse,
    topic,
    teacher,
    invalid: isInvalidCourseBrowse(browse) || unresolved,
    filtered: isFilteredCourseBrowse(browse),
  };
}

export async function CourseCataloguePage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const { browse, topic, teacher, invalid, filtered } = await resolveBrowse(
    locale,
    query,
  );
  const level = filterValue(browse.level);
  const format = filterValue(browse.format);
  const language = filterValue(browse.language);
  const reads = learningReadRuntime();

  const [page, languages, topics, teachers] = await Promise.all([
    invalid
      ? EMPTY
      : reads.courses({
          offset: browse.offset,
          topic: topic?.id ?? null,
          level,
          language,
          format,
          teacher: teacher?.id ?? null,
        }),
    contentLanguages(),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    reads.teacherFacets(0),
  ]);
  const teacherNames = await referenceNames(
    { personIds: teachers.items.map((facet) => facet.id), topicIds: [] },
    locale,
  );
  const teacherOptions = new Map(
    [...teacherNames.people.values()].map((person) => [person.slug, person.name]),
  );
  // The chosen teacher stays chosen even when they are past the first facet page.
  if (teacher !== null && !teacherOptions.has(teacher.slug))
    teacherOptions.set(teacher.slug, teacher.label.name);

  const title = t('sections.courses');
  const base = courseBrowseHref(locale);
  const links = learnPageLinks(browse.offset, LEARNING_PAGE, page.hasMore);
  const view = (offset: number) =>
    courseBrowseHref(locale, {
      topic: topic?.slug ?? null,
      level,
      language,
      format,
      teacher: teacher?.slug ?? null,
      offset,
    });

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.learn, { text: title }]}
        />

        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('sectionBody.courses')}
          </p>
        </div>

        <Panel>
          <form
            method="get"
            action={base}
            className="flex flex-col gap-4"
            aria-label={t('filter.label')}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field id="learn-filter-topic" label={t('filter.topic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={topic?.slug ?? ''}>
                    <option value="">{t('filter.any')}</option>
                    {topics.map((entry) => (
                      <option key={entry.id} value={entry.slug}>
                        {entry.label.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="learn-filter-level" label={t('filter.level')}>
                {(props) => (
                  <Select {...props} name="level" defaultValue={level ?? ''}>
                    <option value="">{t('filter.any')}</option>
                    {COURSE_LEVELS.map((option) => (
                      <option key={option} value={option}>
                        {t(`level.${option}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="learn-filter-format" label={t('filter.format')}>
                {(props) => (
                  <Select {...props} name="format" defaultValue={format ?? ''}>
                    <option value="">{t('filter.any')}</option>
                    {COURSE_FORMATS.map((option) => (
                      <option key={option} value={option}>
                        {t(`format.${option}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="learn-filter-language" label={t('filter.language')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={language ?? ''}>
                    <option value="">{t('filter.any')}</option>
                    {[...languages.values()].map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="learn-filter-teacher" label={t('filter.teacher')}>
                {(props) => (
                  <Select {...props} name="teacher" defaultValue={teacher?.slug ?? ''}>
                    <option value="">{t('filter.any')}</option>
                    {[...teacherOptions.entries()].map(([slug, name]) => (
                      <option key={slug} value={slug}>
                        {name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button tone="secondary">{t('filter.apply')}</Button>
              {filtered ? <TextLink href={base}>{t('filter.clear')}</TextLink> : null}
            </div>
          </form>
        </Panel>

        {invalid ? (
          <div className="flex flex-col gap-2">
            <Alert tone="info">{t('filter.invalid')}</Alert>
            <p>
              <TextLink href={base}>{t('filter.clear')}</TextLink>
            </p>
          </div>
        ) : page.items.length === 0 ? (
          <EmptyState>
            {filtered ? (
              <span className="flex flex-col gap-2">
                <span>{t('filter.empty')}</span>
                <TextLink href={base}>{t('filter.clear')}</TextLink>
              </span>
            ) : (
              t('coursesEmpty')
            )}
          </EmptyState>
        ) : (
          <CourseGrid locale={locale} courses={page.items} label={title} />
        )}

        <Pagination
          label={title}
          previous={links.previous === null ? null : view(links.previous)}
          next={links.next === null ? null : view(links.next)}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
      </div>
    </Container>
  );
}
