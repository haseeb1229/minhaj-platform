import 'server-only';

import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { CourseListing } from '@minhaj/contracts/learning';
import {
  MESSAGING_LIMITS,
  REPORT_REASONS,
  type ConversationSummary,
  type ConversationView,
  type MessagingSurface,
} from '@minhaj/contracts/messaging';

import { ActionForm, type FormActionState } from '@/app/[locale]/(identity)/form-state';
import { LearningTitle } from '@/components/my-learning/parts';
import { ConfirmField } from '@/components/personal/parts';
import { displayTimeZone } from '@/components/personal/presentation';
import { Alert, Field, Panel, Select, StatusBadge, TextLink } from '@/components/ui';
import { MessageComposer, type ComposerLabels } from './composer.client';
import { conversationPath } from './presentation';
import {
  ThreadItem,
  ThreadList,
  ThreadTime,
  type ThreadLabels,
  type ThreadMessage,
} from './thread';

/**
 * The parts every Messaging surface shares — a person's own, a teacher's, and
 * the support staff's and moderators' views (DELIVERY_PLAN.md Phase 24).
 *
 * A MESSAGE IS TEXT, RENDERED AS TEXT. A body reaches the page as a React text
 * node — escaped, never parsed as markup or Markdown, never turned into a
 * link preview. It keeps its own line breaks (`whitespace-pre-line`), may
 * break anywhere rather than widen a phone-width screen (`wrap-anywhere`), and
 * declares no direction of its own (`dir="auto"`), so an Urdu message in an
 * English interface reads right to left and an English one in Arabic reads
 * left to right.
 *
 * STATE IS WORDS. "2 unread messages", "Closed by a moderator", "Read only":
 * each is text in a badge or an alert; no tone carries meaning on its own
 * (SECURITY_BASELINE.md §16.1). Whose message is whose is said by its sender
 * line, not only by which side it sits on.
 *
 * A WITHHELD MESSAGE IS A NEUTRAL SENTENCE. The service returns no body for
 * it; the page says a moderator withheld it, and nothing about what it said.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`): own messages sit at the inline END,
 * others at the START, in every script.
 */

export type MessagingTranslator = Awaited<ReturnType<typeof getTranslations<'messages'>>>;

interface Link {
  readonly href: string;
  readonly text: string;
}

/** The neighbouring pages each person-facing Messaging page links to. */
export function messagingLinks(locale: Locale, t: MessagingTranslator): readonly Link[] {
  return [
    { href: `/${locale}/my/messages`, text: t('nav.messages') },
    { href: `/${locale}/my/messages/support`, text: t('nav.support') },
    { href: `/${locale}/my/teachers`, text: t('nav.teachers') },
    { href: `/${locale}/my`, text: t('nav.account') },
  ];
}

/**
 * The words for every refusal a Messaging action can return — a category,
 * never content; `overrides` gives one form its own wording.
 */
export function messagingMessages(
  t: MessagingTranslator,
  overrides: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return {
    invalid: t('failure.invalid'),
    'not-found': t('failure.notFound'),
    ended: t('failure.ended'),
    closed: t('failure.closed'),
    blocked: t('failure.blocked'),
    terminal: t('failure.terminal'),
    unclaimed: t('failure.unclaimed'),
    'operation-conflict': t('failure.operationConflict'),
    conflict: t('failure.conflict'),
    'rate-limited': t('failure.rateLimited'),
    'too-many': t('failure.tooMany'),
    'too-large': t('failure.tooLarge'),
    unsupported: t('failure.unsupported'),
    'not-cleared': t('failure.notCleared'),
    denied: t('failure.denied'),
    'confirm-required': t('failure.confirmRequired'),
    'no-session': t('failure.noSession'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
    ...overrides,
  };
}

/** An instant, in the interface locale and the reader's own time zone. */
export function MessagingTime({
  value,
  locale,
  timeZone,
}: {
  readonly value: Date;
  readonly locale: Locale;
  readonly timeZone: string | null;
}) {
  return (
    <ThreadTime value={value} locale={locale} timeZone={displayTimeZone(timeZone)} />
  );
}

/** The words a thread speaks with — the same ones the realtime island is handed. */
export function threadLabels(t: MessagingTranslator): ThreadLabels {
  return {
    messageFrom: t('thread.messageFrom', { name: '{name}' }),
    reported: t('thread.reported'),
    withheldBadge: t('thread.withheldBadge'),
    withheld: t('thread.withheld'),
    attachments: t('thread.attachments'),
    unnamedFile: t('thread.unnamedFile'),
    image: t('thread.image'),
    download: t('thread.download', { name: '{name}', size: '{size}' }),
  };
}

/**
 * Who the other side of a conversation is, as the reader sees it. Support is
 * the organisation — "Minhaj Support" — never the name of whoever answered.
 * A person Identity does not name (a closed account) is their role, in words.
 */
export function counterpartName(
  summary: Pick<ConversationSummary, 'kind' | 'role' | 'counterpartAccountId'>,
  names: ReadonlyMap<string, string>,
  t: MessagingTranslator,
): string {
  if (summary.kind === 'support') return t('supportName');
  const named =
    summary.counterpartAccountId === null
      ? undefined
      : names.get(summary.counterpartAccountId);
  if (named !== undefined) return named;
  return summary.role === 'learner' ? t('unnamed.teacher') : t('unnamed.learner');
}

/** Unread messages, as words in a badge — nothing when there are none. */
export function UnreadBadge({
  count,
  t,
}: {
  readonly count: number;
  readonly t: MessagingTranslator;
}) {
  if (count <= 0) return null;
  return <StatusBadge tone="caution">{t('list.unread', { count })}</StatusBadge>;
}

/** Why a conversation no longer takes messages, if it does not. */
export function ConversationBadges({
  summary,
  t,
}: {
  readonly summary: Pick<ConversationSummary, 'access' | 'state' | 'closedReason'>;
  readonly t: MessagingTranslator;
}) {
  return (
    <>
      {summary.access === 'terminal' ? (
        <StatusBadge tone="neutral">{t('badge.terminal')}</StatusBadge>
      ) : null}
      {summary.state === 'closed' && summary.access !== 'terminal' ? (
        <StatusBadge tone="neutral">
          {summary.closedReason === 'moderation'
            ? t('badge.moderation')
            : summary.closedReason === 'resolved'
              ? t('badge.resolved')
              : t('badge.closed')}
        </StatusBadge>
      ) : null}
    </>
  );
}

/** A Course a conversation belongs to, titled by Learning when it can be. */
export function CourseLine({
  courseId,
  courses,
  locale,
  t,
}: {
  readonly courseId: string | null;
  readonly courses: ReadonlyMap<string, CourseListing>;
  readonly locale: Locale;
  readonly t: MessagingTranslator;
}) {
  const course = courseId === null ? undefined : courses.get(courseId);
  if (course === undefined) return null;
  return (
    <p className="flex min-w-0 flex-wrap gap-x-2 text-sm">
      <span className="text-[color:var(--color-foreground-muted)]">
        {t('list.course')}
      </span>
      <LearningTitle
        labels={course.labels}
        primaryLocale={course.primaryLocale}
        locale={locale}
      />
    </p>
  );
}

/** A person's conversations, newest activity first, each opening its page. */
export function ConversationList({
  conversations,
  surface,
  names,
  courses,
  locale,
  timeZone,
  t,
}: {
  readonly conversations: readonly ConversationSummary[];
  readonly surface: MessagingSurface;
  readonly names: ReadonlyMap<string, string>;
  readonly courses: ReadonlyMap<string, CourseListing>;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly t: MessagingTranslator;
}) {
  return (
    <ul aria-label={t('list.heading')} className="flex flex-col gap-3">
      {conversations.map((summary) => (
        <Panel key={summary.id} as="li">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="flex min-w-0 flex-wrap items-center gap-2">
              <a
                href={conversationPath(surface, locale, summary.id)}
                className="min-w-0 text-lg font-semibold text-[color:var(--color-action)] underline underline-offset-2"
              >
                <span dir="auto" className="wrap-anywhere">
                  {counterpartName(summary, names, t)}
                </span>
              </a>
              <UnreadBadge count={summary.unread} t={t} />
              <ConversationBadges summary={summary} t={t} />
            </p>
            {summary.kind === 'support' ? (
              <p className="text-sm">{t('kind.support')}</p>
            ) : (
              <CourseLine
                courseId={summary.courseId}
                courses={courses}
                locale={locale}
                t={t}
              />
            )}
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {summary.lastMessageAt === null ? (
                t('list.noMessages')
              ) : (
                <>
                  {t('list.lastActivity')}{' '}
                  <MessagingTime
                    value={summary.lastMessageAt}
                    locale={locale}
                    timeZone={timeZone}
                  />
                </>
              )}
            </p>
          </div>
        </Panel>
      ))}
    </ul>
  );
}

export type { ThreadMessage } from './thread';

/**
 * Messages, oldest first: who sent each, when, its text and its attachments.
 * `after` adds a per-message act (a report form) beneath a message. The
 * markup is `thread.tsx`'s, shared with the realtime island.
 */
export function MessageThread({
  messages,
  label,
  attachmentHref,
  locale,
  timeZone,
  t,
  after,
}: {
  readonly messages: readonly ThreadMessage[];
  readonly label: string;
  readonly attachmentHref: (attachmentId: string) => string;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly t: MessagingTranslator;
  readonly after?: (message: ThreadMessage) => ReactNode;
}) {
  return (
    <ThreadList label={label}>
      <ThreadItems
        messages={messages}
        attachmentHref={attachmentHref}
        locale={locale}
        timeZone={timeZone}
        t={t}
        {...(after === undefined ? {} : { after })}
      />
    </ThreadList>
  );
}

/** A thread's items without their list — for the realtime island to extend. */
export function ThreadItems({
  messages,
  attachmentHref,
  locale,
  timeZone,
  t,
  after,
}: {
  readonly messages: readonly ThreadMessage[];
  readonly attachmentHref: (attachmentId: string) => string;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly t: MessagingTranslator;
  readonly after?: (message: ThreadMessage) => ReactNode;
}) {
  const labels = threadLabels(t);
  const zone = displayTimeZone(timeZone);
  return messages.map((message) => (
    <ThreadItem
      key={message.id}
      message={message}
      labels={labels}
      attachmentHref={attachmentHref}
      locale={locale}
      timeZone={zone}
      after={after === undefined ? null : after(message)}
    />
  ));
}

/**
 * Why the reader cannot write here right now — or nothing, when they can.
 * Being blocked BY the other person is stated neutrally: the reader learns the
 * conversation does not take messages, not who decided that.
 */
export function SendState({
  view,
  t,
}: {
  readonly view: ConversationView;
  readonly t: MessagingTranslator;
}) {
  const { summary } = view;
  if (view.canSend) return null;
  const words =
    summary.access === 'terminal' || view.sendRefusal === 'terminal'
      ? t('state.terminal')
      : view.sendRefusal === 'closed'
        ? summary.closedReason === 'moderation'
          ? t('state.moderation')
          : summary.closedReason === 'resolved'
            ? t('state.resolved')
            : t('state.closed')
        : view.sendRefusal === 'blocked'
          ? view.blockedByMe
            ? t('state.blockedByMe')
            : t('state.blocked')
          : view.sendRefusal === 'unclaimed'
            ? t('state.unclaimed')
            : t('state.closed');
  return <Alert tone="info">{words}</Alert>;
}

/** The labels the composer island speaks with. */
export function composerLabels(t: MessagingTranslator): ComposerLabels {
  const name = { name: '{name}' };
  return {
    label: t('composer.label'),
    help: t('composer.help'),
    counter: t('composer.counter', { count: '{count}', max: '{max}' }),
    over: t('composer.over', { count: '{count}' }),
    submit: t('composer.submit'),
    pending: t('composer.pending'),
    sent: t('composer.sent'),
    attach: t('composer.attach'),
    attachHelp: t('composer.attachHelp', {
      files: String(MESSAGING_LIMITS.attachmentsPerMessage),
      size: String(MESSAGING_LIMITS.attachmentMaxBytes / (1024 * 1024)),
    }),
    attachmentsLabel: t('composer.attachments'),
    uploading: t('composer.uploading', name),
    ready: t('composer.ready', name),
    uploadFailed: t('composer.uploadFailed', name),
    remove: t('composer.remove', name),
    removed: t('composer.removed', name),
    tooManyFiles: t('composer.tooManyFiles', {
      files: String(MESSAGING_LIMITS.attachmentsPerMessage),
    }),
    unnamedFile: t('thread.unnamedFile'),
    failures: messagingMessages(t),
  };
}

/**
 * The composer, with an operation identifier minted HERE, on the server, at
 * render — so the same rendered form submitted twice is one operation.
 */
export function Composer({
  action,
  locale,
  conversationId,
  t,
}: {
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  readonly locale: Locale;
  readonly conversationId: string;
  readonly t: MessagingTranslator;
}) {
  return (
    <section aria-labelledby="composer-heading" className="flex flex-col gap-3">
      <h2 id="composer-heading" className="text-lg font-semibold tracking-tight">
        {t('composer.heading')}
      </h2>
      <MessageComposer
        action={action}
        locale={locale}
        conversationId={conversationId}
        operationId={randomUUID()}
        maxCodePoints={MESSAGING_LIMITS.bodyMax}
        maxFiles={MESSAGING_LIMITS.attachmentsPerMessage}
        maxBytes={MESSAGING_LIMITS.attachmentMaxBytes}
        labels={composerLabels(t)}
      />
    </section>
  );
}

/** A disclosure — native, keyboard-operable, focus staying on its summary. */
export function Disclosure({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="min-w-0 wrap-anywhere">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-[color:var(--color-action)] underline underline-offset-2">
        {summary}
      </summary>
      <div className="mt-2 flex min-w-0 flex-col gap-3">{children}</div>
    </details>
  );
}

/** The controlled reason a report carries, as a labelled choice. */
function ReasonField({
  id,
  t,
}: {
  readonly id: string;
  readonly t: MessagingTranslator;
}) {
  return (
    <Field id={id} label={t('safety.reason')}>
      {(props) => (
        <Select {...props} name="reason" required defaultValue="">
          <option value="" disabled>
            {t('safety.reasonChoose')}
          </option>
          {REPORT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(`safety.reasons.${reason}`)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

type Action = (state: FormActionState, form: FormData) => Promise<FormActionState>;

/** Reporting one message someone else sent. */
export function ReportMessage({
  action,
  locale,
  conversationId,
  messageId,
  t,
}: {
  readonly action: Action;
  readonly locale: Locale;
  readonly conversationId: string;
  readonly messageId: string;
  readonly t: MessagingTranslator;
}) {
  return (
    <Disclosure summary={t('safety.reportMessage')}>
      <p className="text-sm">{t('safety.reportHelp')}</p>
      <ActionForm
        action={action}
        submitLabel={t('safety.reportSubmit')}
        pendingLabel={t('common.working')}
        tone="secondary"
        messages={messagingMessages(t, { success: t('safety.reportDone') })}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="messageId" value={messageId} />
        <ReasonField id={`reason-${messageId}`} t={t} />
        <ConfirmField
          id={`report-confirm-${messageId}`}
          label={t('safety.reportConfirm')}
        />
      </ActionForm>
    </Disclosure>
  );
}

/**
 * The conversation's safety acts: block or unblock the other person of a
 * direct conversation, and report the conversation. Blocking needs no
 * relationship — it is a safety act — and stops messages both ways. It is not
 * offered on a read-only conversation whose other account is closed: nothing
 * can arrive there to block.
 */
export function SafetyPanel({
  view,
  name,
  locale,
  t,
  actions,
}: {
  readonly view: ConversationView;
  readonly name: string;
  readonly locale: Locale;
  readonly t: MessagingTranslator;
  readonly actions: {
    readonly block: Action;
    readonly unblock: Action;
    readonly report: Action;
  };
}) {
  const { summary } = view;
  const direct = summary.kind !== 'support';
  const id = summary.id;
  return (
    <Panel>
      <div className="flex min-w-0 flex-col gap-3 wrap-anywhere">
        <h2 className="text-lg font-semibold tracking-tight">{t('safety.heading')}</h2>
        {direct && !view.blockedByMe && summary.access === 'available' ? (
          <Disclosure summary={t('safety.block', { name })}>
            <p className="text-sm">{t('safety.blockHelp')}</p>
            <ActionForm
              action={actions.block}
              submitLabel={t('safety.blockSubmit')}
              pendingLabel={t('common.working')}
              tone="destructive"
              messages={messagingMessages(t, { success: t('safety.blockDone') })}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="conversationId" value={id} />
              <ConfirmField id={`block-confirm-${id}`} label={t('safety.blockConfirm')} />
            </ActionForm>
          </Disclosure>
        ) : null}
        {direct && view.blockedByMe && summary.counterpartAccountId !== null ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t('safety.unblockHelp', { name })}</p>
            <ActionForm
              action={actions.unblock}
              submitLabel={t('safety.unblockSubmit', { name })}
              pendingLabel={t('common.working')}
              tone="secondary"
              messages={messagingMessages(t, { success: t('safety.unblockDone') })}
            >
              <input type="hidden" name="locale" value={locale} />
              <input
                type="hidden"
                name="counterpartAccountId"
                value={summary.counterpartAccountId}
              />
            </ActionForm>
          </div>
        ) : null}
        <Disclosure summary={t('safety.reportConversation')}>
          <p className="text-sm">{t('safety.reportHelp')}</p>
          <ActionForm
            action={actions.report}
            submitLabel={t('safety.reportSubmit')}
            pendingLabel={t('common.working')}
            tone="secondary"
            messages={messagingMessages(t, { success: t('safety.reportDone') })}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="conversationId" value={id} />
            <input type="hidden" name="messageId" value="" />
            <ReasonField id={`reason-conversation-${id}`} t={t} />
            <ConfirmField
              id={`report-confirm-conversation-${id}`}
              label={t('safety.reportConfirm')}
            />
          </ActionForm>
        </Disclosure>
      </div>
    </Panel>
  );
}

/** "Older messages" / "Newest messages" — history pages by `?before=`. */
export function HistoryNav({
  path,
  before,
  current,
  t,
}: {
  readonly path: string;
  /** The older page's position, or `null` when this page holds the first message. */
  readonly before: number | null;
  /** The position this page was asked for; `null` on the newest page. */
  readonly current: number | null;
  readonly t: MessagingTranslator;
}) {
  if (before === null && current === null) return null;
  return (
    <nav aria-label={t('thread.pages')} className="flex flex-wrap gap-x-6 gap-y-2">
      {before === null ? null : (
        <TextLink href={`${path}?before=${String(before)}`}>{t('thread.older')}</TextLink>
      )}
      {current === null ? null : <TextLink href={path}>{t('thread.newest')}</TextLink>}
    </nav>
  );
}
