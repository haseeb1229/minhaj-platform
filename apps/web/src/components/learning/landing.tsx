import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { LEARNING_PAGE } from '@minhaj/contracts/learning';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { learningReadRuntime } from '@/composition/learning-read';
import { MediaPageHeader, Pagination } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  CardGrid,
  Container,
  EmptyState,
  LinkCard,
  PageHero,
  Panel,
  SectionHeader,
} from '@/components/ui';
import { CourseGrid, learnTrail, PathGrid } from './parts';
import { courseBrowseHref, learnPageLinks, learnPath, offsetHref } from './presentation';

/**
 * The Learn landing, the trial-class explanation and the topic hub's Course
 * section (ROUTE_MAP.md §3.5; INFORMATION_ARCHITECTURE.md §3.4).
 *
 * ONLY WHAT IS DELIVERED IS OFFERED. All Courses, Learning Paths, Trial
 * Classes, Live Learning and Find a Teacher are linked because they exist
 * (Live Learning and Find a Teacher since Phase 23); Training and Resources
 * are later work and appear nowhere — not greyed out, not "coming soon"
 * (ROUTE_MAP.md §5.2).
 *
 * NO FAKE CATALOGUE. Nothing here is counted, rated or featured: the landing
 * shows the most recently published Courses and paths the reader returns, and
 * when nothing is published it says so in words.
 *
 * STRUCTURED AS THE WAYS TO LEARN. The hero names the two catalogues; then the
 * recent Courses, the recent paths, learning with a teacher (the live
 * schedule, trial classes, Find a Teacher) and, last, the topic browser. Each
 * rail is omitted when its owner returns nothing.
 */

/** How many Courses and paths the landing shows before linking to the full lists. */
const LANDING_COURSES = 6;
const LANDING_PATHS = 3;

/** The surfaces of learning with a teacher, beside the live schedule itself. */
const WITH_A_TEACHER = ['trial', 'teachers'] as const;

export async function LearnLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const reads = learningReadRuntime();
  const [courses, paths] = await Promise.all([reads.courses({}), reads.paths(0)]);
  const nothing = courses.items.length === 0 && paths.items.length === 0;

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        </div>
      </Container>

      <PageHero
        title={t('title')}
        lede={t('intro')}
        actions={
          <>
            <ActionLink href={courseBrowseHref(locale)}>
              {t('sections.courses')}
            </ActionLink>
            <ActionLink href={learnPath(locale, 'paths')} tone="secondary">
              {t('sections.paths')}
            </ActionLink>
          </>
        }
      >
        <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
          {t('signedOut')}
        </p>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {nothing ? <EmptyState>{t('landing.empty')}</EmptyState> : null}

          {courses.items.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="learn-courses">
              <SectionHeader
                id="learn-courses"
                heading={t('landing.courses')}
                action={{ href: courseBrowseHref(locale), text: t('landing.allCourses') }}
              />
              <CourseGrid
                locale={locale}
                courses={courses.items.slice(0, LANDING_COURSES)}
                label={t('landing.courses')}
                headingLevel="h3"
              />
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

          <section className="flex flex-col gap-5" aria-labelledby="learn-live">
            <SectionHeader
              id="learn-live"
              heading={t('sections.live')}
              intro={t('sectionBody.live')}
              action={{
                href: learnPath(locale, 'live'),
                text: t('landing.liveSchedule'),
              }}
            />
            <CardGrid columns={2}>
              {WITH_A_TEACHER.map((surface) => (
                <LinkCard
                  key={surface}
                  href={learnPath(locale, surface)}
                  title={t(`sections.${surface}`)}
                  description={t(`sectionBody.${surface}`)}
                />
              ))}
            </CardGrid>
          </section>

          <section aria-labelledby="learn-topics">
            <Panel as="div">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                <div className="flex flex-col gap-1.5">
                  <h2 id="learn-topics" className="text-heading font-semibold">
                    {t('sections.topics')}
                  </h2>
                  <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
                    {t('sectionBody.topics')}
                  </p>
                </div>
                <div className="shrink-0">
                  <ActionLink href={`/${locale}/topics`} tone="secondary">
                    {t('landing.allTopics')}
                  </ActionLink>
                </div>
              </div>
            </Panel>
          </section>
        </div>
      </Container>
    </>
  );
}

/** The four steps of a trial-class request, in order. */
const TRIAL_STEPS = ['stepChoose', 'stepSignIn', 'stepRequest', 'stepAfter'] as const;

/**
 * `/learn/trial` — what a trial-class request is, and the Courses that take one.
 *
 * A REQUEST, NEVER A BOOKING. A signed-in person may ask for a trial class on a
 * Course taught live; the request is recorded and nothing else happens — no
 * teacher is reserved, no time is named, no class is created. Confirming it
 * into a class is a separate act by staff (Phase 23), and the page says so
 * rather than implying a booking. The request itself is made from the Course's own
 * page, through its private island.
 */
export async function TrialPage({
  locale,
  offset,
}: {
  readonly locale: Locale;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const page = await learningReadRuntime().courses({ format: 'live', offset });
  const title = t('sections.trial');
  const path = learnPath(locale, 'trial');
  const links = learnPageLinks(offset, LEARNING_PAGE, page.hasMore);

  return (
    <Container>
      <div className="flex flex-col gap-[var(--space-section)] pt-6 pb-[var(--space-section)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.learn, { text: title }],
          }}
          eyebrow={t('title')}
          title={title}
          lede={t('trial.intro')}
        >
          <div className="pt-1">
            <Alert tone="info">{t('trial.notBooked')}</Alert>
          </div>
        </MediaPageHeader>

        <section className="flex flex-col gap-5" aria-labelledby="trial-how">
          <SectionHeader id="trial-how" heading={t('trial.how')} />
          <ol className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {TRIAL_STEPS.map((step, index) => (
              <li
                key={step}
                className="flex min-w-0 gap-3 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5"
              >
                <span
                  aria-hidden="true"
                  className="text-subheading font-semibold text-[color:var(--color-accent)]"
                >
                  {index + 1}
                </span>
                <p className="min-w-0 text-sm">{t(`trial.${step}`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="trial-courses">
          <SectionHeader id="trial-courses" heading={t('trial.courses')} />
          {page.items.length === 0 ? (
            <EmptyState>{t('trial.empty')}</EmptyState>
          ) : (
            <CourseGrid
              locale={locale}
              courses={page.items}
              label={t('trial.courses')}
              headingLevel="h3"
            />
          )}
          <Pagination
            label={t('trial.courses')}
            previous={links.previous === null ? null : offsetHref(path, links.previous)}
            next={links.next === null ? null : offsetHref(path, links.next)}
            previousLabel={t('previous')}
            nextLabel={t('next')}
          />
        </section>
      </div>
    </Container>
  );
}

/** How many Courses a topic hub previews. */
const TOPIC_PREVIEW = 6;

/**
 * The topic hub's Course section — one bounded page of Learning's own public
 * listing for the Topic. Renders NOTHING when no published Course is on it, so
 * the hub carries no empty frame (ROUTE_MAP.md §5.2).
 */
export async function CourseTopicSection({
  locale,
  topic,
  heading,
  headingId,
  more,
}: {
  readonly locale: Locale;
  readonly topic: TopicView;
  readonly heading: string;
  readonly headingId: string;
  /** The words of the link to the catalogue filtered by this Topic. */
  readonly more: string;
}) {
  const page = await learningReadRuntime().courses({ topic: topic.id });
  if (page.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        heading={heading}
        action={{ href: courseBrowseHref(locale, { topic: topic.slug }), text: more }}
      />
      <CourseGrid
        locale={locale}
        courses={page.items.slice(0, TOPIC_PREVIEW)}
        label={heading}
        headingLevel="h3"
      />
    </section>
  );
}
