import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { Fragment, type ReactNode } from 'react';

import type { PersonalTarget } from '@minhaj/contracts/personalisation';
import { isInternalDestination } from '@minhaj/contracts/personalisation';

import {
  CampaignTitle,
  DonationStateBadge,
  EnvironmentBadge,
  Money,
} from '@/components/donations/parts';
import { ApplicationStatusBadge, TypeTitle } from '@/components/membership/parts';
import { JoinLink } from '@/components/my-classes/parts';
import { LearningTitle } from '@/components/my-learning/parts';
import {
  dashboardColumns,
  dashboardModules,
  isNewAccount,
  lessonPercent,
  startSteps,
  type DashboardModule,
} from '@/components/my/dashboard';
import {
  MyRail,
  MyRailModule,
  MySection,
  OnwardLink,
  ProgressMeter,
} from '@/components/my/frame';
import { TargetCard, type TargetWords } from '@/components/my/targets';
import { relativeDay, shortDate, zonedDate, zonedTime } from '@/components/my/time';
import { INTEREST_SECTIONS } from '@/components/personal/presentation';
import { Alert, Badge, DetailRow, Icon, PageHeading } from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from './guard';
import { readHome } from './home-data';
import { SignOutForm } from './sign-out-form';

/**
 * My Minhaj — the account's home (ROUTE_MAP.md §5.1; redesigned in R2; every
 * section restored to it 2026-11-08 by owner direction).
 *
 * `/my` is a LAYER-4 composition surface, not a bounded context. It composes
 * what each owner has delivered and NOTHING ELSE (`./home-data.ts`).
 *
 * EVERY SECTION IS HERE, ALWAYS (`dashboardModules`): the next class — with
 * its Google Meet "Join" when the teacher has set a meeting address — and the
 * way to the person's teachers; their courses; what they saved; their Quran
 * reading position; their history; and, beside it, messages, notifications,
 * questions, Membership and donations. A section with nothing in it yet says
 * so in words and keeps its ways onward, so nothing the platform offers is
 * hidden from the person (R2 showed a module only with something in it —
 * historical, superseded 2026-11-08). A new account is also shown how to
 * begin ("Make My Minhaj yours"), and anything to pick up is offered first.
 *
 * A READ THAT FAILED IS NEVER SHOWN AS NOTHING: the page names the parts it
 * could not show, each such module says it cannot be shown now, and every
 * other module stays.
 *
 * RECOMMENDATIONS ARE THE PERSON'S OWN CHOICE: the sections they picked under
 * "Interests and goals", never anything inferred from what they read.
 *
 * THE JOIN LINK is shown only when Learning's disclosure read returned an
 * address for the next class; otherwise there is no link and no hint of one.
 */
/**
 * The dashboard is the area's own page, so it keeps the layout's absolute
 * "My Minhaj · One Minhaj": a title template applies only to CHILD segments,
 * and a title set here would be framed by the site's template instead,
 * dropping the area name.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session, so there is nothing to
 * prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

const FAILURE_PARTS = [
  ['learningFailed', 'learning'],
  ['classesFailed', 'classes'],
  ['personalFailed', 'personal'],
  ['messagesFailed', 'messages'],
  ['questionsFailed', 'questions'],
  ['membershipFailed', 'membership'],
  ['donationsFailed', 'giving'],
] as const;

export default async function MyPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, localizedPath(locale, '/my'));
  const t = await getTranslations({ locale, namespace: 'my' });
  const identity = await getTranslations({ locale, namespace: 'identity' });
  const p = await getTranslations({ locale, namespace: 'personal' });
  const l = await getTranslations({ locale, namespace: 'myLearning' });
  const c = await getTranslations({ locale, namespace: 'myClasses' });
  const m = await getTranslations({ locale, namespace: 'messages' });
  const ms = await getTranslations({ locale, namespace: 'membership' });
  const dn = await getTranslations({ locale, namespace: 'donations' });
  const md = await getTranslations({ locale, namespace: 'myDonations' });
  const mm = await getTranslations({ locale, namespace: 'myMembership' });
  const f = await getTranslations({ locale, namespace: 'fatwa' });
  const timeZone = session.account.timezone;
  const now = new Date();
  const my = (path = '') => localizedPath(locale, `/my${path}`);

  const home = await readHome(session.account.id, locale);
  const personal = home.personal;
  const continuing =
    (home.course === null ? 0 : 1) +
    (home.ayah === null ? 0 : 1) +
    (personal === null || personal.lastRead === null ? 0 : 1) +
    (home.watched === null ? 0 : 1);
  const signals = {
    continuing,
    upcomingClass: home.nextClass !== null && home.nextClass.next !== null,
    saved: personal?.saved.length ?? 0,
    interests: personal?.settings.interests.length ?? 0,
    // Unknown while Personalisation cannot be asked: no "begin" prompt then.
    interestsAnswered: personal === null || personal.settings.onboarding !== null,
    conversations: home.messages?.latest.length ?? 0,
    notifications: personal?.notificationTotal ?? 0,
    questions: home.questions?.total ?? 0,
    membership:
      home.membership !== null &&
      (home.membership.active.length > 0 || home.membership.open.length > 0),
    donations: home.donations?.length ?? 0,
  };
  const columns = dashboardColumns(dashboardModules(signals));
  const failed = FAILURE_PARTS.filter(([flag]) => home[flag]).map(([, part]) =>
    t(`home.parts.${part}`),
  );
  const words: TargetWords = {
    kind: (kind) => p(`kinds.${kind}`),
    unavailable: p('target.unavailable'),
    unknown: p('target.unknown'),
  };

  /** A module whose owner could not be asked: said, never shown as empty. */
  const unavailable = (
    <p className="text-sm text-foreground-muted">{t('home.unavailable')}</p>
  );
  const quiet = (text: ReactNode) => (
    <p className="text-sm text-foreground-muted">{text}</p>
  );

  const render = (module: DashboardModule) => {
    switch (module) {
      case 'start':
        return startModule();
      case 'continue':
        return continueModule();
      case 'classes':
        return classesModule();
      case 'learning':
        return learningModule();
      case 'saved':
        return savedModule();
      case 'interests':
        return interestsModule();
      case 'quran':
        return quranModule();
      case 'history':
        return historyModule();
      case 'messages':
        return messagesModule();
      case 'notifications':
        return notificationsModule();
      case 'questions':
        return questionsModule();
      case 'membership':
        return membershipModule();
      case 'giving':
        return givingModule();
    }
  };

  /* ---- Begin ---------------------------------------------------------- */

  function startModule() {
    // While Personalisation cannot be asked the steps are unknown, not open.
    if (personal === null) return null;
    const steps = startSteps(signals);
    const historyOff = !personal.settings.historyEnabled;
    const items: readonly {
      readonly key: keyof typeof START_ICONS;
      readonly done: boolean;
      readonly href: string;
    }[] = [
      { key: 'interests', done: !steps.interests, href: my('/settings/interests') },
      { key: 'save', done: !steps.save, href: localizedPath(locale, '/library') },
      ...(historyOff
        ? [{ key: 'history' as const, done: false, href: my('/settings/privacy') }]
        : []),
    ];
    return (
      <MySection
        id="home-start"
        heading={t('home.start.heading')}
        intro={t('home.start.intro')}
      >
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.key}
              className={`flex min-w-0 flex-col gap-2 rounded-panel border p-5 ${
                item.done
                  ? 'border-border bg-surface'
                  : 'border-border bg-surface-raised shadow-panel'
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-10 items-center justify-center rounded-full ${
                  item.done
                    ? 'bg-success-surface text-success'
                    : 'bg-accent-surface text-accent'
                }`}
              >
                <Icon name={item.done ? 'check' : START_ICONS[item.key]} size={20} />
              </span>
              <h3 className="text-base font-semibold">
                {t(`home.start.${item.key}.title`)}
              </h3>
              <p className="text-sm text-foreground-muted">
                {t(`home.start.${item.key}.body`)}
              </p>
              <div className="mt-auto">
                {item.done ? (
                  <p className="text-sm font-semibold text-success">
                    {t('home.start.done')}
                  </p>
                ) : (
                  <OnwardLink href={item.href}>
                    {t(`home.start.${item.key}.action`)}
                  </OnwardLink>
                )}
              </div>
            </li>
          ))}
        </ol>
      </MySection>
    );
  }

  /* ---- Continue ------------------------------------------------------- */

  function continueModule() {
    const course = home.course;
    const lastRead = personal?.lastRead ?? null;
    const lastWatched = personal?.lastWatched ?? null;
    return (
      <MySection id="home-continue" heading={t('home.continue.heading')}>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          {course === null ? null : (
            <li className="flex min-w-0 flex-col gap-2 border-t-2 border-accent-rule pt-3">
              <span className="text-caption font-semibold text-accent">
                {t('home.continue.course')}
              </span>
              <a
                href={my(`/learning/courses/${encodeURIComponent(course.course.slug)}`)}
                className="w-fit text-subheading font-semibold text-balance text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action"
              >
                <LearningTitle
                  labels={course.course.labels}
                  primaryLocale={course.course.primaryLocale}
                  locale={locale}
                />
              </a>
              <ProgressMeter
                percent={lessonPercent(course.completedLessons, course.course.lessons)}
              >
                {l('progress.lessons', {
                  completed: String(
                    Math.min(course.completedLessons, course.course.lessons),
                  ),
                  total: String(course.course.lessons),
                })}
              </ProgressMeter>
            </li>
          )}
          {home.ayah === null ? null : (
            <TargetCard
              kind="ayah"
              resolved={home.title(home.ayah)}
              words={{ ...words, kind: () => t('home.continue.quran') }}
              meta={
                personal === null || personal.quran === null
                  ? []
                  : [
                      t('home.continue.set', {
                        date: shortDate(
                          new Date(personal.quran.updatedAt),
                          locale,
                          timeZone,
                        ),
                      }),
                    ]
              }
            />
          )}
          {lastRead === null ? null : (
            <TargetCard
              kind={lastRead.target.kind}
              resolved={home.title(lastRead.target)}
              words={words}
              meta={[
                t('home.continue.read', {
                  date: shortDate(new Date(lastRead.lastReadAt), locale, timeZone),
                }),
              ]}
            />
          )}
          {home.watched === null || lastWatched === null ? null : (
            <TargetCard
              kind="video"
              resolved={home.title(home.watched)}
              words={words}
              meta={[
                t('home.continue.watched', {
                  date: shortDate(new Date(lastWatched.lastWatchedAt), locale, timeZone),
                }),
              ]}
            />
          )}
        </ul>
      </MySection>
    );
  }

  /* ---- Classes -------------------------------------------------------- */

  function classesModule() {
    const next = home.nextClass === null ? null : home.nextClass.next;
    return (
      <MySection
        id="home-classes"
        heading={c('home.heading')}
        links={[
          { href: my('/classes'), text: c('home.link') },
          { href: my('/teachers'), text: c('nav.teachers') },
        ]}
      >
        {home.classesFailed
          ? unavailable
          : next === null
            ? quiet(c('home.none'))
            : nextClass(next, home.nextClass?.join ?? null)}
      </MySection>
    );
  }

  function nextClass(
    next: NonNullable<NonNullable<typeof home.nextClass>['next']>,
    join: string | null,
  ) {
    const starts = next.session.startsAt;
    const day = relativeDay(starts, now, timeZone);
    return (
      <div className="flex min-w-0 flex-col gap-5 rounded-panel bg-ink p-5 text-ink-foreground sm:flex-row sm:items-center sm:p-6">
        <div className="flex shrink-0 flex-col gap-0.5 sm:w-44">
          <span className="text-caption font-semibold text-ink-accent">
            {day === 'today' || day === 'tomorrow'
              ? t(`home.upcoming.${day}`)
              : zonedDate(starts, locale, timeZone)}
          </span>
          <span className="font-serif text-heading font-semibold tabular-nums">
            {zonedTime(starts, locale, timeZone)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-caption text-ink-muted">{t('home.upcoming.heading')}</p>
          <p className="text-subheading font-semibold text-balance">
            <a
              href={my(`/classes/${next.session.id}`)}
              className="text-ink-foreground underline decoration-ink-accent underline-offset-4"
            >
              <LearningTitle
                labels={next.course.labels}
                primaryLocale={next.course.primaryLocale}
                locale={locale}
              />
            </a>
          </p>
          {day === 'today' || day === 'tomorrow' ? (
            <p className="text-sm text-ink-muted">
              {zonedDate(starts, locale, timeZone)}
            </p>
          ) : null}
        </div>
        {join === null ? null : (
          <div className="shrink-0">
            <JoinLink url={join} label={c('join')} />
          </div>
        )}
      </div>
    );
  }

  /* ---- Learning ------------------------------------------------------- */

  function learningModule() {
    const enrolled = home.enrolled;
    return (
      <MySection
        id="home-learning"
        heading={l('home.heading')}
        links={[
          { href: my('/learning'), text: l('home.link') },
          { href: my('/progress/courses'), text: l('nav.progress') },
          { href: localizedPath(locale, '/learn/courses'), text: l('nav.catalogue') },
        ]}
      >
        {enrolled === null
          ? unavailable
          : enrolled.count === 0
            ? quiet(l('courses.empty'))
            : quiet(
                l(enrolled.hasMore ? 'home.enrolledMany' : 'home.enrolled', {
                  count: String(enrolled.count),
                }),
              )}
      </MySection>
    );
  }

  /* ---- Saved ---------------------------------------------------------- */

  function savedModule() {
    const saved = personal?.saved ?? [];
    return (
      <MySection
        id="home-saved"
        heading={p('home.savedHeading')}
        links={[
          { href: my('/saved'), text: p('home.savedLink') },
          { href: my('/saved/bookmarks'), text: p('nav.bookmarks') },
          { href: my('/saved/notes'), text: p('nav.notes') },
          { href: my('/saved/collections'), text: p('nav.collections') },
        ]}
      >
        {personal === null ? (
          unavailable
        ) : saved.length === 0 ? (
          quiet(p('saved.empty'))
        ) : (
          <Shelf
            label={p('home.savedHeading')}
            previousLabel={t('home.shelf.previous')}
            nextLabel={t('home.shelf.next')}
            size="card"
          >
            {saved.map((entry) => (
              <TargetCard
                key={entry.savedItemId}
                kind={entry.target.kind}
                resolved={home.title(entry.target)}
                words={words}
                meta={[
                  t('saved.when', {
                    date: shortDate(new Date(entry.savedAt), locale, timeZone),
                  }),
                ]}
              />
            ))}
          </Shelf>
        )}
      </MySection>
    );
  }

  /* ---- Interests ------------------------------------------------------ */

  function interestsModule() {
    return (
      <nav aria-labelledby="home-sections" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 border-b border-border pb-2.5">
          <h2 id="home-sections" className="text-subheading font-semibold">
            {p('home.sectionsHeading')}
          </h2>
          <OnwardLink href={my('/settings/interests')}>
            {t('home.interests.change')}
          </OnwardLink>
        </div>
        <ul className="flex flex-wrap gap-2">
          {(personal?.settings.interests ?? []).map((interest) => (
            <li key={interest}>
              <a
                href={localizedPath(locale, INTEREST_SECTIONS[interest])}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong bg-surface-raised px-4 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:border-action hover:text-action"
              >
                {p(`interests.interest.${interest}`)}
                <Icon name="arrow-end" size={16} />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  /* ---- Quran position and history ------------------------------------- */

  /** A kept thing's title, linked while its owner still publishes it. */
  function targetLine(target: PersonalTarget, meta: string) {
    const resolved = home.title(target);
    return (
      <li className="flex min-w-0 flex-col gap-0.5">
        {resolved?.status === 'available' ? (
          <a
            href={resolved.href}
            lang={resolved.titleLanguage}
            dir="auto"
            className="w-fit font-semibold text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action"
          >
            {resolved.title}
          </a>
        ) : (
          <span className="text-foreground-muted">
            {resolved?.status === 'unknown' ? words.unknown : words.unavailable}
          </span>
        )}
        <span className="text-caption text-foreground-muted">{meta}</span>
      </li>
    );
  }

  function quranModule() {
    return (
      <MySection
        id="home-quran"
        heading={p('home.quranHeading')}
        links={[{ href: my('/progress/quran'), text: p('home.quranLink') }]}
      >
        {personal === null ? (
          unavailable
        ) : home.ayah === null || personal.quran === null ? (
          quiet(p('home.quranNone'))
        ) : (
          <ul className="text-sm">
            {targetLine(
              home.ayah,
              t('home.continue.set', {
                date: shortDate(new Date(personal.quran.updatedAt), locale, timeZone),
              }),
            )}
          </ul>
        )}
      </MySection>
    );
  }

  function historyModule() {
    const enabled = personal?.settings.historyEnabled ?? true;
    const lastRead = personal?.lastRead ?? null;
    const lastWatched = personal?.lastWatched ?? null;
    return (
      <MySection
        id="home-history"
        heading={enabled ? p('home.historyHeading') : p('privacy.historyHeading')}
        links={[
          { href: my('/history/reading'), text: p('nav.reading') },
          { href: my('/history/watch'), text: p('nav.watch') },
        ]}
      >
        {personal === null ? (
          unavailable
        ) : !enabled ? (
          <div className="flex flex-col gap-1">
            {quiet(p('privacy.historyOff'))}
            <OnwardLink href={my('/settings/privacy')}>{p('history.offLink')}</OnwardLink>
          </div>
        ) : lastRead === null && (home.watched === null || lastWatched === null) ? (
          quiet(p('home.historyEmpty'))
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {lastRead === null
              ? null
              : targetLine(
                  lastRead.target,
                  t('home.continue.read', {
                    date: shortDate(new Date(lastRead.lastReadAt), locale, timeZone),
                  }),
                )}
            {home.watched === null || lastWatched === null
              ? null
              : targetLine(
                  home.watched,
                  t('home.continue.watched', {
                    date: shortDate(
                      new Date(lastWatched.lastWatchedAt),
                      locale,
                      timeZone,
                    ),
                  }),
                )}
          </ul>
        )}
      </MySection>
    );
  }

  /* ---- Waiting for you ------------------------------------------------ */

  function messagesModule() {
    const messages = home.messages;
    return (
      <MyRailModule
        id="home-messages"
        icon="message"
        heading={m('home.heading')}
        links={[
          { href: my('/messages'), text: m('home.link') },
          { href: my('/messages/support'), text: m('nav.support') },
          { href: my('/teachers'), text: m('nav.teachers') },
        ]}
      >
        {messages === null ? (
          unavailable
        ) : (
          <>
            <p className="font-semibold">
              {messages.unread === 0
                ? m('home.none')
                : m('home.unread', { count: messages.unread })}
            </p>
            {messages.latest.length === 0 ? null : (
              <ul
                aria-label={m('list.heading')}
                className="flex flex-col divide-y divide-border"
              >
                {messages.latest.map((summary) => (
                  <li
                    key={summary.id}
                    className="flex min-w-0 items-center justify-between gap-3 py-2"
                  >
                    <a
                      href={my(`/messages/${summary.id}`)}
                      className="min-w-0 truncate font-medium text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action"
                      dir="auto"
                    >
                      {summary.kind === 'support'
                        ? m('supportName')
                        : summary.counterpartAccountId === null
                          ? m('unnamed.teacher')
                          : (messages.names.get(summary.counterpartAccountId) ??
                            m('unnamed.teacher'))}
                    </a>
                    {summary.unread === 0 ? (
                      summary.lastMessageAt === null ? null : (
                        <span className="shrink-0 text-caption text-foreground-muted">
                          {shortDate(new Date(summary.lastMessageAt), locale, timeZone)}
                        </span>
                      )
                    ) : (
                      <Badge kind="status" tone="action">
                        {t('home.messages.unread', { count: summary.unread })}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </MyRailModule>
    );
  }

  function notificationsModule() {
    return (
      <MyRailModule
        id="home-notifications"
        icon="bell"
        heading={p('home.notificationsHeading')}
        links={[
          { href: my('/notifications'), text: p('home.notificationsLink') },
          { href: my('/settings/notifications'), text: p('nav.notificationSettings') },
        ]}
      >
        {personal === null ? (
          unavailable
        ) : (
          <>
            <p className="text-foreground-muted">
              {p('notifications.unreadCount', { count: personal.unread })}
            </p>
            {personal.notifications.length === 0 ? null : (
              <ul
                aria-label={p('notifications.list')}
                className="flex flex-col divide-y divide-border"
              >
                {personal.notifications.map((entry) => {
                  const destination =
                    entry.destination !== null && isInternalDestination(entry.destination)
                      ? localizedPath(locale, `${entry.destination}`)
                      : null;
                  const text = p(`notifications.kind.${entry.kind}`);
                  return (
                    <li key={entry.id} className="flex min-w-0 flex-col gap-0.5 py-2">
                      <span className="flex items-start gap-2">
                        {entry.readAt === null ? (
                          <span className="mt-0.5 shrink-0">
                            <Badge kind="status" tone="caution">
                              {p('notifications.unread')}
                            </Badge>
                          </span>
                        ) : null}
                        {destination === null ? (
                          <span className={entry.readAt === null ? 'font-semibold' : ''}>
                            {text}
                          </span>
                        ) : (
                          <a
                            href={destination}
                            className={`text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action ${entry.readAt === null ? 'font-semibold' : ''}`}
                          >
                            {text}
                          </a>
                        )}
                      </span>
                      <span className="text-caption text-foreground-muted">
                        {shortDate(new Date(entry.createdAt), locale, timeZone)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </MyRailModule>
    );
  }

  function questionsModule() {
    const questions = home.questions;
    return (
      <MyRailModule
        id="home-questions"
        icon="mail"
        heading={f('my.title')}
        links={[
          { href: my('/questions'), text: f('my.back') },
          { href: my('/questions/ask'), text: t('titles.ask') },
        ]}
      >
        {questions === null ? (
          unavailable
        ) : questions.total === 0 ? (
          <p className="text-foreground-muted">{f('my.empty')}</p>
        ) : (
          <>
            <p>{t('home.questions.count', { count: questions.total })}</p>
            {questions.latest === null ? null : (
              <p className="flex flex-wrap items-center gap-2 text-foreground-muted">
                {t('home.questions.latest')}
                <Badge
                  kind="status"
                  tone={questions.latest.status === 'answered' ? 'positive' : 'neutral'}
                >
                  {f(`my.status.${questions.latest.status}`)}
                </Badge>
              </p>
            )}
          </>
        )}
      </MyRailModule>
    );
  }

  function membershipModule() {
    const membership = home.membership;
    return (
      <MyRailModule
        id="home-membership"
        icon="user"
        heading={mm('home.heading')}
        links={[{ href: my('/membership'), text: mm('home.link') }]}
      >
        {membership === null ? (
          unavailable
        ) : membership.active.length === 0 && membership.open.length === 0 ? (
          <p className="text-foreground-muted">{mm('home.none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {membership.active.map((entry) => (
              <li key={entry.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">
                  <TypeTitle
                    type={membership.types.get(entry.membershipTypeId)}
                    locale={locale}
                    t={ms}
                  />
                </span>
                <span className="text-caption text-foreground-muted">
                  {t('home.membership.since', {
                    date: shortDate(entry.activatedAt, locale, timeZone),
                  })}
                </span>
              </li>
            ))}
            {membership.open.map((entry) => (
              <li key={entry.id} className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">
                  <TypeTitle
                    type={membership.types.get(entry.membershipTypeId)}
                    locale={locale}
                    t={ms}
                  />
                </span>
                <span>
                  <ApplicationStatusBadge status={entry.status} t={ms} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </MyRailModule>
    );
  }

  function givingModule() {
    const latest = home.donations?.[0];
    return (
      <MyRailModule
        id="home-giving"
        icon="heart"
        heading={md('home.heading')}
        links={[{ href: my('/donations'), text: md('home.link') }]}
      >
        {home.donations === null ? (
          unavailable
        ) : latest === undefined ? (
          <p className="text-foreground-muted">{md('home.none')}</p>
        ) : (
          <>
            <p className="text-foreground-muted">{md('home.latest')}</p>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="font-semibold">
                <CampaignTitle campaign={latest.campaign} locale={locale} t={dn} />
              </span>
              <span className="font-serif text-heading font-semibold tabular-nums">
                <Money money={latest.expected} locale={locale} />
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <DonationStateBadge state={latest.state} t={dn} />
                <EnvironmentBadge environment={latest.environment} t={dn} />
              </span>
              <span className="text-caption text-foreground-muted">
                {shortDate(latest.createdAt, locale, timeZone)}
              </span>
            </div>
          </>
        )}
      </MyRailModule>
    );
  }

  return (
    <main className="flex w-full min-w-0 flex-col gap-10">
      <header className="flex flex-col gap-2">
        <PageHeading>
          <span dir="auto">{t('home.greeting', { name: session.account.name })}</span>
        </PageHeading>
        <p className="max-w-[var(--measure-prose)] text-lede text-foreground-muted">
          {personal !== null && isNewAccount(signals)
            ? t('home.intro.new')
            : t('home.intro.returning')}
        </p>
      </header>

      {failed.length === 0 ? null : (
        <Alert tone="warning">
          {t('home.failed', {
            parts: new Intl.ListFormat(locale, { type: 'conjunction' }).format(failed),
          })}
        </Alert>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-12">
          {columns.main.map((module) => (
            <Fragment key={module}>{render(module)}</Fragment>
          ))}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:grid-cols-2 md:gap-8">
            {columns.paired.map((module) => (
              <Fragment key={module}>{render(module)}</Fragment>
            ))}
          </div>
        </div>
        <MyRail label={t('home.rail')}>
          {columns.side.map((module) => (
            <Fragment key={module}>{render(module)}</Fragment>
          ))}
        </MyRail>
      </div>

      <MySection
        id="home-account"
        heading={t('home.account.heading')}
        links={[
          { href: my('/settings/profile'), text: identity('my.profile') },
          { href: my('/settings/security'), text: identity('my.security') },
          { href: my('/settings/language'), text: identity('my.language') },
          { href: my('/settings/interests'), text: p('nav.interests') },
          { href: my('/settings/privacy'), text: p('nav.privacy') },
        ]}
      >
        <dl className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          <DetailRow term={identity('common.name')}>
            <bdi>{session.account.name}</bdi>
          </DetailRow>
          <DetailRow term={identity('common.email')}>
            <bdi className="wrap-anywhere">{session.account.email}</bdi>
          </DetailRow>
        </dl>
      </MySection>

      <div>
        <SignOutForm locale={locale} label={identity('my.signOut')} />
      </div>
    </main>
  );
}

/** Each "begin" step's picture. */
const START_ICONS = { interests: 'grid', save: 'bookmark', history: 'list' } as const;
