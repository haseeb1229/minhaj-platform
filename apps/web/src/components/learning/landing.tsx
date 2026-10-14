import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { LEARNING_PAGE } from '@minhaj/contracts/learning';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { learningReadRuntime } from '@/composition/learning-read';
import { Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { CourseGrid, learnTrail, PathGrid } from './parts';
import { courseBrowseHref, learnPageLinks, learnPath, offsetHref } from './presentation';

/**
 * The Learn landing, the trial-class explanation and the topic hub's Course
 * section (ROUTE_MAP.md §3.5; INFORMATION_ARCHITECTURE.md §3.4).
 *
 * ONLY WHAT IS DELIVERED IS OFFERED. All Courses, Learning Paths and Trial
 * Classes are linked because they exist; Live Learning, Training, Resources,
 * Teachers, Find a Teacher and the Class Schedule are Phase 23's or later and
 * appear nowhere — not greyed out, not "coming soon" (ROUTE_MAP.md §5.2).
 *
 * NO FAKE CATALOGUE. Nothing here is counted, rated or featured: the landing
 * shows the most recently published Courses and paths the reader returns, and
 * when nothing is published it says so in words.
 */

/** How many Courses and paths the landing shows before linking to the full lists. */
const LANDING_COURSES = 6;
const LANDING_PATHS = 3;

/** The delivered Learn surfaces, in the order the landing lists them. */
const SURFACES = ['courses', 'paths', 'trial'] as const;

export async function LearnLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const reads = learningReadRuntime();
  const [courses, paths] = await Promise.all([reads.courses({}), reads.paths(0)]);
  const nothing = courses.items.length === 0 && paths.items.length === 0;

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('intro')}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('signedOut')}
          </p>
        </Prose>

        <section className="flex flex-col gap-4" aria-labelledby="learn-browse">
          <SectionHeading>
            <span id="learn-browse">{t('landing.browse')}</span>
          </SectionHeading>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SURFACES.map((surface) => (
              <Panel key={surface} as="li">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">
                    <TextLink href={learnPath(locale, surface)}>
                      {t(`sections.${surface}`)}
                    </TextLink>
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t(`sectionBody.${surface}`)}
                  </p>
                </div>
              </Panel>
            ))}
            <Panel as="li">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">
                  <TextLink href={`/${locale}/topics`}>{t('sections.topics')}</TextLink>
                </h3>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('sectionBody.topics')}
                </p>
              </div>
            </Panel>
          </ul>
        </section>

        {nothing ? (
          <EmptyState>{t('landing.empty')}</EmptyState>
        ) : (
          <>
            {courses.items.length === 0 ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="learn-courses">
                <SectionHeading>
                  <span id="learn-courses">{t('landing.courses')}</span>
                </SectionHeading>
                <CourseGrid
                  locale={locale}
                  courses={courses.items.slice(0, LANDING_COURSES)}
                  label={t('landing.courses')}
                  headingLevel="h3"
                />
                <p>
                  <TextLink href={courseBrowseHref(locale)}>
                    {t('landing.allCourses')}
                  </TextLink>
                </p>
              </section>
            )}
            {paths.items.length === 0 ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="learn-paths">
                <SectionHeading>
                  <span id="learn-paths">{t('landing.paths')}</span>
                </SectionHeading>
                <PathGrid
                  locale={locale}
                  paths={paths.items.slice(0, LANDING_PATHS)}
                  label={t('landing.paths')}
                  headingLevel="h3"
                />
                <p>
                  <TextLink href={learnPath(locale, 'paths')}>
                    {t('landing.allPaths')}
                  </TextLink>
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </Container>
  );
}

/**
 * `/learn/trial` — what a trial-class request is, and the Courses that take one.
 *
 * A REQUEST, NEVER A BOOKING. A signed-in person may ask for a trial class on a
 * Course taught live; the request is recorded and nothing else happens — no
 * teacher is reserved, no time is named, no class is created. Confirming a
 * class is not offered yet (Phase 23), and the page says exactly that rather
 * than implying a booking. The request itself is made from the Course's own
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
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.learn, { text: title }]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('trial.intro')}</p>
          <Alert tone="info">{t('trial.notBooked')}</Alert>
        </Prose>

        <section className="flex flex-col gap-3" aria-labelledby="trial-how">
          <SectionHeading>
            <span id="trial-how">{t('trial.how')}</span>
          </SectionHeading>
          <Prose>
            <ol className="flex list-decimal flex-col gap-2 ps-6">
              <li>{t('trial.stepChoose')}</li>
              <li>{t('trial.stepSignIn')}</li>
              <li>{t('trial.stepRequest')}</li>
              <li>{t('trial.stepAfter')}</li>
            </ol>
          </Prose>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="trial-courses">
          <SectionHeading>
            <span id="trial-courses">{t('trial.courses')}</span>
          </SectionHeading>
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
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <CourseGrid
        locale={locale}
        courses={page.items.slice(0, TOPIC_PREVIEW)}
        label={heading}
        headingLevel="h3"
      />
      <p>
        <TextLink href={courseBrowseHref(locale, { topic: topic.slug })}>{more}</TextLink>
      </p>
    </section>
  );
}
