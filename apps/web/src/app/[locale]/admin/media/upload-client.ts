'use client';

import { useSyncExternalStore } from 'react';

/**
 * What the administration's two file uploaders share — the audio file (Phase 11)
 * and the photograph (Phase 12): sending one file to its streaming route, and
 * knowing whether the page has hydrated.
 *
 * WHY NOT A FORM POST. The files are larger than the Server Action body cap,
 * which is global and is not raised, so each is sent to its dedicated streaming
 * route as the raw request body — with `XMLHttpRequest`, so the operator sees
 * real upload progress. What is sent, and why each part matters to the server:
 *
 *   - `Content-Type: application/octet-stream` — the body is the file's bytes;
 *   - `X-Minhaj-Intent` — the custom header no cross-origin form can set;
 *   - `X-Expected-Version` — the version the page showed, so a file uploaded
 *     against a record somebody has since changed is a conflict;
 *   - the browser's type and the file's name, which the server uses only to
 *     REFUSE a mismatch and to display — never to decide what the file is.
 */

export type UploadOutcome =
  | { readonly state: 'success'; readonly version: number }
  | { readonly state: 'error'; readonly failure: string };

/** The route's JSON answer, or `null` when the body is not one (a proxy error page). */
function parsed(
  text: string,
): { status?: unknown; failure?: unknown; version?: unknown } | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** Sends one file to one record's upload route and reports how it ended. */
export function sendFile(input: {
  readonly url: string;
  readonly intent: string;
  readonly version: number;
  readonly file: File;
  readonly onProgress: (percent: number) => void;
}): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', input.url);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-Minhaj-Intent', input.intent);
    request.setRequestHeader('X-Expected-Version', String(input.version));
    request.setRequestHeader('X-File-Name', encodeURIComponent(input.file.name));
    if (input.file.type !== '') request.setRequestHeader('X-File-Type', input.file.type);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        input.onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      const body = parsed(request.responseText);
      if (request.status === 200 && body?.status === 'success') {
        resolve({
          state: 'success',
          version: typeof body.version === 'number' ? body.version : input.version + 1,
        });
        return;
      }
      resolve({
        state: 'error',
        failure: typeof body?.failure === 'string' ? body.failure : 'unknown',
      });
    };
    request.onerror = () => resolve({ state: 'error', failure: 'unknown' });

    input.onProgress(0);
    request.send(input.file);
  });
}

/** `false` on the server and during hydration, `true` once interactive. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
