import {
  MESSAGING_ATTACHMENT_TYPES,
  messageSequenceSchema,
  type MessagingAttachmentType,
  type MessagingSurface,
} from '@minhaj/contracts/messaging';

/**
 * Presentation decisions every Messaging surface shares — PURE and free of
 * React, so a Server Component and a client island read them identically
 * (DELIVERY_PLAN.md Phase 24).
 *
 * WHAT A URL MAY ASK FOR. A conversation page reads at most one older-page
 * position (`?before=`), a list at most one opaque continuation (`?cursor=`)
 * and one state filter. Each is shape-checked here and re-validated by the
 * service; a malformed value is the first page, never an error a crafted link
 * can provoke.
 *
 * WHERE BYTES ARE SERVED. An attachment is never addressed by a storage key:
 * the person's route, the support route and the moderator's evidence route
 * each name the attachment (and, for evidence, the report that authorises it)
 * and re-decide on every request. Three builders, so no page spells a byte
 * address by hand.
 */

type Query = Record<string, string | string[] | undefined>;

/** The first value of one query parameter, or `null`. */
function single(query: Query, name: string): string | null {
  const raw = query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

/** `?before=` — the sequence an older page ends before, or `null` for the newest page. */
export function readBefore(query: Query): number | null {
  const raw = single(query, 'before');
  if (raw === null || !/^[1-9]\d{0,9}$/u.test(raw)) return null;
  const parsed = messageSequenceSchema.safeParse(Number(raw));
  return parsed.success ? parsed.data : null;
}

/** `?cursor=` — an opaque continuation the service issued, shape-checked only. */
export function readCursor(query: Query): string | null {
  const raw = single(query, 'cursor');
  return raw !== null && /^[A-Za-z0-9_-]{1,512}$/u.test(raw) ? raw : null;
}

/** One filter value from a fixed set, or the first of the set. */
export function readChoice<const Choice extends string>(
  query: Query,
  name: string,
  choices: readonly Choice[],
): Choice {
  const raw = single(query, name);
  const found = choices.find((choice) => choice === raw);
  return found ?? (choices[0] as Choice);
}

/** A path with only the query parameters that carry a value. */
export function withQuery(path: string, params: Readonly<Record<string, string | null>>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null) search.set(key, value);
  const encoded = search.toString();
  return encoded === '' ? path : `${path}?${encoded}`;
}

/** Unicode code points — the unit the message bound is stated in, not UTF-16 units. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** The leading block of an identifier — enough for an operator to tell rows apart. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Where a person's own conversations are listed on a surface. */
export function conversationsPath(surface: MessagingSurface, locale: string): string {
  return surface === 'my' ? `/${locale}/my/messages` : `/${locale}/teacher/messages`;
}

/** One conversation's page on a surface. */
export function conversationPath(
  surface: MessagingSurface,
  locale: string,
  conversationId: string,
): string {
  return `${conversationsPath(surface, locale)}/${encodeURIComponent(conversationId)}`;
}

/** A participant's attachment bytes. */
export function participantAttachmentHref(attachmentId: string): string {
  return `/assets/messaging/attachments/${encodeURIComponent(attachmentId)}`;
}

/** Support staff's attachment bytes — audited by the service on every request. */
export function supportAttachmentHref(attachmentId: string): string {
  return `/assets/messaging/support/${encodeURIComponent(attachmentId)}`;
}

/** A moderator's evidence bytes, authorised by ONE report and audited. */
export function evidenceAttachmentHref(reportId: string, attachmentId: string): string {
  return `/assets/messaging/evidence/${encodeURIComponent(reportId)}/${encodeURIComponent(attachmentId)}`;
}

/** The upload route for one conversation. */
export function uploadHref(conversationId: string): string {
  return `/api/messaging/conversations/${encodeURIComponent(conversationId)}/attachments`;
}

/** The catch-up read for one conversation, after a sequence the reader holds. */
export function catchUpHref(conversationId: string, after: number): string {
  return `/api/messaging/conversations/${encodeURIComponent(conversationId)}/messages?after=${String(after)}`;
}

/** Releasing one of the person's own unsent uploads. */
export function discardHref(attachmentId: string): string {
  return `/api/messaging/attachments/${encodeURIComponent(attachmentId)}/discard`;
}

/** The picker's filter: exactly the formats a message may carry. */
export const ATTACHMENT_ACCEPT = [
  ...MESSAGING_ATTACHMENT_TYPES,
  '.jpg',
  '.jpeg',
  '.png',
  '.pdf',
].join(',');

export function isImageType(mediaType: MessagingAttachmentType | string): boolean {
  return mediaType === 'image/jpeg' || mediaType === 'image/png';
}

/** A file size in the reader's own numerals and unit words. */
export function formatBytes(bytes: number, locale: string): string {
  const megabyte = 1024 * 1024;
  const [value, unit] =
    bytes >= megabyte
      ? [bytes / megabyte, 'megabyte']
      : [Math.max(bytes / 1024, 0.1), 'kilobyte'];
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
}
