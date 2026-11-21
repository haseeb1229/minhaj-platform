import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  CLASS_PAGE,
  LEARNER_OFFSET_MAX,
  sessionIsFuture,
  type LearnerClassView,
} from '@minhaj/contracts/learning';

import {
  AttendanceBadge,
  classLinks,
  classMessages,
  ClassSchedule,
  JoinLink,
  ParticipationBadge,
  SessionStateBadge,
} from '@/components/my-classes/parts';
import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { ConfirmField } from '@/components/personal/parts';
import { Alert, EmptyState, Panel, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { MyPage, MySection, OnwardLink } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { MyFigures } from '@/components/my/summary-parts';
import { relativeDay, zonedDate } from '@/components/my/time';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { requireActiveSession } from '../guard';
import { cancelBookingAction } from './actions';

/**
 * My Classes — the person's own upcoming and past classes (ROUTE_MAP.md §5.1;
 * DELIVERY_PLAN.md Phase 23).
 *
 * THE ACCOUNT IS THE SESSION'S. Every class here is one the person may attend
 * through a current Enrolment or their own confirmed trial Booking; the
 * adapter keys every read by the account, so nothing a URL names widens it.
 *
 * THE JOIN LINK IS THE DISCLOSURE READ'S ANSWER. It is asked only for a
 * scheduled upcoming class that holds an address, and shown only when the
 * read returns one — activation in force, teacher's scope current, the person
 * a current participant. Otherwise there is no link and no hint of one.
 *
 * HONEST WHILE SWITCHED OFF. When live learning is not activated the page says
 * so in words rather than listing an empty week.
 *
 * MY MINHAJ PART 2: Classes and Teachers as tabs, the trail, the figures that
 * are true (the upcoming classes while they fit the one bounded read, the past
 * ones from Learning's own total), each upcoming class naming its day
 * ("Today", "Tomorrow", a date) in the person's zone, and the past classes
 * numbered (`?page=`, Learning's page of 24; the legacy `?offset=` is one
 * redirect after the session is resolved).
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'classes');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

async function classPanels(accountId: string, offset: number) {
  const actor = { accountId };
  const { myClasses } = learningRuntime();
  const [activated, upcoming, past] = await Promise.all([
    myClasses.activated(),
    myClasses.upcoming(actor),
    myClasses.past(actor, offset),
  ]);
  // The disclosure read, once per class that holds an address — never listed.
  const joins = new Map<string, string>();
  for (const entry of upcoming) {
    if (!entry.session.hasMeetingUrl) continue;
    const url = await myClasses.meetingUrl(actor, entry.session.id);
    if (url !== null) joins.set(entry.session.id, url);
  }
  return { activated, upcoming, past, joins };
}

export default async function MyClassesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/classes');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myClasses' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const spec: MyListSpec<never> = {
    path,
    size: CLASS_PAGE,
    offsetMax: LEARNER_OFFSET_MAX,
  };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const schedulePath = localizedPath(locale, '/learn/live');
  const frame = {
    // The live schedule is this page's own action; it is not repeated at its foot.
    related: {
      label: t('nav.label'),
      links: classLinks(locale, t).filter((link) => link.href !== schedulePath),
    },
    title: t('title'),
    description: <p>{t('description')}</p>,
    action: <OnwardLink href={schedulePath}>{t('nav.schedule')}</OnwardLink>,
    tabs: {
      label: my('tabs.label.classes'),
      items: myTabs(locale, 'classes', 'classes', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: my('trail.classes') }]),
    },
  };

  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );

  const view = asked.view;
  const read = await learningRead('learning-my-classes', () =>
    classPanels(session.account.id, myListOffset(view.page, spec)),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const { activated, upcoming, past, joins } = read.value;
  const timeZone = session.account.timezone;
  const now = new Date();
  const number = new Intl.NumberFormat(locale);
  const range = myListRange(view.page, past.items.length, spec);
  // The upcoming read is bounded: its length is a count only while it fits.
  const upcomingWhole = upcoming.length < CLASS_PAGE;
  const firstRun = upcoming.length === 0 && past.total === 0;

  const courseTitle = (entry: LearnerClassView) => {
    const title = (
      <LearningTitle
        labels={entry.course.labels}
        primaryLocale={entry.course.primaryLocale}
        locale={locale}
      />
    );
    return entry.course.state === 'published' ? (
      <TextLink
        href={localizedPath(
          locale,
          `/learn/courses/${encodeURIComponent(entry.course.slug)}`,
        )}
      >
        {title}
      </TextLink>
    ) : (
      title
    );
  };

  const cancelForm = (entry: LearnerClassView) => {
    const { booking } = entry;
    if (
      booking === null ||
      booking.state !== 'confirmed' ||
      !sessionIsFuture(entry.session, now)
    )
      return null;
    const id = `cancel-${booking.id}`;
    return (
      <ActionForm
        action={cancelBookingAction}
        submitLabel={t('cancel.submit')}
        pendingLabel={t('common.working')}
        tone="secondary"
        messages={classMessages(t, { success: t('cancel.done') })}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="bookingId" value={booking.id} />
        <input type="hidden" name="version" value={String(booking.version)} />
        <ConfirmField id={id} label={t('cancel.confirm')} />
      </ActionForm>
    );
  };

  // Each upcoming class names its day in the person's own zone.
  const dayName = (startsAt: Date) => {
    const relative = relativeDay(startsAt, now, timeZone);
    return relative === 'today'
      ? my('classesPage.today')
      : relative === 'tomorrow'
        ? my('classesPage.tomorrow')
        : zonedDate(startsAt, locale, timeZone);
  };

  return (
    <MyPage
      {...frame}
      announce={{
        value: `${String(upcoming.length)}:${String(past.total)}`,
        message: my('live.classes', { upcoming: upcoming.length, past: past.total }),
      }}
    >
      {activated ? null : <Alert tone="info">{t('notActivated')}</Alert>}

      {firstRun ? null : (
        <MyFigures
          label={my('classesPage.figures')}
          figures={[
            ...(upcomingWhole
              ? [
                  {
                    key: 'upcoming',
                    value: number.format(upcoming.length),
                    label: my('classesPage.upcoming'),
                  },
                ]
              : []),
            {
              key: 'past',
              value: number.format(past.total),
              label: my('classesPage.past'),
            },
          ]}
        />
      )}

      {/* ---- Upcoming ---------------------------------------------------- */}

      <MySection
        id="classes-upcoming"
        heading={t('upcoming.heading')}
        intro={t('upcoming.help')}
      >
        {upcoming.length === 0 ? (
          <EmptyState
            icon="calendar"
            {...(firstRun ? { title: my('classesPage.emptyTitle') } : {})}
            action={{ href: schedulePath, text: t('nav.schedule') }}
          >
            {t('upcoming.empty')} {firstRun ? my('classesPage.emptyHow') : null}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {upcomingWhole ? null : (
              <p className="text-sm text-foreground-muted">
                {my('classesPage.nextOnly', { count: CLASS_PAGE })}
              </p>
            )}
            <ol aria-label={t('upcoming.heading')} className="flex flex-col gap-3">
              {upcoming.map((entry) => {
                const join = joins.get(entry.session.id);
                return (
                  <Panel key={entry.session.id} as="li">
                    <div className="flex min-w-0 flex-col gap-3">
                      <p className="text-sm font-semibold text-accent">
                        {dayName(entry.session.startsAt)}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <ParticipationBadge entry={entry} t={t} />
                        <SessionStateBadge state={entry.session.state} t={t} />
                      </div>
                      <p className="text-lg font-semibold">{courseTitle(entry)}</p>
                      <ClassSchedule
                        session={entry.session}
                        locale={locale}
                        timeZone={timeZone}
                        t={t}
                      />
                      <p>
                        <TextLink href={`${path}/${entry.session.id}`}>
                          {t('upcoming.detail', {
                            title:
                              pickLabel(
                                entry.course.labels,
                                locale,
                                entry.course.primaryLocale,
                              )?.title ?? '',
                          })}
                        </TextLink>
                      </p>
                      {join === undefined ? null : (
                        <p>
                          <JoinLink url={join} label={t('join')} />
                        </p>
                      )}
                      {cancelForm(entry)}
                    </div>
                  </Panel>
                );
              })}
            </ol>
          </div>
        )}
      </MySection>

      {/* ---- Past -------------------------------------------------------- */}

      <MySection id="classes-past" heading={t('past.heading')}>
        {range === null ? null : (
          <MyListStatus>
            {my('count.pastClasses', { ...range, total: past.total })}
          </MyListStatus>
        )}
        {past.items.length === 0 ? (
          past.total === 0 ? (
            <EmptyState>{t('past.empty')}</EmptyState>
          ) : (
            <MyListBeyond
              text={my('list.beyond')}
              first={myListHref(spec, { page: 1, filter: null })}
              firstText={my('list.first')}
            />
          )
        ) : (
          <ol aria-label={t('past.heading')} className="flex flex-col gap-3">
            {past.items.map((entry) => (
              <Panel key={entry.session.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ParticipationBadge entry={entry} t={t} />
                    <SessionStateBadge state={entry.session.state} t={t} />
                    {entry.attendance === null ? null : (
                      <AttendanceBadge status={entry.attendance} t={t} />
                    )}
                  </div>
                  <p className="font-semibold">
                    <TextLink href={`${path}/${entry.session.id}`}>
                      <LearningTitle
                        labels={entry.course.labels}
                        primaryLocale={entry.course.primaryLocale}
                        locale={locale}
                      />
                    </TextLink>
                  </p>
                  <ClassSchedule
                    session={entry.session}
                    locale={locale}
                    timeZone={timeZone}
                    t={t}
                  />
                </div>
              </Panel>
            ))}
          </ol>
        )}
        <MyListPager
          label={t('past.heading')}
          spec={spec}
          view={view}
          total={past.total}
          locale={locale}
          words={{
            previous: t('list.previous'),
            next: t('list.next'),
            page: (page) => my('list.page', { page }),
          }}
        />
      </MySection>
    </MyPage>
  );
}
