import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { CourseListing, PathListing } from '@minhaj/contracts/learning';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { Panel, StatusBadge, TextLink } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { courseHref, learnPath, learningPathHref, outlineLabel } from './presentation';

/**
 * The presentation parts every public Learn surface shares — one card, one
 * trail and one set of badges, so a Course reads the same in the catalogue, on
 * a path, on a topic hub and on the Quran and Hadith related views.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Names are resolved through
 * `@/composition/public-references` — People's and Taxonomy's PUBLIC readers —
 * in one batch per page, never one call per card.
 *
 * EVERY FACT SHOWN IS ONE THE RECORD HAS. No rating, no price, no learner
 * count, no certificate and no invented teacher: a level that was not stated
 * is absent, and a teacher this platform cannot name is not printed.
 */

export type LearnTranslator = Awaited<ReturnType<typeof getTranslations<'learn'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** Home / Learn / … — the trail every Learn page starts with. */
export async function learnTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'learn' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
    learn: { href: learnPath(locale), text: t('title') },
  };
}

/**
 * A Course's format and level as TEXT badges — the meaning is in the words,
 * never in a colour. An unstated level is absent, not "all levels".
 */
export function CourseBadges({
  course,
  t,
}: {
  readonly course: Pick<CourseListing, 'format' | 'level'>;
  readonly t: LearnTranslator;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge tone="neutral">{t(`format.${course.format}`)}</StatusBadge>
      {course.level === null ? null : (
        <StatusBadge tone="neutral">{t(`level.${course.level}`)}</StatusBadge>
      )}
    </div>
  );
}

function CourseCard({
  locale,
  course,
  people,
  languages,
  t,
  headingLevel,
  step,
}: {
  readonly locale: Locale;
  readonly course: CourseListing;
  readonly people: NameMap;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: LearnTranslator;
  readonly headingLevel: 'h2' | 'h3';
  /** The Course's place on a LearningPath, counting from 1. */
  readonly step: number | null;
}) {
  const label = outlineLabel(course.labels, locale, course.primaryLocale);
  const direction = directionOf(label.locale);
  const language = languages.get(course.languageCode);
  const teachers = course.teacherIds.flatMap((id) => {
    const person = people.get(id);
    return person === undefined ? [] : [person.name];
  });
  const Heading = headingLevel;

  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        {step === null ? null : (
          <p className="text-sm font-medium text-[color:var(--color-foreground-muted)]">
            {t('card.step', { number: step })}
          </p>
        )}
        <CourseBadges course={course} t={t} />
        <Heading
          className="text-lg font-semibold wrap-anywhere"
          lang={label.locale}
          dir={direction}
        >
          <TextLink href={courseHref(locale, course.slug)}>{label.title}</TextLink>
        </Heading>
        {label.summary === '' ? null : (
          <p
            className="text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
            lang={label.locale}
            dir={direction}
          >
            {label.summary}
          </p>
        )}
        {teachers.length === 0 ? null : (
          <p className="text-sm wrap-anywhere" dir="auto">
            <span className="text-[color:var(--color-foreground-muted)]">
              {t('card.teachers')}:{' '}
            </span>
            {teachers.join(' · ')}
          </p>
        )}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[color:var(--color-foreground-muted)]">
          <span lang={course.languageCode} dir={language?.direction ?? 'auto'}>
            {language?.name ?? course.languageCode}
          </span>
          <span>{t('card.modules', { count: course.modules })}</span>
          <span>{t('card.lessons', { count: course.lessons })}</span>
        </p>
      </div>
    </Panel>
  );
}

/**
 * A page of Course cards with every teacher on it resolved in ONE People call
 * and the content languages in ONE Taxonomy call — never a call per card.
 * `ordered` is for a LearningPath, whose order is its meaning.
 */
export async function CourseGrid({
  locale,
  courses,
  label,
  headingLevel = 'h2',
  ordered = false,
}: {
  readonly locale: Locale;
  readonly courses: readonly CourseListing[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
  readonly ordered?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const [references, languages] = await Promise.all([
    referenceNames(
      { personIds: courses.flatMap((course) => course.teacherIds), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
  const List = ordered ? 'ol' : 'ul';

  return (
    <List aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course, index) => (
        <CourseCard
          key={course.id}
          locale={locale}
          course={course}
          people={references.people}
          languages={languages}
          t={t}
          headingLevel={headingLevel}
          step={ordered ? index + 1 : null}
        />
      ))}
    </List>
  );
}

/** A page of LearningPath cards: words and how many published Courses each holds. */
export async function PathGrid({
  locale,
  paths,
  label,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly paths: readonly PathListing[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const Heading = headingLevel;

  return (
    <ul aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {paths.map((path) => {
        const words = outlineLabel(path.labels, locale, path.primaryLocale);
        const direction = directionOf(words.locale);
        return (
          <Panel key={path.id} as="li">
            <div className="flex min-w-0 flex-col gap-3">
              <Heading
                className="text-lg font-semibold wrap-anywhere"
                lang={words.locale}
                dir={direction}
              >
                <TextLink href={learningPathHref(locale, path.slug)}>
                  {words.title}
                </TextLink>
              </Heading>
              {words.summary === '' ? null : (
                <p
                  className="text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
                  lang={words.locale}
                  dir={direction}
                >
                  {words.summary}
                </p>
              )}
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('card.courses', { count: path.courses })}
              </p>
            </div>
          </Panel>
        );
      })}
    </ul>
  );
}
