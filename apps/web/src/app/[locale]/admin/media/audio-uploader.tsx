'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Button } from '@/components/ui';
import { sendFile, useHydrated } from './upload-client';

/**
 * Uploading one audio file to one track (Phase 11).
 *
 * The file goes to the track's dedicated streaming route through the shared
 * uploader transport (`./upload-client.ts`), which says what is sent and why.
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

  async function send() {
    if (file === null) return;
    if (file.size === 0 || file.size > maxBytes) {
      setOutcome({ state: 'error', failure: file.size === 0 ? 'invalid' : 'too-large' });
      return;
    }

    const result = await sendFile({
      url: `/api/admin/media/audio/${encodeURIComponent(trackId)}/asset`,
      intent: 'media-audio-upload',
      version,
      file,
      onProgress: (percent) => setOutcome({ state: 'sending', percent }),
    });
    if (result.state === 'success') {
      setOutcome({ state: 'success' });
      setFile(null);
      // The page's version, preview and file state all changed.
      router.refresh();
      return;
    }
    setOutcome(result);
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
            onClick={() => void send()}
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
