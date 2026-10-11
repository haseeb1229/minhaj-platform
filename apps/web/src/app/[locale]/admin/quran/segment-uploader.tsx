'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Button } from '@/components/ui';
import { sendFile, useHydrated } from '../media/upload-client';

/**
 * Uploading one audio file to one recitation segment (Phase 18).
 *
 * The file goes to the segment's dedicated streaming route,
 * `POST /api/admin/quran/recitations/{recitationId}/segments/{segmentId}/asset`,
 * through the administration's one uploader transport
 * (`../media/upload-client.ts`), which says what is sent and why: the raw bytes,
 * a custom intent header no cross-origin form can set, and the Recitation's
 * expected version, so a file uploaded against a Recitation somebody has since
 * changed is a conflict. The browser's type and name are claims the server only
 * uses to refuse a mismatch and to display.
 *
 * NO DEAD CONTROL. The file picker and the button appear only once hydrated;
 * before that the help text says what the control will do. A size the server
 * would refuse is refused here first, so the operator does not wait to be told.
 */

export interface SegmentUploaderLabels {
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

export function SegmentUploader({
  recitationId,
  segmentId,
  version,
  maxBytes,
  accept,
  labels,
}: {
  readonly recitationId: string;
  readonly segmentId: string;
  readonly version: number;
  readonly maxBytes: number;
  /** The media types the route accepts, as the file picker's hint. */
  readonly accept: string;
  readonly labels: SegmentUploaderLabels;
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
      url: `/api/admin/quran/recitations/${encodeURIComponent(recitationId)}/segments/${encodeURIComponent(segmentId)}/asset`,
      intent: 'quran-recitation-upload',
      version,
      file,
      onProgress: (percent) => setOutcome({ state: 'sending', percent }),
    });
    if (result.state === 'success') {
      setOutcome({ state: 'success' });
      setFile(null);
      // The Recitation's version and the segment's audio both changed.
      router.refresh();
      return;
    }
    setOutcome(result);
  }

  const sending = outcome.state === 'sending';

  return (
    <div className="flex flex-col gap-3">
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
            accept={accept}
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
            tone="secondary"
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
