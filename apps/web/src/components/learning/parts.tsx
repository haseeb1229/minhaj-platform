import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  CourseLevel,
  CourseListing,
  PathListing,
  PathSummary,
} from '@minhaj/contracts/learning';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { levelSteps } from '@/components/topic-hub/courses-view';
import { Badge, CardGrid, Icon, LinkCard, MetaRow } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { courseHref, learnPath, learningPathHref, outlineLabel } from './presentation';

/**
 * The presentation parts every public Learn surface shares — one card, one
 * trail and one way of naming a Course's kind, so a Course reads the same in
 * the catalogue, on a path, on a topic hub and on the home page.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Names are resolved through
 * `@/composition/public-references` — People's and Taxonomy's PUBLIC readers —
 * in one batch per page, never one call per card.
 *
 * EVERY FACT SHOWN IS ONE THE RECORD HAS. No rating, no price, no learner
 * count, no certificate and no invented teacher: a level that was not stated
 * is absent, and a teacher this platform cannot name is not printed.
 *
 * ONE ANCHOR PER CARD. Each card is the shared `LinkCard`: the title is the
 * only link, stretched over the card, so the whole card is a target while the
 * accessibility tree holds one link named by the Course's own title.
 */

export type LearnTranslator = Awaited<ReturnType<typeof getTranslations<'learn'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

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

/** Home / Learn / … — the trail every Learn page starts with. */
export async function learnTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'learn' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    learn: { href: learnPath(locale), text: t('title') },
  };
}

/**
 * A Course's format and level, as WORDS — the meaning is in the text, never in
 * a colour. An unstated level is absent, not "all levels".
 */
export function courseKind(
  course: Pick<CourseListing, 'format' | 'level'>,
  t: LearnTranslator,
): string {
  return [
    t(`format.${course.format}`),
    ...(course.level === null ? [] : [t(`level.${course.level}`)]),
  ].join(' · ');
}

function CourseCard({
  locale,
  course,
  people,
  languages,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly course: CourseListing;
  readonly people: NameMap;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: LearnTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const label = outlineLabel(course.labels, locale, course.primaryLocale);
  const language = languages.get(course.languageCode);
  const teachers = course.teacherIds.flatMap((id) => {
    const person = people.get(id);
    return person === undefined ? [] : [person.name];
  });
  const kind = courseKind(course, t);

  return (
    <LinkCard
      href={courseHref(locale, course.slug)}
      eyebrow={kind}
      title={label.title}
      description={label.summary}
      headingLevel={headingLevel}
      lang={label.locale}
      dir={directionOf(label.locale)}
      meta={
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
            teachers.length === 0 ? null : (
              <span key="teachers" dir="auto">
                {t('card.teachers')}: {teachers.join(' · ')}
              </span>
            ),
          ]}
        />
      }
    />
  );
}

/**
 * A page of Course cards with every teacher on it resolved in ONE People call
 * and the content languages in ONE Taxonomy call — never a call per card.
 */
export async function CourseGrid({
  locale,
  courses,
  label,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly courses: readonly CourseListing[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const [references, languages] = await Promise.all([
    referenceNames(
      { personIds: courses.flatMap((course) => course.teacherIds), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
  return (
    <CardGrid label={label}>
      {courses.map((course) => (
        <CourseCard
          key={course.id}
          locale={locale}
          course={course}
          people={references.people}
          languages={languages}
          t={t}
          headingLevel={headingLevel}
        />
      ))}
    </CardGrid>
  );
}

/**
 * A LearningPath's levels as WORDS: one stated level, or the first and the
 * last ("Beginner to Advanced"). Nothing when no Course on it states one.
 */
export function levelSpan(
  levels: readonly CourseLevel[],
  t: LearnTranslator,
): string | null {
  const first = levels[0];
  const last = levels.at(-1);
  if (first === undefined || last === undefined) return null;
  return first === last
    ? t(`level.${first}`)
    : t('paths.levelSpan', { from: t(`level.${first}`), to: t(`level.${last}`) });
}

/**
 * A page of LearningPath cards. Every card names the path and how many
 * published Courses it holds; a card built from a `PathSummary` (the paths
 * catalogue, the Learn landing) also states what those Courses hold together —
 * their lessons, the span of their levels and how they are studied. One link
 * per card, the title, stretched over it.
 */
export async function PathGrid({
  locale,
  paths,
  label,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly paths: readonly PathListing[] | readonly PathSummary[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const Heading = headingLevel;

  return (
    <ul
      aria-label={label}
      className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 xl:grid-cols-3"
    >
      {paths.map((entry: PathListing | PathSummary) => {
        const summary = 'path' in entry ? entry : null;
        const path = summary === null ? (entry as PathListing) : summary.path;
        const words = outlineLabel(path.labels, locale, path.primaryLocale);
        const content = { lang: words.locale, dir: directionOf(words.locale) };
        const span = summary === null ? null : levelSpan(summary.levels, t);
        const top = summary?.levels.at(-1);
        return (
          <li
            key={path.id}
            className="card-surface relative flex min-w-0 flex-col gap-4 rounded-panel border border-border bg-surface-raised p-4 hover:border-accent sm:p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
                <Icon name="list" size={16} />
                {t('path.type')}
              </span>
              <span className="text-caption font-medium text-foreground-muted">
                {t('card.courses', { count: path.courses })}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Heading
                className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
                {...content}
              >
                <a
                  href={learningPathHref(locale, path.slug)}
                  className="card-link text-foreground no-underline"
                >
                  {words.title}
                </a>
              </Heading>
              {words.summary === '' ? null : (
                <p
                  className="line-clamp-3 text-sm leading-relaxed wrap-anywhere text-foreground-muted"
                  {...content}
                >
                  {words.summary}
                </p>
              )}
            </div>
            {summary === null ? null : (
              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                {summary.formats.length === 0 ? null : (
                  <p className="flex flex-wrap gap-2">
                    {summary.formats.map((format) => (
                      <Badge key={format}>{t(`format.${format}`)}</Badge>
                    ))}
                  </p>
                )}
                <MetaRow
                  items={[
                    span === null || top === undefined ? null : (
                      <span key="levels" className="inline-flex items-center gap-2">
                        <LevelSteps level={top} />
                        {span}
                      </span>
                    ),
                    summary.lessons === 0
                      ? null
                      : t('card.lessons', { count: summary.lessons }),
                  ]}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
