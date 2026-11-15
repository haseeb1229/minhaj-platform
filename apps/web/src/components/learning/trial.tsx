import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { learningReadRuntime } from '@/composition/learning-read';
import { CourseShelf } from '@/components/topic-hub/courses';
import { ExploreHero } from '@/components/topic-hub/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  Icon,
  SectionHeader,
  type IconName,
} from '@/components/ui';
import { learnTrail } from './parts';
import { courseBrowseHref, learnPath } from './presentation';

/**
 * `/learn/trial` — Trial Classes (ROUTE_MAP.md §3.5; Learn Part 2).
 *
 * WHAT A TRIAL IS, HOW TO ASK, AND WHAT HAPPENS NEXT — then the Courses that
 * take one. A trial class is a first class on a Course taught live. A
 * signed-in person asks for one from that Course's own page, through its
 * private island (the same `/api/my/learning/trials` handler, its origin and
 * intent checks and its rate limit — nothing here writes); this page reads no
 * session and is the same document for everybody.
 *
 * A REQUEST, NEVER A BOOKING. The request is recorded and nothing else happens
 * — no teacher is reserved, no time is named, no class is created. Confirming
 * it into a class is a separate act by staff (Phase 23); a confirmed class then
 * appears in the person's own My classes, which is the ONLY place its meeting
 * link is shown. The page says so rather than implying a booking.
 *
 * WHICH COURSES TAKE ONE: Learning's own answer — every published Course
 * taught live, the newest first (the shared catalogue read, `topicCourses`
 * with `scope: 'catalogue'` and `format: 'live'`), the figure its total, and
 * the rest in the catalogue filtered to Courses taught live — one address for
 * each view, so the page has no pager of its own.
 */

/** How many Courses taught live the page shows before the catalogue takes over. */
const TRIAL_COURSES = 6;

/** How a trial request works, in order. */
const STEPS = [
  { key: 'choose', icon: 'search' },
  { key: 'signIn', icon: 'user' },
  { key: 'request', icon: 'message' },
  { key: 'after', icon: 'calendar' },
] as const satisfies readonly { key: string; icon: IconName }[];

/** What happens after a request, in order. */
const NEXT = ['recorded', 'confirmed', 'join', 'withdraw'] as const;

export async function TrialPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const live = await learningReadRuntime().topicCourses({
    scope: 'catalogue',
    format: 'live',
    sort: 'newest',
    titleLocale: locale,
    limit: TRIAL_COURSES,
  });
  const title = t('sections.trial');
  const allLive = courseBrowseHref(locale, { format: 'live' });

  return (
    <Container>
      <div className="flex flex-col gap-[var(--space-section)] pt-6 pb-[var(--space-section)]">
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            label={trail.label}
            trail={[trail.home, trail.learn, { text: title }]}
          />
          <ExploreHero
            eyebrow={t('title')}
            title={title}
            lede={t('trial.intro')}
            stats={
              live.total === 0
                ? []
                : [
                    {
                      value: live.total,
                      label: t('trial.statCourses', { count: live.total }),
                      href: allLive,
                    },
                  ]
            }
            actions={[
              ...(live.total === 0
                ? []
                : [{ href: allLive, text: t('trial.browseLive') }]),
              { href: learnPath(locale, 'live'), text: t('trial.schedule') },
            ]}
          />
          <Alert tone="info">{t('trial.notBooked')}</Alert>
        </div>

        <section className="flex flex-col gap-5" aria-labelledby="trial-how">
          <SectionHeader id="trial-how" heading={t('trial.how')} />
          <ol className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step, index) => (
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
                  {t(`trial.steps.${step.key}.title`)}
                </h3>
                <p className="text-sm text-foreground-muted">
                  {t(`trial.steps.${step.key}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="trial-courses">
          <SectionHeader
            id="trial-courses"
            heading={t('trial.courses')}
            intro={t('trial.coursesIntro')}
            {...(live.total > live.items.length
              ? {
                  action: {
                    href: allLive,
                    text: t('trial.allLive', { count: live.total }),
                  },
                }
              : {})}
          />
          {live.items.length === 0 ? (
            <EmptyState>{t('trial.empty')}</EmptyState>
          ) : (
            <CourseShelf
              locale={locale}
              courses={live.items}
              label={t('trial.courses')}
            />
          )}
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="trial-next">
          <SectionHeader id="trial-next" heading={t('trial.next')} />
          <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
            {NEXT.map((key) => (
              <li
                key={key}
                className="flex min-w-0 gap-3 rounded-panel border border-border bg-surface-raised p-5"
              >
                <Icon name="check" size={20} className="mt-0.5 shrink-0 text-accent" />
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="font-semibold">{t(`trial.nextSteps.${key}.title`)}</h3>
                  <p className="text-sm text-foreground-muted">
                    {t(`trial.nextSteps.${key}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <a
              href={localizedPath(locale, '/my/learning')}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
            >
              {t('trial.myLearning')}
              <Icon name="arrow-end" size={16} />
            </a>
            <a
              href={learnPath(locale, 'teachers')}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
            >
              {t('sections.teachers')}
              <Icon name="arrow-end" size={16} />
            </a>
          </p>
        </section>
      </div>
    </Container>
  );
}
