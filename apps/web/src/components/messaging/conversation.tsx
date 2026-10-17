import 'server-only';

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { MessagingSurface } from '@minhaj/contracts/messaging';

import { ActionForm, type FormActionState } from '@/app/[locale]/(identity)/form-state';
import { PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { TeacherFrame } from '@/components/teacher/parts';
import { Alert, EmptyState, TextLink } from '@/components/ui';
import { messagingRuntime } from '@/composition/messaging';
import { CatchUpButton } from './catch-up.client';
import { MarkReadOnView } from './mark-read.client';
import {
  Composer,
  ConversationBadges,
  CourseLine,
  HistoryNav,
  MessageThread,
  ReportMessage,
  SafetyPanel,
  SendState,
  UnreadBadge,
  counterpartName,
  messagingLinks,
  messagingMessages,
  type MessagingTranslator,
  type ThreadMessage,
} from './parts';
import {
  conversationPath,
  conversationsPath,
  participantAttachmentHref,
} from './presentation';
import { courseListings, messagingRead, participantNames } from './read';

/**
 * One conversation, as a participant reads it — on `/my/messages/{id}` and
 * `/teacher/messages/{id}` alike (DELIVERY_PLAN.md Phase 24).
 *
 * THE SERVICE DECIDES ON THIS REQUEST. The conversation and its history are
 * read through Messaging, which re-asks — now — whether this account still
 * takes part, whether the kind is switched on, whether the teaching
 * relationship is current and whether the conversation is open and
 * unblocked. Three answers shape the page:
 *
 *   - not yours, not switched on, or not there — the SAME 404, so a guessed
 *     identifier learns nothing;
 *   - yours, but the relationship has ENDED — that one sentence and nothing
 *     else: no name, no Course, no message;
 *   - yours — the messages, and whatever the reader may do now, with the
 *     reason in words when sending is not one of them.
 *
 * DELIVERY IS ON REFRESH. "Check for new messages" asks the durable catch-up
 * read and re-renders; nothing polls. The newest page, once shown, is marked
 * read — by the island after mount, or by a plain form without JavaScript.
 */

type Action = (state: FormActionState, form: FormData) => Promise<FormActionState>;

export interface ConversationActions {
  readonly send: Action;
  readonly markRead: Action;
  readonly block: Action;
  readonly unblock: Action;
  readonly report: Action;
}

function Frame({
  surface,
  locale,
  t,
  title,
  description,
  children,
}: {
  readonly surface: MessagingSurface;
  readonly locale: Locale;
  readonly t: MessagingTranslator;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}) {
  if (surface === 'teacher')
    return (
      <TeacherFrame title={title} {...(description === undefined ? {} : { description })}>
        {children}
        <p>
          <TextLink href={conversationsPath('teacher', locale)}>
            {t('thread.back')}
          </TextLink>
        </p>
      </TeacherFrame>
    );
  return (
    <PersonalFrame
      title={title}
      {...(description === undefined ? {} : { description })}
      back={<PersonalLinks label={t('nav.label')} links={messagingLinks(locale, t)} />}
    >
      {children}
    </PersonalFrame>
  );
}

export async function ConversationScreen({
  surface,
  locale,
  accountId,
  timeZone,
  conversationId,
  before,
  actions,
}: {
  readonly surface: MessagingSurface;
  readonly locale: Locale;
  readonly accountId: string;
  readonly timeZone: string | null;
  readonly conversationId: string;
  /** `?before=` — an older page, or `null` for the newest. */
  readonly before: number | null;
  readonly actions: ConversationActions;
}) {
  const t = await getTranslations({ locale, namespace: 'messages' });
  const actor = { accountId };
  const { service } = messagingRuntime();

  const read = await messagingRead('messaging-conversation', async () => {
    const view = await service.conversation(actor, conversationId);
    const history = await service.history(actor, conversationId, before);
    return { view, history };
  });

  if (!read.ok) {
    if (read.failure === 'not-found' || read.failure === 'invalid') notFound();
    if (read.failure === 'ended')
      return (
        <Frame surface={surface} locale={locale} t={t} title={t('ended.title')}>
          <Alert tone="info">{t('ended.body')}</Alert>
        </Frame>
      );
    return (
      <Frame surface={surface} locale={locale} t={t} title={t('thread.fallbackTitle')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </Frame>
    );
  }

  const { view, history } = read.value;
  const { summary } = view;
  const direct = summary.kind !== 'support';
  const [names, courses] = await Promise.all([
    direct ? participantNames([summary.counterpartAccountId]) : new Map<string, string>(),
    direct ? courseListings(surface, accountId) : new Map(),
  ]);
  const name = counterpartName(summary, names, t);
  const path = conversationPath(surface, locale, summary.id);
  const newest = before === null;
  const lastShown = history.messages.at(-1)?.sequence ?? summary.lastSequence;

  const messages: ThreadMessage[] = history.messages.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    own: message.own,
    sender: message.own ? t('you') : name,
    body: message.body,
    withheld: message.withheld,
    sentAt: message.sentAt,
    attachments: message.attachments,
  }));

  const description = (
    <>
      {direct ? (
        <CourseLine courseId={summary.courseId} courses={courses} locale={locale} t={t} />
      ) : (
        <p>{t('support.threadDescription')}</p>
      )}
      <p className="flex flex-wrap items-center gap-2">
        <UnreadBadge count={summary.unread} t={t} />
        <ConversationBadges summary={summary} t={t} />
      </p>
    </>
  );

  return (
    <Frame
      surface={surface}
      locale={locale}
      t={t}
      title={
        <span dir="auto" className="wrap-anywhere">
          {name}
        </span>
      }
      description={description}
    >
      <SendState view={view} t={t} />

      <section aria-labelledby="thread-heading" className="flex min-w-0 flex-col gap-4">
        <h2 id="thread-heading" className="text-lg font-semibold tracking-tight">
          {t('thread.heading')}
        </h2>
        <HistoryNav path={path} before={history.before} current={before} t={t} />
        {messages.length === 0 ? (
          <EmptyState>{newest ? t('thread.empty') : t('thread.beyond')}</EmptyState>
        ) : (
          <MessageThread
            messages={messages}
            label={t('thread.label', { name })}
            attachmentHref={participantAttachmentHref}
            locale={locale}
            timeZone={timeZone}
            t={t}
            after={(message) =>
              message.own || message.withheld ? null : (
                <ReportMessage
                  action={actions.report}
                  locale={locale}
                  conversationId={summary.id}
                  messageId={message.id}
                  t={t}
                />
              )
            }
          />
        )}
        {newest && summary.access === 'available' && summary.state === 'open' ? (
          <CatchUpButton
            conversationId={summary.id}
            after={lastShown}
            locale={locale}
            labels={{
              button: t('catchUp.button'),
              checking: t('catchUp.checking'),
              none: t('catchUp.none'),
              found: t('catchUp.found', { count: '{count}' }),
              more: t('catchUp.more'),
              failures: messagingMessages(t),
            }}
          />
        ) : null}
        {newest && summary.unread > 0 ? (
          <>
            <MarkReadOnView
              action={actions.markRead}
              locale={locale}
              conversationId={summary.id}
              sequence={lastShown}
            />
            <ActionForm
              action={actions.markRead}
              submitLabel={t('read.mark')}
              pendingLabel={t('common.working')}
              tone="secondary"
              messages={messagingMessages(t, { success: t('read.done') })}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="conversationId" value={summary.id} />
              <input type="hidden" name="sequence" value={String(lastShown)} />
            </ActionForm>
          </>
        ) : null}
      </section>

      {newest && view.canSend ? (
        <Composer
          action={actions.send}
          locale={locale}
          conversationId={summary.id}
          t={t}
        />
      ) : null}
      {!newest && view.canSend ? (
        <p>
          <TextLink href={path}>{t('thread.replyNewest')}</TextLink>
        </p>
      ) : null}

      <SafetyPanel
        view={view}
        name={name}
        locale={locale}
        t={t}
        actions={{
          block: actions.block,
          unblock: actions.unblock,
          report: actions.report,
        }}
      />
    </Frame>
  );
}
