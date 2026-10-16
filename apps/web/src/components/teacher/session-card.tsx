import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { ClassSessionView } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { Panel, TextLink } from '@/components/ui';
import { ClassTime, SessionStateBadge, type TeacherTranslator } from './parts';
import { needsMeeting } from './presentation';

/**
 * One class as every Teacher-area list shows it: its Course, kind and state
 * in words, both of its times, whether a learner could join it yet, and the
 * way into its detail page. NEVER the meeting address — the card knows only
 * that one is held (`hasMeetingUrl`), which is all a list may know (§11).
 */
export function SessionCard({
  view,
  locale,
  accountZone,
  t,
}: {
  readonly view: ClassSessionView;
  readonly locale: Locale;
  readonly accountZone: string | null;
  readonly t: TeacherTranslator;
}) {
  const { session, course } = view;
  const href = `/${locale}/teacher/classes/today/${encodeURIComponent(session.id)}`;
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <TextLink href={href}>
            <LearningTitle
              labels={course.labels}
              primaryLocale={course.primaryLocale}
              locale={locale}
            />
          </TextLink>
          <span className="text-sm text-[color:var(--color-foreground-muted)]">
            {t(`kind.${session.kind}`)}
          </span>
          <SessionStateBadge state={session.state} t={t} />
        </div>
        <ClassTime session={session} locale={locale} accountZone={accountZone} t={t} />
        {needsMeeting(session) ? (
          <p className="text-sm font-medium">{t('meeting.none')}</p>
        ) : null}
      </div>
    </Panel>
  );
}
