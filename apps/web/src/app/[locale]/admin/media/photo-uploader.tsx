'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Button } from '@/components/ui';
import { createPhotoDraft } from './actions';
import { sendFile, useHydrated } from './upload-client';

/**
 * Uploading photographs (Phase 12), through the shared streaming transport
 * (`./upload-client.ts`).
 *
 * TWO MODES, ONE RULE. `replace` sends one image to one existing Photo, under
 * the version the page showed. `batch` turns each chosen file into its own
 * draft Photo — created by a Server Action, which re-checks `media.administer`
 * — and then sends the file to it, one file at a time, reporting each file's
 * outcome by name. A file that fails leaves an honest draft with no image,
 * which the list shows and the operator can retry or archive; nothing is
 * published by uploading.
 *
 * NOTHING IS TRUSTED HERE. The size and type checks below only spare the
 * operator a wait: the server measures, validates and scans every byte, and a
 * file's name and declared type can only ever cause a refusal.
 */

export interface PhotoUploaderLabels {
  readonly file: string;
  readonly help: string;
  readonly submit: string;
  readonly pending: string;
  readonly progress: string;
  readonly success: string;
  /** Batch only: one file's line in the report. Contains `{name}`. */
  readonly fileDone?: string;
  readonly fileFailed?: string;
  readonly openDraft?: string;
  readonly failures: Readonly<Record<string, string>>;
}

/** The formats the server accepts, offered as the picker's filter. */
const ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

/** How many files one batch may carry — one administrative page of Photos. */
const BATCH = 24;

interface Line {
  readonly name: string;
  readonly state: 'waiting' | 'sending' | 'done' | 'failed';
  readonly percent: number;
  readonly failure: string | null;
  readonly photoId: string | null;
}

export function PhotoUploader(
  props: {
    readonly maxBytes: number;
    readonly labels: PhotoUploaderLabels;
  } & (
    | {
        readonly mode: 'replace';
        readonly photoId: string;
        readonly version: number;
      }
    | { readonly mode: 'batch'; readonly locale: string; readonly editorBase: string }
  ),
) {
  const { maxBytes, labels } = props;
  const hydrated = useHydrated();
  const router = useRouter();
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const [files, setFiles] = useState<readonly File[]>([]);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<'success' | 'error' | null>(null);

  const message = (failure: string) =>
    labels.failures[failure] ?? labels.failures['unknown'] ?? '';

  const update = (index: number, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, ...change } : line)),
    );

  /** A refusal the server would give anyway, given without the wait. */
  function precheck(file: File): string | null {
    if (file.size === 0) return 'invalid';
    if (file.size > maxBytes) return 'too-large';
    return null;
  }

  async function send() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setSummary(null);
    setLines(
      files.map((file) => ({
        name: file.name,
        state: 'waiting',
        percent: 0,
        failure: null,
        photoId: null,
      })),
    );

    let failures = 0;
    for (const [index, file] of files.entries()) {
      const refused = precheck(file);
      if (refused !== null) {
        failures += 1;
        update(index, { state: 'failed', failure: refused });
        continue;
      }

      let target: { readonly photoId: string; readonly version: number };
      if (props.mode === 'replace') {
        target = { photoId: props.photoId, version: props.version };
      } else {
        const created = await createPhotoDraft(props.locale);
        if (created.status !== 'success') {
          failures += 1;
          update(index, { state: 'failed', failure: created.failure });
          continue;
        }
        target = { photoId: created.id, version: created.version };
        update(index, { photoId: created.id });
      }

      update(index, { state: 'sending' });
      const result = await sendFile({
        url: `/api/admin/media/photos/${encodeURIComponent(target.photoId)}/asset`,
        intent: 'media-photo-upload',
        version: target.version,
        file,
        onProgress: (percent) => update(index, { percent }),
      });
      if (result.state === 'success') {
        update(index, { state: 'done', percent: 100 });
      } else {
        failures += 1;
        update(index, { state: 'failed', failure: result.failure });
      }
    }

    setBusy(false);
    setFiles([]);
    setSummary(failures === 0 ? 'success' : 'error');
    // Versions, previews and the directory all changed.
    router.refresh();
  }

  const single = props.mode === 'replace';

  return (
    <div className="flex flex-col gap-4">
      {summary === 'success' ? <Alert tone="success">{labels.success}</Alert> : null}
      {summary === 'error' && single ? (
        <Alert tone="error">{message(lines[0]?.failure ?? 'unknown')}</Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          {labels.file}
        </label>
        {hydrated ? (
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple={!single}
            aria-describedby={helpId}
            disabled={busy}
            onChange={(event) => {
              const chosen = [...(event.target.files ?? [])];
              setFiles(single ? chosen.slice(0, 1) : chosen.slice(0, BATCH));
              setSummary(null);
              setLines([]);
            }}
            className="min-h-11 w-full text-sm"
          />
        ) : null}
        <p id={helpId} className="text-xs text-[color:var(--color-foreground-muted)]">
          {labels.help}
        </p>
      </div>

      {hydrated ? (
        <div>
          <Button
            type="button"
            onClick={() => void send()}
            disabled={files.length === 0 || busy}
            aria-busy={busy}
          >
            {busy ? labels.pending : labels.submit}
          </Button>
        </div>
      ) : null}

      {lines.length === 0 || (single && !busy) ? null : (
        <ul className="flex flex-col gap-2" role="status" aria-label={labels.progress}>
          {lines.map((line, index) => (
            <li
              key={`${line.name}-${String(index)}`}
              className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-3 text-sm"
            >
              <span className="break-all" dir="auto">
                {line.name}
              </span>
              {line.state === 'sending' || line.state === 'waiting' ? (
                <progress
                  max={100}
                  value={line.percent}
                  aria-label={`${labels.progress}: ${line.name}`}
                  className="w-full"
                />
              ) : null}
              {line.state === 'done' ? (
                <span className="text-[color:var(--color-success)]">
                  {(labels.fileDone ?? labels.success).replace('{name}', line.name)}
                </span>
              ) : null}
              {line.state === 'failed' ? (
                <span className="text-[color:var(--color-error)]">
                  {(labels.fileFailed ?? '').replace('{name}', line.name)}{' '}
                  {message(line.failure ?? 'unknown')}
                </span>
              ) : null}
              {!single &&
              line.photoId !== null &&
              line.state !== 'sending' &&
              line.state !== 'waiting' &&
              labels.openDraft !== undefined &&
              props.mode === 'batch' ? (
                <a
                  href={`${props.editorBase}/${line.photoId}`}
                  className="underline underline-offset-2"
                >
                  {labels.openDraft}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
