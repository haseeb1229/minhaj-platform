import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { COURSE_LEVELS } from '@minhaj/contracts/learning';

import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { referenceNames } from '@/composition/public-references';
import { CoverImage, CoverTile, editionCoverPath } from '@/components/library/cover';
import { labelFor, readLibraryQuery, workPath } from '@/components/library/presentation';
import { VideoPreview } from '@/components/media/watch';
import { CourseShelf } from '@/components/topic-hub/courses';
import { directionOf } from '@/config/locale';
import {
  ActionLink,
  Breadcrumbs,
  CardGrid,
  Container,
  EmptyState,
  Icon,
  LinkCard,
  PageHero,
  SectionHeader,
  Stat,
  TopicChips,
  type IconName,
} from '@/components/ui';
import { learnTrail, LevelSteps, PathGrid } from './parts';
import { courseBrowseHref, learnPath } from './presentation';

/**
 * The Learn landing (ROUTE_MAP.md §3.5; INFORMATION_ARCHITECTURE.md §3.4).
 *
 * THE FRONT DOOR OF LEARN (Learn Part 1). The hero says what Learn is, states
 * the catalogue's figures — Courses, taught live and self-paced, lessons,
 * teachers, content languages — each the catalogue's own count (Learning's
 * `topicCourseFacets` over the whole catalogue), and opens the two
 * catalogues. Then: the newest Courses; how learning works (self-paced, taught
 * live, trial classes and your own progress in My Minhaj — what each is, and
 * that only enrolling, progress and a trial request need an account); the
 * catalogue by level and by Topic, each with its count; the newest learning
 * paths; the teachers the catalogue names, each with their Courses; and every
 * part of Learn, as the menu has it. Each rail is omitted when its owner
 * returns nothing.
 *
 * ONLY WHAT IS DELIVERED IS OFFERED. All Courses, Learning Paths, Trial
 * Classes, Live Learning and Find a Teacher are linked because they exist
 * (Live Learning and Find a Teacher since Phase 23); Training and Resources
 * are later work and appear nowhere — not greyed out, not "coming soon"
 * (ROUTE_MAP.md §5.2).
 *
 * NO FAKE CATALOGUE. Nothing here is rated or "featured": the Courses are the
 * most recently published, the figures and counts are what the catalogue
 * holds, and when nothing is published the landing says so in words.
 *
 * WHILE NO COURSE IS PUBLISHED (Phase 30-R), the landing still offers real
 * material to learn from: the Library's published books and Watch's published
 * lectures, each under its own owner's name and linking to its own page —
 * never presented as a Course, a syllabus or an enrolment.
 */

/** How many Courses, paths, Topics and teachers the landing shows before linking on. */
const LANDING_COURSES = 6;
const LANDING_PATHS = 3;
const LANDING_TOPICS = 12;
const LANDING_TEACHERS = 6;

/** How learning works, in the order a newcomer meets it. */
const HOW = [
  { key: 'selfPaced', icon: 'book' },
  { key: 'live', icon: 'calendar' },
  { key: 'trial', icon: 'message' },
  { key: 'progress', icon: 'check' },
] as const satisfies readonly { key: string; icon: IconName }[];

/** Every part of Learn, as its menu names them (`@/shell/menus`). */
const PARTS = ['courses', 'paths', 'topics', 'live', 'trial', 'teachers'] as const;

export async function LearnLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const reads = learningReadRuntime();
  const [newest, facets, paths] = await Promise.all([
    reads.topicCourses({
      scope: 'catalogue',
      sort: 'newest',
      titleLocale: locale,
      limit: LANDING_COURSES,
    }),
    reads.topicCourseFacets({ scope: 'catalogue' }),
    reads.pathSummaries(0),
  ]);
  const hub = facets.hub;
  const nothing = hub.courses === 0 && paths.items.length === 0;
  const teacherFacets = facets.teachers.items.slice(0, LANDING_TEACHERS);
  const names = await referenceNames(
    {
      personIds: teacherFacets.map((facet) => facet.id),
      topicIds: facets.topics.items.map((facet) => facet.id),
    },
    locale,
  );
  const topics = facets.topics.items
    .flatMap((facet) => {
      const topic = names.topics.get(facet.id);
      return topic === undefined ? [] : [{ ...topic, courses: facet.courses }];
    })
    .slice(0, LANDING_TOPICS);
  const teachers = teacherFacets.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined ? [] : [{ ...person, courses: facet.courses }];
  });
  const levels = COURSE_LEVELS.filter((level) => facets.levels[level] > 0);
  const howHref = {
    selfPaced: courseBrowseHref(locale, { format: 'self-paced' }),
    live: courseBrowseHref(locale, { format: 'live' }),
    trial: learnPath(locale, 'trial'),
    progress: localizedPath(locale, '/my/learning'),
  } as const;
  const partHref = (part: (typeof PARTS)[number]) =>
    part === 'topics' ? localizedPath(locale, '/topics') : learnPath(locale, part);
  const figures = [
    ...(hub.courses === 0
      ? []
      : [
          {
            value: hub.courses,
            label: t('landing.statCourses', { count: hub.courses }),
            href: courseBrowseHref(locale),
          },
        ]),
    ...(hub.live === 0
      ? []
      : [
          {
            value: hub.live,
            label: t('landing.statLive', { count: hub.live }),
            href: courseBrowseHref(locale, { format: 'live' }),
          },
        ]),
    ...(hub.selfPaced === 0
      ? []
      : [
          {
            value: hub.selfPaced,
            label: t('landing.statSelfPaced', { count: hub.selfPaced }),
            href: courseBrowseHref(locale, { format: 'self-paced' }),
          },
        ]),
    ...(hub.lessons === 0
      ? []
      : [
          { value: hub.lessons, label: t('landing.statLessons', { count: hub.lessons }) },
        ]),
    ...(hub.teachers === 0
      ? []
      : [
          {
            value: hub.teachers,
            label: t('landing.statTeachers', { count: hub.teachers }),
          },
        ]),
    ...(hub.languages < 2
      ? []
      : [
          {
            value: hub.languages,
            label: t('landing.statLanguages', { count: hub.languages }),
          },
        ]),
  ];

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        </div>
      </Container>

      <PageHero
        eyebrow={t('landing.eyebrow')}
        title={t('title')}
        lede={t('intro')}
        actions={
          <>
            <ActionLink href={courseBrowseHref(locale)}>
              {t('landing.browseCourses')}
            </ActionLink>
            <ActionLink href={learnPath(locale, 'paths')} tone="secondary">
              {t('sections.paths')}
            </ActionLink>
          </>
        }
      >
        {figures.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {figures.map((figure) => (
              <Stat
                key={figure.label}
                value={figure.value}
                label={figure.label}
                {...('href' in figure ? { href: figure.href } : {})}
              />
            ))}
          </div>
        )}
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t('signedOut')}
        </p>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {nothing ? <EmptyState>{t('landing.empty')}</EmptyState> : null}

          {nothing ? <LearnFromTheLibrary locale={locale} /> : null}
          {nothing ? (
            <VideoPreview
              locale={locale}
              filter={{}}
              heading={t('landing.fromWatch')}
              headingId="learn-watch"
              more={{
                href: localizedPath(locale, '/watch/videos'),
                text: t('landing.allVideos'),
              }}
            />
          ) : null}

          {newest.items.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="learn-courses">
              <SectionHeader
                id="learn-courses"
                heading={t('landing.courses')}
                intro={t('landing.coursesIntro')}
                action={{
                  href: courseBrowseHref(locale, { sort: 'newest' }),
                  text: t('landing.allCourses'),
                }}
              />
              <CourseShelf
                locale={locale}
                courses={newest.items}
                label={t('landing.courses')}
              />
            </section>
          )}

          <section className="flex flex-col gap-5" aria-labelledby="learn-how">
            <SectionHeader
              id="learn-how"
              heading={t('landing.how')}
              intro={t('landing.howIntro')}
            />
            <ol className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-4">
              {HOW.map((step, index) => (
                <li
                  key={step.key}
                  className="card-surface relative flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 hover:border-accent"
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
                    <a
                      href={howHref[step.key]}
                      className="card-link text-foreground no-underline"
                    >
                      {t(`landing.howSteps.${step.key}.title`)}
                    </a>
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {t(`landing.howSteps.${step.key}.body`)}
                  </p>
                  <p className="mt-auto text-caption font-medium text-foreground">
                    {t(`landing.howSteps.${step.key}.account`)}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {levels.length === 0 && topics.length === 0 ? null : (
            <section className="flex flex-col gap-6" aria-labelledby="learn-browse">
              <SectionHeader
                id="learn-browse"
                heading={t('landing.find')}
                intro={t('landing.browseIntro')}
              />
              {levels.length === 0 ? null : (
                <ul
                  aria-label={t('landing.byLevel')}
                  className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3"
                >
                  {levels.map((level) => (
                    <li
                      key={level}
                      className="card-surface relative flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-surface-raised p-5 hover:border-accent"
                    >
                      <div className="flex items-center gap-3">
                        <LevelSteps level={level} />
                        <h3 className="text-subheading font-semibold">
                          <a
                            href={courseBrowseHref(locale, { level })}
                            className="card-link text-foreground no-underline"
                          >
                            {t(`level.${level}`)}
                          </a>
                        </h3>
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {t(`landing.levelHelp.${level}`)}
                      </p>
                      <p className="text-caption font-medium">
                        {t('card.courses', { count: facets.levels[level] })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {topics.length === 0 ? null : (
                <div className="flex flex-col gap-3">
                  <h3 className="text-subheading font-semibold">
                    {t('landing.byTopic')}
                  </h3>
                  <TopicChips
                    label={t('landing.byTopic')}
                    topics={topics.map((topic) => ({
                      href: courseBrowseHref(locale, { topic: topic.slug }),
                      text: t('landing.topicCount', {
                        name: topic.name,
                        count: topic.courses,
                      }),
                    }))}
                  />
                </div>
              )}
            </section>
          )}

          {paths.items.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="learn-paths">
              <SectionHeader
                id="learn-paths"
                heading={t('landing.paths')}
                intro={t('sectionBody.paths')}
                action={{ href: learnPath(locale, 'paths'), text: t('landing.allPaths') }}
              />
              <PathGrid
                locale={locale}
                paths={paths.items.slice(0, LANDING_PATHS)}
                label={t('landing.paths')}
                headingLevel="h3"
              />
            </section>
          )}

          {teachers.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="learn-teachers">
              <SectionHeader
                id="learn-teachers"
                heading={t('landing.teachers')}
                intro={t('landing.teachersIntro')}
                action={{
                  href: learnPath(locale, 'teachers'),
                  text: t('sections.teachers'),
                }}
              />
              <CardGrid label={t('landing.teachers')}>
                {teachers.map((person) => (
                  <LinkCard
                    key={person.slug}
                    href={courseBrowseHref(locale, { teacher: person.slug })}
                    title={person.name}
                    description={t('landing.teacherCourses', { count: person.courses })}
                    headingLevel="h3"
                  />
                ))}
              </CardGrid>
            </section>
          )}

          <section className="flex flex-col gap-5" aria-labelledby="learn-parts">
            <SectionHeader
              id="learn-parts"
              heading={t('landing.parts')}
              intro={t('landing.partsIntro')}
            />
            <CardGrid columns={3}>
              {PARTS.map((part) => (
                <LinkCard
                  key={part}
                  href={partHref(part)}
                  title={t(`sections.${part}`)}
                  description={t(`sectionBody.${part}`)}
                  headingLevel="h3"
                />
              ))}
            </CardGrid>
          </section>
        </div>
      </Container>
    </>
  );
}

/** How many published books the Course-less landing shows. */
const LANDING_BOOKS = 6;

/**
 * Published books to read while no Course is published — the Library's own
 * first page, books with a cover first, as shelf tiles. Nothing when the
 * Library has published nothing.
 */
async function LearnFromTheLibrary({ locale }: { readonly locale: Locale }) {
  const works = await libraryReadRuntime().works(readLibraryQuery({}));
  const books = [
    ...works.items.filter((work) => work.cover !== null),
    ...works.items.filter((work) => work.cover === null),
  ].slice(0, LANDING_BOOKS);
  if (books.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'learn' });
  return (
    <section className="flex flex-col gap-5" aria-labelledby="learn-library">
      <SectionHeader
        id="learn-library"
        heading={t('landing.fromLibrary')}
        intro={t('landing.fromLibraryIntro')}
        action={{
          href: localizedPath(locale, '/library/books'),
          text: t('landing.allBooks'),
        }}
      />
      <ul
        aria-label={t('landing.fromLibrary')}
        className="grid list-none grid-cols-2 gap-x-4 gap-y-6 p-0 min-[30rem]:grid-cols-3 lg:grid-cols-6"
      >
        {books.map((work) => {
          const label = labelFor(work, locale);
          return (
            <CoverTile
              key={work.id}
              href={workPath(locale, work.slug)}
              title={label.title}
              lang={label.locale}
              dir={directionOf(label.locale)}
              cover={
                work.cover === null ? null : (
                  <CoverImage
                    path={editionCoverPath(work.cover.editionId, work.cover.assetId)}
                    cover={work.cover}
                    alt=""
                    className="max-h-full"
                  />
                )
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
