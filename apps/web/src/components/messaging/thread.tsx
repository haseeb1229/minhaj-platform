import type { ReactNode } from 'react';

import type { AttachmentView } from '@minhaj/contracts/messaging';

import { StatusBadge } from '@/components/ui';
import { fill, formatBytes, isImageType } from './presentation';

/**
 * How one message is drawn — ONE implementation for the server-rendered
 * history and for a message the realtime island appends (DELIVERY_PLAN.md
 * Phases 24–25).
 *
 * WHY THIS IS NOT IN `parts.tsx`. The shared parts are server-only: they speak
 * through the server translator. A message delivered live is drawn in the
 * browser, so the markup lives here, free of the translator and of anything
 * server-only, and speaks through plain labels the server resolved. The
 * server's `MessageThread` and the island both render THIS, so a live message
 * looks, reads and is labelled exactly as a reload would show it.
 *
 * A MESSAGE IS TEXT, RENDERED AS TEXT — a React text node, never markup; its
 * own line breaks kept, breaking anywhere rather than widening a phone screen,
 * declaring no direction of its own (`dir="auto"`). A withheld message is the
 * neutral sentence and nothing else. Every item carries its identifier and
 * sequence as data attributes, so a duplicate is countable, not guessable.
 */

/** What a thread shows of one message, whichever view drew it. */
export interface ThreadMessage {
  readonly id: string;
  readonly sequence: number;
  readonly own: boolean;
  readonly sender: string;
  readonly body: string | null;
  readonly withheld: boolean;
  readonly sentAt: Date;
  readonly attachments: readonly AttachmentView[];
  /** Evidence only: this is the reported message. */
  readonly highlighted?: boolean;
}

/** The words a thread speaks with, resolved by the server. */
export interface ThreadLabels {
  /** Contains `{name}`. */
  readonly messageFrom: string;
  readonly reported: string;
  readonly withheldBadge: string;
  readonly withheld: string;
  readonly attachments: string;
  readonly unnamedFile: string;
  readonly image: string;
  /** Contains `{name}` and `{size}`. */
  readonly download: string;
}

/** An instant, in the interface locale and an already-resolved time zone. */
export function ThreadTime({
  value,
  locale,
  timeZone,
}: {
  readonly value: Date;
  readonly locale: string;
  /** A real IANA zone, already resolved (`displayTimeZone`). */
  readonly timeZone: string;
}) {
  return (
    <time dateTime={value.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(value)}
    </time>
  );
}

/**
 * A message's attachments: an image shown inline from its authorised route,
 * a PDF as a named download with its size. The address names the attachment
 * and is re-decided on every request; nothing here is a storage key.
 */
export function ThreadAttachments({
  attachments,
  href,
  locale,
  labels,
}: {
  readonly attachments: readonly AttachmentView[];
  readonly href: (attachmentId: string) => string;
  readonly locale: string;
  readonly labels: ThreadLabels;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label={labels.attachments} className="flex min-w-0 flex-col gap-2">
      {attachments.map((attachment) => {
        const address = href(attachment.id);
        const name = attachment.displayName ?? labels.unnamedFile;
        const size = formatBytes(attachment.byteSize, locale);
        return (
          <li key={attachment.id} className="min-w-0">
            {isImageType(attachment.mediaType) ? (
              <a href={address} className="inline-block max-w-full">
                <img
                  src={address}
                  alt={attachment.displayName ?? labels.image}
                  loading="lazy"
                  decoding="async"
                  className="max-h-72 max-w-full rounded-[var(--radius-control)] border border-[color:var(--color-border)]"
                />
              </a>
            ) : (
              <a
                href={address}
                download
                className="inline-flex min-h-11 max-w-full items-center font-medium text-[color:var(--color-action)] underline underline-offset-2"
              >
                <span dir="auto" className="min-w-0 wrap-anywhere">
                  {fill(labels.download, { name, size })}
                </span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The ordered list a thread's items sit in, oldest first. */
export function ThreadList({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <ol aria-label={label} className="flex min-w-0 flex-col gap-3">
      {children}
    </ol>
  );
}

/**
 * One message: who sent it, when, its text and its attachments. `after` adds
 * a per-message act beneath it. Own messages sit at the inline END, others at
 * the START — logical properties, in every script — and whose is whose is
 * also said by the sender line, never by position alone.
 */
export function ThreadItem({
  message,
  labels,
  attachmentHref,
  locale,
  timeZone,
  after,
}: {
  readonly message: ThreadMessage;
  readonly labels: ThreadLabels;
  readonly attachmentHref: (attachmentId: string) => string;
  readonly locale: string;
  /** A real IANA zone, already resolved. */
  readonly timeZone: string;
  readonly after?: ReactNode;
}) {
  return (
    <li
      data-message-id={message.id}
      data-sequence={String(message.sequence)}
      className={`flex min-w-0 ${message.own ? 'justify-end' : 'justify-start'}`}
    >
      <article
        aria-label={fill(labels.messageFrom, { name: message.sender })}
        className={`flex min-w-0 max-w-full flex-col gap-2 rounded-[var(--radius-panel)] p-3 sm:max-w-[80%] ${
          message.highlighted === true
            ? 'border-2 border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)]'
            : message.own
              ? 'border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)]'
              : 'border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)]'
        }`}
      >
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[color:var(--color-foreground-muted)]">
          <span dir="auto" className="font-semibold wrap-anywhere">
            {message.sender}
          </span>
          <ThreadTime value={message.sentAt} locale={locale} timeZone={timeZone} />
          {message.highlighted === true ? (
            <StatusBadge tone="caution">{labels.reported}</StatusBadge>
          ) : null}
          {message.withheld && message.body !== null ? (
            <StatusBadge tone="neutral">{labels.withheldBadge}</StatusBadge>
          ) : null}
        </p>
        {message.body === null ? (
          <p className="text-sm text-[color:var(--color-foreground-muted)] italic">
            {labels.withheld}
          </p>
        ) : message.body === '' ? null : (
          <p dir="auto" className="min-w-0 whitespace-pre-line wrap-anywhere">
            {message.body}
          </p>
        )}
        <ThreadAttachments
          attachments={message.attachments}
          href={attachmentHref}
          locale={locale}
          labels={labels}
        />
        {after}
      </article>
    </li>
  );
}
