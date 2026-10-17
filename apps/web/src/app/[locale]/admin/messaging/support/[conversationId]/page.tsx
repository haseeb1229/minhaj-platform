import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  Composer,
  ConversationBadges,
  HistoryNav,
  MessageThread,
  SendState,
  type ThreadMessage,
} from '@/components/messaging/parts';
import {
  readBefore,
  shortId,
  supportAttachmentHref,
} from '@/components/messaging/presentation';
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
import {
  claimSupportAction,
  resolveSupportAction,
  supportReplyAction,
} from '../../actions';
import { adminMessagingCopy, type Query } from '../../shared';

/**
 * One support conversation, as support staff read it (ROUTE_MAP.md §7;
 * DELIVERY_PLAN.md Phase 24) — under `messaging.support`.
 *
 * OPENING IT IS AUDITED. The service records the access — the operator, the
 * conversation, the key that authorised it, identifiers only — BEFORE it
 * returns any content, and records every further page of history the same
 * way. The page says so, so nobody opens a person's conversation believing it
 * goes unrecorded.
 *
 * ONE ACTIVE CLAIM. Only the operator who has claimed the conversation may
 * answer it; anyone holding the key may read it and claim it while nobody
 * has. Claiming and resolving carry the version the operator was shown.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function SupportConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly conversationId: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const { conversationId } = await params;
  const base = `/${locale}/admin/messaging/support`;
  const path = `${base}/${encodeURIComponent(conversationId)}`;
  const context = await requireAdminPage(locale, 'messaging.support', path);
  const copy = await adminMessagingCopy(locale);
  const { t } = copy;
  const m = await getTranslations({ locale, namespace: 'messages' });
  const before = readBefore(await searchParams);
  const actor = { accountId: context.session.account.id };
  const timeZone = context.session.account.timezone;
  const { service } = messagingRuntime();

  const read = await messagingRead('messaging-support-conversation', async () => {
    const detail = await service.supportConversation(actor, conversationId);
    const history = await service.supportHistory(actor, conversationId, before);
    return { detail, history };
  });

  const back = (
    <p>
      <TextLink href={base}>{t('support.back')}</TextLink>
    </p>
  );

  if (!read.ok) {
    if (['not-found', 'invalid', 'denied'].includes(read.failure)) notFound();
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('conversation.fallbackTitle')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  }

  const { detail, history } = read.value;
  const view = detail.conversation;
  const { summary } = view;
  const claimedByMe = detail.claimedByAccountId === actor.accountId;
  const names = await participantNames([
    detail.requesterAccountId,
    detail.claimedByAccountId,
    ...history.messages.map((message) => message.senderAccountId),
  ]);
  const requester = names.get(detail.requesterAccountId) ?? t('conversation.requester');
  const claimant =
    detail.claimedByAccountId === null
      ? t('support.unclaimed')
      : claimedByMe
        ? t('support.claimedByMe')
        : (names.get(detail.claimedByAccountId) ?? t('conversation.staff'));

  const messages: ThreadMessage[] = history.messages.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    own: message.own,
    sender: message.own
      ? m('you')
      : message.senderAccountId === detail.requesterAccountId
        ? requester
        : (names.get(message.senderAccountId) ?? t('conversation.staff')),
    body: message.body,
    withheld: message.withheld,
    sentAt: message.sentAt,
    attachments: message.attachments,
  }));
  const open = summary.state === 'open';

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('conversation.title', { id: shortId(summary.id) })}</PageHeading>
        <Alert tone="info">{t('conversation.audited')}</Alert>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('conversation.requesterTerm')}>
            <span dir="auto">{requester}</span>
          </DetailRow>
          <DetailRow term={t('support.column.state')}>
            <span className="flex flex-wrap gap-2">
              {open ? t('conversationState.open') : null}
              <ConversationBadges summary={summary} t={m} />
            </span>
          </DetailRow>
          <DetailRow term={t('support.column.claim')}>
            <span dir="auto">{claimant}</span>
          </DetailRow>
        </dl>
      </Panel>

      {open && detail.claimedByAccountId === null ? (
        <ActionForm
          action={claimSupportAction}
          submitLabel={t('conversation.claim')}
          pendingLabel={t('pending')}
          messages={{ ...copy.messages, success: t('conversation.claimed') }}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="conversationId" value={summary.id} />
          <input type="hidden" name="version" value={String(detail.version)} />
          <p className="text-sm">{t('conversation.claimHelp')}</p>
        </ActionForm>
      ) : null}

      <section aria-labelledby="support-thread" className="flex min-w-0 flex-col gap-4">
        <h2 id="support-thread" className="text-lg font-semibold tracking-tight">
          {m('thread.heading')}
        </h2>
        <HistoryNav path={path} before={history.before} current={before} t={m} />
        {messages.length === 0 ? (
          <EmptyState>
            {before === null ? t('conversation.empty') : m('thread.beyond')}
          </EmptyState>
        ) : (
          <MessageThread
            messages={messages}
            label={m('thread.label', { name: requester })}
            attachmentHref={supportAttachmentHref}
            locale={locale}
            timeZone={timeZone}
            t={m}
          />
        )}
      </section>

      {claimedByMe && before === null ? (
        view.canSend ? (
          <Composer
            action={supportReplyAction}
            locale={locale}
            conversationId={summary.id}
            t={m}
          />
        ) : (
          <SendState view={view} t={m} />
        )
      ) : open && !claimedByMe ? (
        <Alert tone="info">{t('conversation.replyNeedsClaim')}</Alert>
      ) : null}

      {open && claimedByMe ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('conversation.resolveHeading')}</SectionHeading>
            <p className="text-sm">{t('conversation.resolveHelp')}</p>
            <ActionForm
              action={resolveSupportAction}
              submitLabel={t('conversation.resolve')}
              pendingLabel={t('pending')}
              tone="secondary"
              messages={{ ...copy.messages, success: t('conversation.resolved') }}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="conversationId" value={summary.id} />
              <input type="hidden" name="version" value={String(detail.version)} />
              <ConfirmField
                id={`resolve-${summary.id}`}
                label={t('conversation.resolveConfirm')}
              />
            </ActionForm>
          </div>
        </Panel>
      ) : null}

      {back}
    </main>
  );
}
