import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { isOpenApplication } from '@minhaj/contracts/membership';
import { targetKey, type PersonalTarget } from '@minhaj/contracts/personalisation';

import { CampaignTitle, DonationStateBadge, Money } from '@/components/donations/parts';
import { donationsRead } from '@/components/donations/read';
import { membershipRead } from '@/components/membership/read';
import { ClassSchedule } from '@/components/my-classes/parts';
import { LearningTitle } from '@/components/my-learning/parts';
import { messagingRead } from '@/components/messaging/read';
import { learningRead } from '@/components/my-learning/read';
import {
  KindBadge,
  PersonalTime,
  TargetTitle,
  type PersonalTranslator,
} from '@/components/personal/parts';
import { INTEREST_SECTIONS } from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { WorkspaceCard } from '@/components/workspace/parts';
import { donationsRuntime } from '@/composition/donations';
import { learningRuntime } from '@/composition/learning';
import { membershipRuntime } from '@/composition/membership';
import { messagingRuntime } from '@/composition/messaging';
import { personalisationRuntime } from '@/composition/personalisation';
import {
  resolvePersonalTargets,
  type ResolvedTarget,
} from '@/composition/personal-targets';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from './guard';
import { SignOutForm } from './sign-out-form';

/**
 * My Minhaj — the account landing (ROUTE_MAP.md §5.1; Phase 2, with
 * Personalisation's home panels from Phase 21 and Learning's from Phase 22).
 *
 * `/my` is a LAYER-4 composition surface, not a bounded context. It composes
 * what each owner has delivered and NOTHING ELSE: Identity's account summary
 * and settings, Fatwa's `/my/questions` (Phase 20), and Personalisation's
 * panels (Phase 21) — recently saved, recently read and watched (only while
 * the person has history turned on), the Quran reading position, unread
 * notifications, the optional interests prompt, and links to the public
 * sections the person said they are interested in — and Learning's panel
 * (Phase 22): how many Courses the person is enrolled on and a way back into
 * the one they enrolled on most recently — and, from Phase 23, their next
 * upcoming class — and, from Phase 24, how many messages are waiting unread —
 * and, from Phase 26, Membership's panel: how many Memberships the person
 * holds and how many applications are in progress — and, from Phase 27,
 * Donations' panel: the most recent donation the person gave while signed
 * in, in its state and exact amount. A promised surface must never be
 * mistaken for a delivered one (§5.1, §5.2).
 *
 * THE PANELS ARE THE PERSON'S OWN, read with the session's account and
 * resolved through each content owner now. If they cannot be read, the page
 * says so and the account itself stays fully reachable. Learning's,
 * Messaging's, Membership's and Donations' panels are read separately, so one
 * owner's outage never blanks another's.
 *
 * AN OVERVIEW OF CARDS, one per section, each with its heading, a short
 * status and the links onward — the same reads as before, arranged so the
 * page is scanned rather than scrolled. Every My Minhaj page the former link
 * list offered is still linked from the card it belongs to; the area's own
 * navigation sits beside the page in the workspace frame (`./layout.tsx`).
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

const RECENT_SAVED = 5;
const RECENT_HISTORY = 3;

/** One short list of targets with their resolved titles and a time. */
function TargetList({
  label,
  rows,
  titles,
  locale,
  timeZone,
  t,
}: {
  readonly label: string;
  readonly rows: readonly { readonly target: PersonalTarget; readonly at: string }[];
  readonly titles: ReadonlyMap<string, ResolvedTarget>;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly t: PersonalTranslator;
}) {
  return (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-[color:var(--color-border)]"
    >
      {rows.map((row) => (
        <li key={targetKey(row.target)} className="flex min-w-0 flex-col gap-1 py-2">
          <TargetTitle resolved={titles.get(targetKey(row.target))} t={t} />
          <span className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-foreground-muted)]">
            <KindBadge kind={row.target.kind} t={t} />
            <PersonalTime value={row.at} locale={locale} timeZone={timeZone} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Personalisation's reads for the landing, in one round. */
async function personalPanels(accountId: string) {
  const actor = { accountId };
  const { saved, history, settings, notifications } = personalisationRuntime();
  const [current, recent, progress, unread] = await Promise.all([
    settings.settings(actor),
    saved.recent(actor, RECENT_SAVED),
    history.quranProgress(actor),
    notifications.unread(actor),
  ]);
  const [reading, watching] = current.historyEnabled
    ? await Promise.all([history.reading(actor, 0), history.watching(actor, 0)])
    : [null, null];
  return {
    current,
    recent,
    progress,
    unread,
    reading: reading?.items.slice(0, RECENT_HISTORY) ?? [],
    watching: watching?.items.slice(0, RECENT_HISTORY) ?? [],
  };
}

export default async function MyPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });
  const p = await getTranslations({ locale, namespace: 'personal' });
  const l = await getTranslations({ locale, namespace: 'myLearning' });
  const c = await getTranslations({ locale, namespace: 'myClasses' });
  const m = await getTranslations({ locale, namespace: 'messages' });
  const ms = await getTranslations({ locale, namespace: 'myMembership' });
  const md = await getTranslations({ locale, namespace: 'myDonations' });
  const dn = await getTranslations({ locale, namespace: 'donations' });
  const w = await getTranslations({ locale, namespace: 'workspace' });
  const session = await requireActiveSession(locale, `/${locale}/my`);
  const timeZone = session.account.timezone;

  const learning = await learningRead('learning-home', () =>
    learningRuntime().learner.courses({ accountId: session.account.id }, 0),
  );
  // The most recently enrolled Course that is open now — the list's own order.
  const resume = learning.ok
    ? learning.value.items.find((entry) => entry.available)
    : undefined;

  // The person's next class, if any: the soonest of their upcoming classes.
  const classes = await learningRead('learning-home-classes', () =>
    learningRuntime().myClasses.upcoming({ accountId: session.account.id }),
  );
  const nextClass = classes.ok ? classes.value[0] : undefined;

  // Unread messages across the person's conversations — Messaging's own read.
  const unreadMessages = await messagingRead('messaging-home', () =>
    messagingRuntime().service.unreadTotal({ accountId: session.account.id }),
  );

  // The person's Memberships and applications in progress — Membership's own read.
  const membership = await membershipRead('membership-home', async () => {
    const own = await membershipRuntime().applicant.state({
      accountId: session.account.id,
    });
    return {
      active: own.memberships.filter((entry) => entry.status === 'active').length,
      open: own.applications.filter((entry) => isOpenApplication(entry.status)).length,
    };
  });

  // The person's most recent linked donation — Donations' own read.
  const donations = await donationsRead('donations-home', async () => {
    const own = await donationsRuntime().owner.history({ accountId: session.account.id });
    return own[0] ?? null;
  });

  const read = await personalRead('personal-home', () =>
    personalPanels(session.account.id),
  );
  const panels = read.ok ? read.value : null;
  const ayah =
    panels === null || panels.progress === null
      ? null
      : {
          kind: 'ayah' as const,
          surah: panels.progress.surah,
          ayah: panels.progress.ayah,
        };
  const recentRows = (panels?.recent ?? []).map((entry) => ({
    target: entry.target,
    at: entry.savedAt,
  }));
  const readingRows = (panels?.reading ?? []).map((entry) => ({
    target: entry.target,
    at: entry.lastReadAt,
  }));
  const watchRows = (panels?.watching ?? []).map((entry) => ({
    target: { kind: 'video' as const, id: entry.videoId },
    at: entry.lastWatchedAt,
  }));
  const titles =
    panels === null
      ? new Map<string, ResolvedTarget>()
      : await resolvePersonalTargets(
          [
            ...recentRows.map((row) => row.target),
            ...readingRows.map((row) => row.target),
            ...watchRows.map((row) => row.target),
            ...(ayah === null ? [] : [ayah]),
          ],
          locale,
        );
  const position = ayah === null ? undefined : titles.get(targetKey(ayah));

  return (
    <main className="flex w-full min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('my.title')}</PageHeading>
        <p className="text-foreground-muted">{t('my.description')}</p>
      </header>

      {panels !== null && panels.current.onboarding === null ? (
        <WorkspaceCard
          heading={p('home.onboardingHeading')}
          links={[
            { href: `/${locale}/my/settings/interests`, text: p('home.onboardingLink') },
          ]}
        >
          <p>{p('home.onboardingBody')}</p>
        </WorkspaceCard>
      ) : null}

      {panels === null || panels.current.interests.length === 0 ? null : (
        <Panel>
          <nav aria-labelledby="home-sections" className="flex flex-col gap-2">
            <span id="home-sections">
              <SectionHeading>{p('home.sectionsHeading')}</SectionHeading>
            </span>
            <ul className="flex flex-wrap gap-x-6">
              {panels.current.interests.map((interest) => (
                <li key={interest} className="flex min-h-11 items-center">
                  <TextLink href={`/${locale}${INTEREST_SECTIONS[interest]}`}>
                    {p(`interests.interest.${interest}`)}
                  </TextLink>
                </li>
              ))}
            </ul>
          </nav>
        </Panel>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <WorkspaceCard
          heading={l('home.heading')}
          links={[
            { href: `/${locale}/my/learning`, text: l('home.link') },
            { href: `/${locale}/my/progress/courses`, text: l('nav.progress') },
          ]}
        >
          {!learning.ok ? (
            <Alert tone="error">{l('home.unavailable')}</Alert>
          ) : learning.value.items.length === 0 ? (
            <>
              <EmptyState>{l('courses.empty')}</EmptyState>
              <p>
                <TextLink href={`/${locale}/learn/courses`}>
                  {l('courses.browse')}
                </TextLink>
              </p>
            </>
          ) : (
            <>
              <p>
                {l(learning.value.hasMore ? 'home.enrolledMany' : 'home.enrolled', {
                  count: String(learning.value.items.length),
                })}
              </p>
              {resume === undefined ? null : (
                <p className="flex flex-wrap items-center gap-x-2">
                  <span>{l('home.continue')}</span>
                  <TextLink
                    href={`/${locale}/my/learning/courses/${encodeURIComponent(resume.course.slug)}`}
                  >
                    <LearningTitle
                      labels={resume.course.labels}
                      primaryLocale={resume.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>
                </p>
              )}
            </>
          )}
        </WorkspaceCard>

        <WorkspaceCard
          heading={c('home.heading')}
          links={[
            { href: `/${locale}/my/classes`, text: c('home.link') },
            { href: `/${locale}/my/teachers`, text: c('nav.teachers') },
          ]}
        >
          {!classes.ok ? (
            <Alert tone="error">{c('home.unavailable')}</Alert>
          ) : nextClass === undefined ? (
            <p>{c('home.none')}</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-x-2">
                <span>{c('home.next')}</span>
                <TextLink href={`/${locale}/my/classes/${nextClass.session.id}`}>
                  <LearningTitle
                    labels={nextClass.course.labels}
                    primaryLocale={nextClass.course.primaryLocale}
                    locale={locale}
                  />
                </TextLink>
              </p>
              <ClassSchedule
                session={nextClass.session}
                locale={locale}
                timeZone={timeZone}
                t={c}
              />
            </>
          )}
        </WorkspaceCard>

        <WorkspaceCard
          heading={m('home.heading')}
          links={[{ href: `/${locale}/my/messages`, text: m('home.link') }]}
        >
          {!unreadMessages.ok ? (
            <Alert tone="error">{m('home.unavailable')}</Alert>
          ) : (
            <p>
              {unreadMessages.value === 0
                ? m('home.none')
                : m('home.unread', { count: unreadMessages.value })}
            </p>
          )}
        </WorkspaceCard>

        {panels === null ? (
          // One owner's outage never blanks another's: Personalisation's cards
          // give way to one statement, and every other card stays.
          <div className="md:col-span-2">
            <Alert tone="error">{p('home.unavailable')}</Alert>
          </div>
        ) : (
          <>
            <WorkspaceCard
              heading={p('home.notificationsHeading')}
              links={[
                {
                  href: `/${locale}/my/notifications`,
                  text: p('home.notificationsLink'),
                },
                {
                  href: `/${locale}/my/settings/notifications`,
                  text: p('nav.notificationSettings'),
                },
              ]}
            >
              <p>{p('notifications.unreadCount', { count: panels.unread })}</p>
            </WorkspaceCard>

            <WorkspaceCard
              heading={p('home.quranHeading')}
              links={[
                { href: `/${locale}/my/progress/quran`, text: p('home.quranLink') },
              ]}
            >
              {ayah === null ? (
                <p>{p('home.quranNone')}</p>
              ) : (
                <>
                  <TargetTitle resolved={position} t={p} />
                  {position?.status === 'available' ? (
                    <p>
                      <TextLink href={position.href}>{p('progress.continue')}</TextLink>
                    </p>
                  ) : null}
                </>
              )}
            </WorkspaceCard>

            <WorkspaceCard
              heading={p('home.savedHeading')}
              links={[
                { href: `/${locale}/my/saved`, text: p('home.savedLink') },
                { href: `/${locale}/my/saved/bookmarks`, text: p('nav.bookmarks') },
                { href: `/${locale}/my/saved/notes`, text: p('nav.notes') },
                { href: `/${locale}/my/saved/collections`, text: p('nav.collections') },
              ]}
            >
              {recentRows.length === 0 ? (
                <EmptyState>{p('saved.empty')}</EmptyState>
              ) : (
                <TargetList
                  label={p('home.savedHeading')}
                  rows={recentRows}
                  titles={titles}
                  locale={locale}
                  timeZone={timeZone}
                  t={p}
                />
              )}
            </WorkspaceCard>

            <WorkspaceCard
              heading={
                panels.current.historyEnabled
                  ? p('home.historyHeading')
                  : p('privacy.historyHeading')
              }
              links={[
                { href: `/${locale}/my/history/reading`, text: p('nav.reading') },
                { href: `/${locale}/my/history/watch`, text: p('nav.watch') },
              ]}
            >
              {!panels.current.historyEnabled ? (
                <>
                  <p>{p('privacy.historyOff')}</p>
                  <p>
                    <TextLink href={`/${locale}/my/settings/privacy`}>
                      {p('history.offLink')}
                    </TextLink>
                  </p>
                </>
              ) : readingRows.length === 0 && watchRows.length === 0 ? (
                <EmptyState>{p('home.historyEmpty')}</EmptyState>
              ) : (
                <>
                  {readingRows.length === 0 ? null : (
                    <TargetList
                      label={p('nav.reading')}
                      rows={readingRows}
                      titles={titles}
                      locale={locale}
                      timeZone={timeZone}
                      t={p}
                    />
                  )}
                  {watchRows.length === 0 ? null : (
                    <TargetList
                      label={p('nav.watch')}
                      rows={watchRows}
                      titles={titles}
                      locale={locale}
                      timeZone={timeZone}
                      t={p}
                    />
                  )}
                </>
              )}
            </WorkspaceCard>
          </>
        )}

        <WorkspaceCard
          heading={t('my.questions')}
          links={[{ href: `/${locale}/my/questions`, text: t('my.questions') }]}
        >
          <p>{w('my.questionsBody')}</p>
        </WorkspaceCard>

        <WorkspaceCard
          heading={ms('home.heading')}
          links={[{ href: `/${locale}/my/membership`, text: ms('home.link') }]}
        >
          {!membership.ok ? (
            <Alert tone="error">{ms('home.unavailable')}</Alert>
          ) : membership.value.active === 0 && membership.value.open === 0 ? (
            <p>{ms('home.none')}</p>
          ) : (
            <>
              {membership.value.active === 0 ? null : (
                <p>{ms('home.active', { count: membership.value.active })}</p>
              )}
              {membership.value.open === 0 ? null : (
                <p>{ms('home.open', { count: membership.value.open })}</p>
              )}
            </>
          )}
        </WorkspaceCard>

        <WorkspaceCard
          heading={md('home.heading')}
          links={[{ href: `/${locale}/my/donations`, text: md('home.link') }]}
        >
          {!donations.ok ? (
            <Alert tone="error">{md('home.unavailable')}</Alert>
          ) : donations.value === null ? (
            <p>{md('home.none')}</p>
          ) : (
            <>
              <p>{md('home.latest')}</p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  <CampaignTitle
                    campaign={donations.value.campaign}
                    locale={locale}
                    t={dn}
                  />
                </span>
                <Money money={donations.value.expected} locale={locale} />
                <DonationStateBadge state={donations.value.state} t={dn} />
              </p>
            </>
          )}
        </WorkspaceCard>

        <WorkspaceCard
          heading={w('my.accountHeading')}
          wide
          links={[
            { href: `/${locale}/my/settings/profile`, text: t('my.profile') },
            { href: `/${locale}/my/settings/security`, text: t('my.security') },
            { href: `/${locale}/my/settings/language`, text: t('my.language') },
            { href: `/${locale}/my/settings/interests`, text: p('nav.interests') },
            { href: `/${locale}/my/settings/privacy`, text: p('nav.privacy') },
          ]}
        >
          <dl className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
            <DetailRow term={t('common.name')}>{session.account.name}</DetailRow>
            <DetailRow term={t('common.email')}>{session.account.email}</DetailRow>
          </dl>
        </WorkspaceCard>
      </div>

      <SignOutForm locale={locale} label={t('my.signOut')} />
    </main>
  );
}
