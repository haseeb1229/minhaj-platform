import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  MessageThread,
  MessagingTime,
  type ThreadMessage,
} from '@/components/messaging/parts';
import { evidenceAttachmentHref, shortId } from '@/components/messaging/presentation';
import { messagingRead, participantNames } from '@/components/messaging/read';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { decideReportAction } from '../../actions';
import { ReportStateBadge, adminMessagingCopy, reportTarget } from '../../shared';

/**
 * One report and the evidence it authorises (ROUTE_MAP.md §7;
 * DELIVERY_PLAN.md Phase 24) — under `messaging.moderate`.
 *
 * BOUNDED, AND ONLY THIS REPORT'S. A message report opens the reported message
 * and up to ten either side of it; a conversation report opens the thirty
 * messages up to the moment it was filed. Nothing outside that window is
 * reachable from here, and the service AUDITS the access — the moderator, the
 * report and the key, identifiers only — before it returns a byte. A withheld
 * message is still shown here, marked, because it is evidence.
 *
 * THE DECISION IS ONE OF THREE NAMED ACTS — dismiss, withhold the reported
 * message, or close the conversation — taken once, under the version the
 * moderator was shown and after an explicit confirmation. No strike, ban or
 * escalation exists (OPEN_DECISIONS.md §6.6).
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function ReportEvidencePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly reportId: string }>;
}) {
  const locale = await requireLocale(params);
  const { reportId } = await params;
  const path = `/${locale}/admin/messaging/reports/${encodeURIComponent(reportId)}`;
  const context = await requireAdminPage(locale, 'messaging.moderate', path);
  const copy = await adminMessagingCopy(locale);
  const { t } = copy;
  const m = await getTranslations({ locale, namespace: 'messages' });
  const actor = { accountId: context.session.account.id };
  const timeZone = context.session.account.timezone;

  const read = await messagingRead('messaging-evidence', () =>
    messagingRuntime().service.evidence(actor, reportId),
  );
  const back = (
    <p className="flex flex-wrap gap-x-6 gap-y-2">
      <TextLink href={`/${locale}/admin/messaging/moderation`}>
        {t('evidence.backQueue')}
      </TextLink>
      <TextLink href={`/${locale}/admin/messaging/reports`}>
        {t('evidence.backReports')}
      </TextLink>
    </p>
  );

  if (!read.ok) {
    if (['not-found', 'invalid', 'denied'].includes(read.failure)) notFound();
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('evidence.fallbackTitle')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  }

  const evidence = read.value;
  const { report, conversation, decision } = evidence;
  const names = await participantNames([
    evidence.reporterAccountId,
    ...evidence.messages.map((message) => message.senderAccountId),
  ]);
  const nameOf = (accountId: string) => names.get(accountId) ?? t('evidence.participant');

  const messages: ThreadMessage[] = evidence.messages.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    own: false,
    sender: nameOf(message.senderAccountId),
    body: message.body,
    withheld: message.withheld,
    sentAt: message.sentAt,
    attachments: message.attachments,
    highlighted: message.reported,
  }));
  const actions =
    report.messageId === null
      ? (['dismiss', 'close-conversation'] as const)
      : (['dismiss', 'withhold-message', 'close-conversation'] as const);

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('evidence.title', { id: shortId(report.id) })}</PageHeading>
        <Alert tone="info">{t('evidence.audited')}</Alert>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('reports.column.reason')}>
            {t(`reason.${report.reason}`)}
          </DetailRow>
          <DetailRow term={t('reports.column.target')}>
            {reportTarget(report, copy)}
          </DetailRow>
          <DetailRow term={t('reports.column.state')}>
            <ReportStateBadge state={report.state} copy={copy} />
          </DetailRow>
          <DetailRow term={t('reports.column.filed')}>
            <MessagingTime value={report.createdAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
          <DetailRow term={t('evidence.reporter')}>
            <span dir="auto">{nameOf(evidence.reporterAccountId)}</span>
          </DetailRow>
          <DetailRow term={t('reports.column.kind')}>
            {t(`kind.${conversation.kind}`)} ·{' '}
            {conversation.state === 'open'
              ? t('conversationState.open')
              : conversation.closedReason === 'moderation'
                ? t('conversationState.moderation')
                : conversation.closedReason === 'resolved'
                  ? t('conversationState.resolved')
                  : t('conversationState.closed')}
          </DetailRow>
          <DetailRow term={t('evidence.conversation')}>
            <span className="font-mono" dir="ltr">
              {shortId(conversation.id)}
            </span>
          </DetailRow>
        </dl>
      </Panel>

      <section
        aria-labelledby="evidence-messages"
        className="flex min-w-0 flex-col gap-3"
      >
        <h2 id="evidence-messages" className="text-lg font-semibold tracking-tight">
          {t('evidence.messages')}
        </h2>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {report.messageId === null
            ? t('evidence.windowConversation')
            : t('evidence.windowMessage')}
        </p>
        {messages.length === 0 ? (
          <EmptyState>{t('evidence.empty')}</EmptyState>
        ) : (
          <MessageThread
            messages={messages}
            label={t('evidence.messages')}
            attachmentHref={(attachmentId) =>
              evidenceAttachmentHref(report.id, attachmentId)
            }
            locale={locale}
            timeZone={timeZone}
            t={m}
          />
        )}
      </section>

      {decision === null ? null : (
        <Panel>
          <div className="flex flex-col gap-2">
            <SectionHeading>{t('decision.heading')}</SectionHeading>
            <p className="text-sm">
              {t(`decision.done.${decision.action}`)}{' '}
              <MessagingTime
                value={decision.decidedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </p>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {decision.moderatorAccountId === actor.accountId
                ? t('decision.byYou')
                : t('decision.byModerator')}
            </p>
          </div>
        </Panel>
      )}

      {report.state === 'open' ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('decision.heading')}</SectionHeading>
            <p className="text-sm">{t('decision.help')}</p>
            <ActionForm
              action={decideReportAction}
              submitLabel={t('decision.submit')}
              pendingLabel={t('pending')}
              messages={{ ...copy.messages, success: t('decision.saved') }}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="version" value={String(report.version)} />
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="pb-1 text-sm font-medium">
                  {t('decision.action')}
                </legend>
                {actions.map((action, index) => (
                  <label key={action} className="flex min-h-11 items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="action"
                      value={action}
                      required
                      defaultChecked={index === 0}
                      className="mt-1 size-5"
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {t(`decision.option.${action}`)}
                      </span>
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t(`decision.explain.${action}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <ConfirmField id={`decide-${report.id}`} label={t('decision.confirm')} />
            </ActionForm>
          </div>
        </Panel>
      ) : null}

      {back}
    </main>
  );
}
