import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { CourseListing, PathListing } from '@minhaj/contracts/learning';

import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { CardGrid, LinkCard, MetaRow } from '@/components/ui';
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
  const language = languages.get(course.languageCode);
  const teachers = course.teacherIds.flatMap((id) => {
    const person = people.get(id);
    return person === undefined ? [] : [person.name];
  });
  const kind = courseKind(course, t);

  return (
    <LinkCard
      href={courseHref(locale, course.slug)}
      eyebrow={step === null ? kind : `${t('card.step', { number: step })} · ${kind}`}
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
 * `ordered` is for a LearningPath, whose order is its meaning: an ordered list,
 * one Course to a row, each numbered.
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
  const cards = courses.map((course, index) => (
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
  ));

  return ordered ? (
    <ol
      aria-label={label}
      className="grid max-w-3xl list-none grid-cols-1 gap-4 p-0 *:min-w-0"
    >
      {cards}
    </ol>
  ) : (
    <CardGrid label={label}>{cards}</CardGrid>
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

  return (
    <CardGrid label={label}>
      {paths.map((path) => {
        const words = outlineLabel(path.labels, locale, path.primaryLocale);
        return (
          <LinkCard
            key={path.id}
            href={learningPathHref(locale, path.slug)}
            eyebrow={t('path.type')}
            title={words.title}
            description={words.summary}
            headingLevel={headingLevel}
            lang={words.locale}
            dir={directionOf(words.locale)}
            meta={<MetaRow items={[t('card.courses', { count: path.courses })]} />}
          />
        );
      })}
    </CardGrid>
  );
}
