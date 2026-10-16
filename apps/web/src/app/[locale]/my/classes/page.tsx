import { getTranslations } from 'next-intl/server';

import {
  CLASS_PAGE,
  sessionIsFuture,
  type LearnerClassView,
} from '@minhaj/contracts/learning';

import { Pagination } from '@/components/media/parts';
import {
  AttendanceBadge,
  ClassSchedule,
  JoinLink,
  ParticipationBadge,
  SessionStateBadge,
  classLinks,
  classMessages,
} from '@/components/my-classes/parts';
import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { ConfirmField, PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import {
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { Alert, EmptyState, Panel, SectionHeading, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
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
 */
export const metadata = { robots: { index: false, follow: false } };

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
  const path = `/${locale}/my/classes`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myClasses' });
  const offset = readPersonalOffset(await searchParams);
  const read = await learningRead('learning-my-classes', () =>
    classPanels(session.account.id, offset),
  );
  const back = <PersonalLinks label={t('nav.label')} links={classLinks(locale, t)} />;
  const description = <p>{t('description')}</p>;

  if (!read.ok)
    return (
      <PersonalFrame title={t('title')} description={description} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const { activated, upcoming, past, joins } = read.value;
  const timeZone = session.account.timezone;
  const now = new Date();

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
        href={`/${locale}/learn/courses/${encodeURIComponent(entry.course.slug)}`}
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

  return (
    <PersonalFrame title={t('title')} description={description} back={back}>
      {activated ? null : <Alert tone="info">{t('notActivated')}</Alert>}

      {/* ---- Upcoming ---------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="classes-upcoming">
        <span id="classes-upcoming">
          <SectionHeading>{t('upcoming.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('upcoming.help')}
        </p>
        {upcoming.length === 0 ? (
          <EmptyState>{t('upcoming.empty')}</EmptyState>
        ) : (
          <ol aria-label={t('upcoming.heading')} className="flex flex-col gap-3">
            {upcoming.map((entry) => {
              const join = joins.get(entry.session.id);
              return (
                <Panel key={entry.session.id} as="li">
                  <div className="flex min-w-0 flex-col gap-3">
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
        )}
      </section>

      {/* ---- Past -------------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="classes-past">
        <span id="classes-past">
          <SectionHeading>{t('past.heading')}</SectionHeading>
        </span>
        {past.items.length === 0 ? (
          <EmptyState>{offset === 0 ? t('past.empty') : t('list.beyond')}</EmptyState>
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
        <Pagination
          label={t('past.heading')}
          previous={
            offset === 0
              ? null
              : personalOffsetHref(path, Math.max(0, offset - CLASS_PAGE))
          }
          next={past.hasMore ? personalOffsetHref(path, offset + CLASS_PAGE) : null}
          previousLabel={t('list.previous')}
          nextLabel={t('list.next')}
        />
      </section>
    </PersonalFrame>
  );
}
