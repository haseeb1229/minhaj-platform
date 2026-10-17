import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { targetKey, type PersonalTarget } from '@minhaj/contracts/personalisation';

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
import { learningRuntime } from '@/composition/learning';
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
 * upcoming class — and, from Phase 24, how many messages are waiting unread.
 * It renders no frame for membership or donations, because those belong to
 * work that has not shipped. A promised surface must never be mistaken for a
 * delivered one (§5.1, §5.2).
 *
 * THE PANELS ARE THE PERSON'S OWN, read with the session's account and
 * resolved through each content owner now. If they cannot be read, the page
 * says so and the account itself stays fully reachable. Learning's and
 * Messaging's panels are read separately, so one owner's outage never blanks
 * another's.
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
    <main className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('my.title')}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('my.description')}
        </p>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('common.name')}>{session.account.name}</DetailRow>
          <DetailRow term={t('common.email')}>{session.account.email}</DetailRow>
        </dl>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-2">
          <SectionHeading>{l('home.heading')}</SectionHeading>
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
              <p className="text-sm">
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
          <p>
            <TextLink href={`/${locale}/my/learning`}>{l('home.link')}</TextLink>
          </p>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-2">
          <SectionHeading>{c('home.heading')}</SectionHeading>
          {!classes.ok ? (
            <Alert tone="error">{c('home.unavailable')}</Alert>
          ) : nextClass === undefined ? (
            <p className="text-sm">{c('home.none')}</p>
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
          <p>
            <TextLink href={`/${locale}/my/classes`}>{c('home.link')}</TextLink>
          </p>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-2">
          <SectionHeading>{m('home.heading')}</SectionHeading>
          {!unreadMessages.ok ? (
            <Alert tone="error">{m('home.unavailable')}</Alert>
          ) : (
            <p className="text-sm">
              {unreadMessages.value === 0
                ? m('home.none')
                : m('home.unread', { count: unreadMessages.value })}
            </p>
          )}
          <p>
            <TextLink href={`/${locale}/my/messages`}>{m('home.link')}</TextLink>
          </p>
        </div>
      </Panel>

      {panels === null ? (
        <Alert tone="error">{p('home.unavailable')}</Alert>
      ) : (
        <>
          {panels.current.onboarding === null ? (
            <Panel>
              <div className="flex flex-col gap-2">
                <SectionHeading>{p('home.onboardingHeading')}</SectionHeading>
                <p className="text-sm">{p('home.onboardingBody')}</p>
                <p>
                  <TextLink href={`/${locale}/my/settings/interests`}>
                    {p('home.onboardingLink')}
                  </TextLink>
                </p>
              </div>
            </Panel>
          ) : null}

          {panels.current.interests.length === 0 ? null : (
            <Panel>
              <nav aria-labelledby="home-sections" className="flex flex-col gap-2">
                <span id="home-sections">
                  <SectionHeading>{p('home.sectionsHeading')}</SectionHeading>
                </span>
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {panels.current.interests.map((interest) => (
                    <li key={interest}>
                      <TextLink href={`/${locale}${INTEREST_SECTIONS[interest]}`}>
                        {p(`interests.interest.${interest}`)}
                      </TextLink>
                    </li>
                  ))}
                </ul>
              </nav>
            </Panel>
          )}

          <Panel>
            <div className="flex flex-col gap-2">
              <SectionHeading>{p('home.notificationsHeading')}</SectionHeading>
              <p className="text-sm">
                {p('notifications.unreadCount', { count: panels.unread })}
              </p>
              <p>
                <TextLink href={`/${locale}/my/notifications`}>
                  {p('home.notificationsLink')}
                </TextLink>
              </p>
            </div>
          </Panel>

          <Panel>
            <div className="flex flex-col gap-2">
              <SectionHeading>{p('home.quranHeading')}</SectionHeading>
              {ayah === null ? (
                <p className="text-sm">{p('home.quranNone')}</p>
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
              <p>
                <TextLink href={`/${locale}/my/progress/quran`}>
                  {p('home.quranLink')}
                </TextLink>
              </p>
            </div>
          </Panel>

          <Panel>
            <div className="flex flex-col gap-2">
              <SectionHeading>{p('home.savedHeading')}</SectionHeading>
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
              <p>
                <TextLink href={`/${locale}/my/saved`}>{p('home.savedLink')}</TextLink>
              </p>
            </div>
          </Panel>

          {panels.current.historyEnabled ? (
            <Panel>
              <div className="flex flex-col gap-3">
                <SectionHeading>{p('home.historyHeading')}</SectionHeading>
                {readingRows.length === 0 && watchRows.length === 0 ? (
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
              </div>
            </Panel>
          ) : null}
        </>
      )}

      <nav className="flex flex-col gap-2" aria-label={t('my.title')}>
        <TextLink href={`/${locale}/my/saved`}>{p('nav.saved')}</TextLink>
        <TextLink href={`/${locale}/my/saved/bookmarks`}>{p('nav.bookmarks')}</TextLink>
        <TextLink href={`/${locale}/my/saved/notes`}>{p('nav.notes')}</TextLink>
        <TextLink href={`/${locale}/my/saved/collections`}>
          {p('nav.collections')}
        </TextLink>
        <TextLink href={`/${locale}/my/history/reading`}>{p('nav.reading')}</TextLink>
        <TextLink href={`/${locale}/my/history/watch`}>{p('nav.watch')}</TextLink>
        <TextLink href={`/${locale}/my/progress/quran`}>{p('nav.quran')}</TextLink>
        <TextLink href={`/${locale}/my/notifications`}>{p('nav.notifications')}</TextLink>
        <TextLink href={`/${locale}/my/learning`}>{l('nav.learning')}</TextLink>
        <TextLink href={`/${locale}/my/progress/courses`}>{l('nav.progress')}</TextLink>
        <TextLink href={`/${locale}/my/classes`}>{c('nav.classes')}</TextLink>
        <TextLink href={`/${locale}/my/teachers`}>{c('nav.teachers')}</TextLink>
        <TextLink href={`/${locale}/my/messages`}>{m('nav.messages')}</TextLink>
        <TextLink href={`/${locale}/my/questions`}>{t('my.questions')}</TextLink>
        <TextLink href={`/${locale}/my/settings/profile`}>{t('my.profile')}</TextLink>
        <TextLink href={`/${locale}/my/settings/security`}>{t('my.security')}</TextLink>
        <TextLink href={`/${locale}/my/settings/language`}>{t('my.language')}</TextLink>
        <TextLink href={`/${locale}/my/settings/interests`}>
          {p('nav.interests')}
        </TextLink>
        <TextLink href={`/${locale}/my/settings/notifications`}>
          {p('nav.notificationSettings')}
        </TextLink>
        <TextLink href={`/${locale}/my/settings/privacy`}>{p('nav.privacy')}</TextLink>
      </nav>

      <SignOutForm locale={locale} label={t('my.signOut')} />
    </main>
  );
}
