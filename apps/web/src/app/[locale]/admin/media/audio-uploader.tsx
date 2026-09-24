'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Button } from '@/components/ui';

/**
 * Uploading one audio file to one track (Phase 11).
 *
 * WHY NOT A FORM POST. An audio file is larger than the Server Action body cap,
 * which is global and is not raised; the file is sent to the dedicated streaming
 * route instead, as the raw request body, with an `XMLHttpRequest` so the
 * operator sees real upload progress for a file that can take a while.
 *
 * WHAT IT SENDS, AND WHY EACH MATTERS TO THE SERVER:
 *   - `Content-Type: application/octet-stream` — the body is the file's bytes,
 *     nothing else; the server refuses any other type;
 *   - `X-Minhaj-Intent` — the custom header no cross-origin form can set;
 *   - `X-Expected-Version` — the version this page showed, so a file uploaded
 *     against a track somebody else has since changed is a conflict;
 *   - the browser's type and the file's name, which the server can use only to
 *     REFUSE a mismatch and to display — never to decide what the file is.
 *
 * NO DEAD CONTROL. The file picker and the button appear only once hydrated;
 * before that the help text says what the control will do. A size the server
 * would refuse is refused here first, so the operator does not wait to be told.
 */

export interface AudioUploaderLabels {
  readonly file: string;
  readonly help: string;
  readonly submit: string;
  readonly pending: string;
  readonly progress: string;
  readonly success: string;
  /** A message per failure word the route answers, with `unknown` as default. */
  readonly failures: Readonly<Record<string, string>>;
}

type Outcome =
  | { readonly state: 'idle' }
  | { readonly state: 'sending'; readonly percent: number }
  | { readonly state: 'success' }
  | { readonly state: 'error'; readonly failure: string };

/** The route's JSON answer, or `null` when the body is not one (a proxy error page). */
function parsed(text: string): { status?: unknown; failure?: unknown } | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function AudioUploader({
  trackId,
  version,
  maxBytes,
  labels,
}: {
  readonly trackId: string;
  readonly version: number;
  readonly maxBytes: number;
  readonly labels: AudioUploaderLabels;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  const message = (failure: string) =>
    labels.failures[failure] ?? labels.failures['unknown'] ?? '';

  function send() {
    if (file === null) return;
    if (file.size === 0 || file.size > maxBytes) {
      setOutcome({ state: 'error', failure: file.size === 0 ? 'invalid' : 'too-large' });
      return;
    }

    const request = new XMLHttpRequest();
    request.open('POST', `/api/admin/media/audio/${encodeURIComponent(trackId)}/asset`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-Minhaj-Intent', 'media-audio-upload');
    request.setRequestHeader('X-Expected-Version', String(version));
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    if (file.type !== '') request.setRequestHeader('X-File-Type', file.type);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setOutcome({
          state: 'sending',
          percent: Math.round((event.loaded / event.total) * 100),
        });
    };
    request.onload = () => {
      const body = parsed(request.responseText);
      if (request.status === 200 && body?.status === 'success') {
        setOutcome({ state: 'success' });
        setFile(null);
        // The page's version, preview and file state all changed.
        router.refresh();
        return;
      }
      setOutcome({
        state: 'error',
        failure: typeof body?.failure === 'string' ? body.failure : 'unknown',
      });
    };
    request.onerror = () => setOutcome({ state: 'error', failure: 'unknown' });

    setOutcome({ state: 'sending', percent: 0 });
    request.send(file);
  }

  const sending = outcome.state === 'sending';

  return (
    <div className="flex flex-col gap-4">
      {outcome.state === 'success' ? (
        <Alert tone="success">{labels.success}</Alert>
      ) : null}
      {outcome.state === 'error' ? (
        <Alert tone="error">{message(outcome.failure)}</Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          {labels.file}
        </label>
        {hydrated ? (
          <input
            id={inputId}
            type="file"
            accept="audio/mpeg,.mp3"
            aria-describedby={helpId}
            disabled={sending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setOutcome({ state: 'idle' });
            }}
            className="min-h-11 w-full text-sm"
          />
        ) : null}
        <p id={helpId} className="text-xs text-[color:var(--color-foreground-muted)]">
          {labels.help}
        </p>
      </div>

      {sending ? (
        <div className="flex flex-col gap-1.5" role="status">
          <span className="text-sm">
            {labels.progress} {outcome.percent}%
          </span>
          <progress
            max={100}
            value={outcome.percent}
            aria-label={labels.progress}
            className="w-full"
          />
        </div>
      ) : null}

      {hydrated ? (
        <div>
          <Button
            type="button"
            onClick={send}
            disabled={file === null || sending}
            aria-busy={sending}
          >
            {sending ? labels.pending : labels.submit}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
