'use client';

import { catchUpHref, discardHref, uploadHref } from './presentation';

/**
 * The browser's side of `/api/messaging/*` — same origin, with the session
 * cookie the browser already holds and nothing else (DELIVERY_PLAN.md
 * Phase 24).
 *
 * WHY NOT A FORM POST FOR A FILE. The Server Action body cap is global and is
 * not raised, so an attachment's bytes go to the streaming upload route as the
 * raw request body — by `XMLHttpRequest`, so the person sees real progress.
 * The intent header is the one no cross-origin form can set; the browser's
 * type and the file's name only let the server REFUSE a mismatch and display a
 * name — they never decide what the file is.
 *
 * NOTHING THE SERVER ANSWERS IS TRUSTED BEYOND ITS SHAPE. An answer that is
 * not one of the expected forms is `unavailable`, which the island words as a
 * calm failure, never a broken page.
 */

const INTENT_HEADER = 'X-Minhaj-Intent';
const INTENT_VALUE = 'messaging-attachment';

export interface UploadedAttachment {
  readonly id: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly displayName: string | null;
}

export type UploadOutcome =
  | { readonly state: 'success'; readonly attachment: UploadedAttachment }
  | { readonly state: 'error'; readonly failure: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function failureOf(body: Record<string, unknown> | null): string {
  return typeof body?.['failure'] === 'string' ? body['failure'] : 'unavailable';
}

function attachmentOf(value: unknown): UploadedAttachment | null {
  if (!isRecord(value)) return null;
  const { id, mediaType, byteSize, displayName } = value;
  if (typeof id !== 'string' || typeof mediaType !== 'string') return null;
  if (typeof byteSize !== 'number') return null;
  if (displayName !== null && typeof displayName !== 'string') return null;
  return { id, mediaType, byteSize, displayName };
}

/** Sends one file to a conversation's upload route and reports how it ended. */
export function uploadAttachment(input: {
  readonly conversationId: string;
  readonly file: File;
  readonly onProgress: (percent: number) => void;
}): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', uploadHref(input.conversationId));
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader(INTENT_HEADER, INTENT_VALUE);
    request.setRequestHeader('X-File-Name', encodeURIComponent(input.file.name));
    if (input.file.type !== '') request.setRequestHeader('X-File-Type', input.file.type);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        input.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      const body = parsed(request.responseText);
      const attachment = attachmentOf(body?.['attachment']);
      if (request.status === 200 && body?.['status'] === 'success' && attachment !== null)
        resolve({ state: 'success', attachment });
      else resolve({ state: 'error', failure: failureOf(body) });
    };
    request.onerror = () => resolve({ state: 'error', failure: 'unavailable' });

    input.onProgress(0);
    request.send(input.file);
  });
}

/** Releases one of the person's own unsent uploads. */
export async function discardAttachment(attachmentId: string): Promise<boolean> {
  try {
    const response = await fetch(discardHref(attachmentId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { [INTENT_HEADER]: INTENT_VALUE },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type CatchUpOutcome =
  | { readonly state: 'success'; readonly count: number; readonly more: boolean }
  | { readonly state: 'error'; readonly failure: string };

/** How many messages exist after the sequence the page already shows. */
export async function checkForMessages(
  conversationId: string,
  after: number,
): Promise<CatchUpOutcome> {
  try {
    const response = await fetch(catchUpHref(conversationId, after), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const body = parsed(await response.text());
    const page = body?.['page'];
    if (
      response.ok &&
      body?.['status'] === 'success' &&
      isRecord(page) &&
      Array.isArray(page['messages']) &&
      typeof page['more'] === 'boolean'
    )
      return { state: 'success', count: page['messages'].length, more: page['more'] };
    return { state: 'error', failure: failureOf(body) };
  } catch {
    return { state: 'error', failure: 'unavailable' };
  }
}
