import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import { teacherLinks } from '@/components/teacher/nav';
import { NotActivated, TeacherFrame, TeacherLinks } from '@/components/teacher/parts';
import { dayBounds, needsMeeting, ownZone } from '@/components/teacher/presentation';
import { collectPages } from '@/components/teacher/read';
import { SessionCard } from '@/components/teacher/session-card';
import { Alert, Panel, SectionHeading, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from './guard';

/**
 * The Teacher area's landing (ROUTE_MAP.md §6): how many classes today, the
 * next one, how many upcoming classes a learner could not yet join because no
 * meeting link is set, and the way into each section.
 *
 * COUNTS ARE OF THE TEACHER'S OWN CURRENT SCOPES, read live. The pending count
 * walks the 62-day calendar in bounded pages; when the bound is hit it is
 * reported as "or more", never as an exact number it is not.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const CALENDAR_PAGES = 10;

export default async function TeacherOverviewPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, `/${locale}/teacher`);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const { teaching } = learningRuntime();
  const accountZone = gate.session.account.timezone;
  const day = dayBounds(new Date(), ownZone(accountZone));
  const [today, upcoming] = await Promise.all([
    learningRead('teaching-overview-today', () =>
      teaching.today(gate.actor, day.from, day.to),
    ),
    learningRead('teaching-overview-calendar', () =>
      collectPages(
        (offset) => teaching.calendar(gate.actor, null, offset),
        CALENDAR_PAGES,
      ),
    ),
  ]);
  const next = upcoming.ok
    ? upcoming.value.items.find((view) => view.session.state === 'scheduled')
    : undefined;
  const pending = upcoming.ok
    ? upcoming.value.items.filter((view) => needsMeeting(view.session))
    : [];

  return (
    <TeacherFrame title={t('title')} description={<p>{t('description')}</p>}>
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3" aria-labelledby="overview-today">
          <span id="overview-today">
            <SectionHeading>{t('overview.today')}</SectionHeading>
          </span>
          {today.ok ? (
            <Panel>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">
                  {today.value.items.length === 0
                    ? t('overview.todayNone')
                    : t('overview.todayCount', {
                        count: String(today.value.items.length),
                      })}
                </span>
                <TextLink href={`/${locale}/teacher/classes/today`}>
                  {t('overview.todayLink')}
                </TextLink>
              </p>
            </Panel>
          ) : (
            <Alert tone="error">{t('overview.unavailable')}</Alert>
          )}
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="overview-next">
          <span id="overview-next">
            <SectionHeading>{t('overview.next')}</SectionHeading>
          </span>
          {!upcoming.ok ? (
            <Alert tone="error">{t('overview.unavailable')}</Alert>
          ) : next === undefined ? (
            <Panel>
              <p>{t('overview.nextNone')}</p>
            </Panel>
          ) : (
            <ul className="flex flex-col gap-3" aria-label={t('overview.next')}>
              <SessionCard view={next} locale={locale} accountZone={accountZone} t={t} />
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="overview-pending">
        <span id="overview-pending">
          <SectionHeading>{t('overview.pending')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('overview.pendingHelp')}
        </p>
        {!upcoming.ok ? (
          <Alert tone="error">{t('overview.unavailable')}</Alert>
        ) : pending.length === 0 ? (
          <Panel>
            <p>{t('overview.pendingNone')}</p>
          </Panel>
        ) : (
          <>
            <p className="font-medium">
              {t('overview.pendingCount', {
                count: upcoming.value.truncated
                  ? `${String(pending.length)}+`
                  : String(pending.length),
              })}
            </p>
            <ul className="flex flex-col gap-3" aria-label={t('overview.pending')}>
              {pending.map((view) => (
                <SessionCard
                  key={view.session.id}
                  view={view}
                  locale={locale}
                  accountZone={accountZone}
                  t={t}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="overview-sections">
        <span id="overview-sections">
          <SectionHeading>{t('overview.sections')}</SectionHeading>
        </span>
        <TeacherLinks
          label={t('overview.sections')}
          links={teacherLinks(locale, t).filter((link) => link.key !== 'overview')}
        />
      </section>
    </TeacherFrame>
  );
}
