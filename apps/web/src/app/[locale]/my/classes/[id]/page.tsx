import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { sessionIsFuture } from '@minhaj/contracts/learning';

import {
  AttendanceBadge,
  ClassSchedule,
  JoinLink,
  ParticipationBadge,
  SessionStateBadge,
  classMessages,
} from '@/components/my-classes/parts';
import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { ConfirmField } from '@/components/personal/parts';
import { Alert, Panel, SectionHeading, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { cancelBookingAction } from '../actions';

/**
 * One class the person may attend or attended (ROUTE_MAP.md §5.1; Phase 23).
 *
 * ONLY THE PERSON'S OWN PARTICIPATION OPENS IT. The class is read through the
 * session account's Enrolment or Booking, so somebody else's class — or a
 * guessed identifier — is this page's 404 exactly like one that does not
 * exist.
 *
 * THE JOIN LINK IS THE DISCLOSURE READ'S ANSWER, shown only when it returns
 * one. The person's own confirmed future trial may be cancelled here, under
 * the Booking version they are looking at.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'class');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyClassPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const path = localizedPath(locale, `/my/classes/${encodeURIComponent(id)}`);
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myClasses' });
  const actor = { accountId: session.account.id };

  const read = await learningRead('learning-my-class', async () => {
    const { myClasses } = learningRuntime();
    const entry = await myClasses.session(actor, id);
    if (entry === null) return null;
    const join =
      entry.session.state === 'scheduled' && entry.session.hasMeetingUrl
        ? await myClasses.meetingUrl(actor, entry.session.id)
        : null;
    return { entry, join };
  });
  if (!read.ok)
    return (
      <MyPage title={t('detail.fallbackTitle')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );
  if (read.value === null) notFound();

  const { entry, join } = read.value;
  const { course, booking } = entry;
  const timeZone = session.account.timezone;
  const cancellable =
    booking !== null &&
    booking.state === 'confirmed' &&
    sessionIsFuture(entry.session, new Date());
  const title = (
    <LearningTitle
      labels={course.labels}
      primaryLocale={course.primaryLocale}
      locale={locale}
    />
  );

  return (
    <MyPage
      title={title}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <ParticipationBadge entry={entry} t={t} />
          <SessionStateBadge state={entry.session.state} t={t} />
          {entry.attendance === null ? null : (
            <AttendanceBadge status={entry.attendance} t={t} />
          )}
        </div>
      }
    >
      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('detail.when')}</SectionHeading>
          <ClassSchedule
            session={entry.session}
            locale={locale}
            timeZone={timeZone}
            t={t}
          />
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-2">
          <SectionHeading>{t('detail.course')}</SectionHeading>
          {course.state === 'published' ? (
            <p>
              <TextLink
                href={localizedPath(
                  locale,
                  `/learn/courses/${encodeURIComponent(course.slug)}`,
                )}
              >
                {t('detail.coursePage')}
              </TextLink>
            </p>
          ) : (
            <p className="text-sm">{t('detail.courseUnavailable')}</p>
          )}
          {entry.participation === 'enrolment' ? (
            <p>
              <TextLink
                href={localizedPath(
                  locale,
                  `/my/learning/courses/${encodeURIComponent(course.slug)}`,
                )}
              >
                {t('detail.myCourse')}
              </TextLink>
            </p>
          ) : null}
        </div>
      </Panel>

      {entry.session.state === 'scheduled' ? (
        <Panel>
          <div className="flex flex-col gap-2">
            <SectionHeading>{t('detail.joining')}</SectionHeading>
            {join === null ? (
              <p className="text-sm">{t('detail.noJoin')}</p>
            ) : (
              <>
                <p className="text-sm">{t('detail.joinHelp')}</p>
                <p>
                  <JoinLink url={join} label={t('join')} />
                </p>
              </>
            )}
          </div>
        </Panel>
      ) : null}

      {cancellable ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('cancel.heading')}</SectionHeading>
            <p className="text-sm">{t('cancel.body')}</p>
            <ActionForm
              action={cancelBookingAction}
              submitLabel={t('cancel.submit')}
              pendingLabel={t('common.working')}
              tone="destructive"
              messages={classMessages(t, { success: t('cancel.done') })}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="version" value={String(booking.version)} />
              <ConfirmField id="cancel-booking" label={t('cancel.confirm')} />
            </ActionForm>
          </div>
        </Panel>
      ) : null}
    </MyPage>
  );
}
