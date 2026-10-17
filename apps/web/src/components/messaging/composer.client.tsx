'use client';

import { useActionState, useId, useRef, useState, useSyncExternalStore } from 'react';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { Alert, Button } from '@/components/ui';
import { ATTACHMENT_ACCEPT, codePointLength, formatBytes } from './presentation';
import {
  discardAttachment,
  uploadAttachment,
  type UploadedAttachment,
} from './requests.client';

/**
 * Writing one message (DELIVERY_PLAN.md Phase 24).
 *
 * A REAL FORM FIRST. The textarea, the hidden conversation and operation
 * identifiers and the submit button are an ordinary `<form>` posting to a
 * Server Action, so a text-only message sends with JavaScript disabled.
 * `useActionState` adds the pending and result states on top; the attachment
 * picker exists only once the page is interactive, because a file goes to the
 * streaming upload route, not through the action.
 *
 * ONE OPERATION, ONE MESSAGE. The operation identifier is minted by the
 * SERVER when the page renders and travels as a hidden field. A double
 * submission, a retry after a dropped connection, a browser resubmitting the
 * same form — each carries the same identifier, and the service answers with
 * the message it already stored. Only the next render, after a success, mints
 * a new one.
 *
 * THE BOUND IS STATED IN THE UNIT IT IS ENFORCED IN: Unicode code points, not
 * UTF-16 units, so an Urdu or Arabic message is counted as its writer counts
 * it. The count here spares a round trip; the service decides.
 *
 * NOTHING TYPED IS ECHOED BACK in a failure. A refusal is a category the
 * labels word; the text stays in the box for the writer to correct.
 */

export interface ComposerLabels {
  readonly label: string;
  readonly help: string;
  /** Contains `{count}` and `{max}`. */
  readonly counter: string;
  /** Contains `{count}`. */
  readonly over: string;
  readonly submit: string;
  readonly pending: string;
  readonly sent: string;
  readonly attach: string;
  readonly attachHelp: string;
  readonly attachmentsLabel: string;
  /** Contains `{name}`. */
  readonly uploading: string;
  /** Contains `{name}`. */
  readonly ready: string;
  /** Contains `{name}`. */
  readonly uploadFailed: string;
  /** Contains `{name}`. */
  readonly remove: string;
  /** Contains `{name}`. */
  readonly removed: string;
  readonly tooManyFiles: string;
  readonly unnamedFile: string;
  readonly failures: Readonly<Record<string, string>>;
}

interface Upload {
  readonly key: string;
  readonly name: string;
  readonly state: 'sending' | 'ready' | 'failed';
  readonly percent: number;
  readonly failure: string | null;
  readonly attachment: UploadedAttachment | null;
}

const IDLE: FormActionState = { status: 'idle' };

/** Replaces each `{token}` with its value. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(
    /\{(\w+)\}/gu,
    (whole, token: string) => values[token] ?? whole,
  );
}

export function MessageComposer({
  action,
  locale,
  conversationId,
  operationId,
  maxCodePoints,
  maxFiles,
  maxBytes,
  labels,
}: {
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  readonly locale: string;
  readonly conversationId: string;
  /** Minted by the server at render; a new render after success brings a new one. */
  readonly operationId: string;
  readonly maxCodePoints: number;
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly labels: ComposerLabels;
}) {
  const id = useId();
  const fieldId = `${id}-body`;
  const helpId = `${id}-help`;
  const counterId = `${id}-counter`;
  const pickerId = `${id}-files`;
  const pickerHelpId = `${id}-files-help`;

  const [body, setBody] = useState('');
  const [uploads, setUploads] = useState<readonly Upload[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const sequence = useRef(0);

  const [state, submit, pending] = useActionState<FormActionState, FormData>(
    async (previous, form) => {
      const result = await action(previous, form);
      if (result.status === 'success') {
        // Sent: the text and the uploads now belong to the stored message.
        setBody('');
        setUploads([]);
      }
      return result;
    },
    IDLE,
  );

  const failureText = (failure: string | null | undefined) =>
    labels.failures[failure ?? 'unknown'] ?? labels.failures['unknown'] ?? '';

  const length = codePointLength(body);
  const over = length - maxCodePoints;
  const numbers = new Intl.NumberFormat(locale);
  const sending = uploads.some((upload) => upload.state === 'sending');
  const ready = uploads.filter((upload) => upload.state === 'ready');
  const live = uploads.filter((upload) => upload.state !== 'failed').length;

  const update = (key: string, change: Partial<Upload>) =>
    setUploads((current) =>
      current.map((upload) => (upload.key === key ? { ...upload, ...change } : upload)),
    );

  async function choose(files: readonly File[]) {
    const room = maxFiles - live;
    if (files.length > room) setAnnouncement(labels.tooManyFiles);
    for (const file of files.slice(0, Math.max(room, 0))) {
      sequence.current += 1;
      const key = `upload-${String(sequence.current)}`;
      const name = file.name === '' ? labels.unnamedFile : file.name;
      const precheck =
        file.size === 0 ? 'invalid' : file.size > maxBytes ? 'too-large' : null;
      setUploads((current) => [
        ...current,
        {
          key,
          name,
          state: precheck === null ? 'sending' : 'failed',
          percent: 0,
          failure: precheck,
          attachment: null,
        },
      ]);
      if (precheck !== null) {
        setAnnouncement(
          `${fill(labels.uploadFailed, { name })} ${failureText(precheck)}`,
        );
        continue;
      }
      setAnnouncement(fill(labels.uploading, { name }));
      const outcome = await uploadAttachment({
        conversationId,
        file,
        onProgress: (percent) => update(key, { percent }),
      });
      if (outcome.state === 'success') {
        update(key, { state: 'ready', percent: 100, attachment: outcome.attachment });
        setAnnouncement(fill(labels.ready, { name }));
      } else {
        update(key, { state: 'failed', failure: outcome.failure });
        setAnnouncement(
          `${fill(labels.uploadFailed, { name })} ${failureText(outcome.failure)}`,
        );
      }
    }
  }

  async function remove(upload: Upload) {
    if (upload.attachment !== null) await discardAttachment(upload.attachment.id);
    // Released or not, it is no longer offered for sending; an upload never
    // sent is released by the service's own sweep in any case.
    setUploads((current) => current.filter((entry) => entry.key !== upload.key));
    setAnnouncement(fill(labels.removed, { name: upload.name }));
  }

  const message =
    state.status === 'success'
      ? labels.sent
      : state.status === 'error'
        ? failureText(state.failure)
        : null;

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      {message === null ? null : (
        <Alert tone={state.status === 'success' ? 'success' : 'error'}>{message}</Alert>
      )}

      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="operationId" value={operationId} />
      {ready.map((upload) =>
        upload.attachment === null ? null : (
          <input
            key={upload.key}
            type="hidden"
            name="attachmentIds"
            value={upload.attachment.id}
          />
        ),
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          {labels.label}
        </label>
        <textarea
          id={fieldId}
          name="body"
          rows={4}
          dir="auto"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-describedby={`${helpId} ${counterId}`}
          aria-invalid={over > 0 ? true : undefined}
          className="w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-3 py-2 text-base aria-[invalid=true]:border-[color:var(--color-error)]"
        />
        <p id={helpId} className="text-xs text-[color:var(--color-foreground-muted)]">
          {labels.help}
        </p>
        <p
          id={counterId}
          className={
            over > 0
              ? 'text-xs font-medium text-[color:var(--color-error)]'
              : 'text-xs text-[color:var(--color-foreground-muted)]'
          }
        >
          {over > 0
            ? fill(labels.over, { count: numbers.format(over) })
            : fill(labels.counter, {
                count: numbers.format(length),
                max: numbers.format(maxCodePoints),
              })}
        </p>
      </div>

      <AttachmentPicker
        pickerId={pickerId}
        pickerHelpId={pickerHelpId}
        labels={labels}
        disabled={pending || live >= maxFiles}
        onChoose={(files) => void choose(files)}
      />

      {uploads.length === 0 ? null : (
        <ul aria-label={labels.attachmentsLabel} className="flex flex-col gap-2">
          {uploads.map((upload) => (
            <li
              key={upload.key}
              className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-3 text-sm"
            >
              <span className="min-w-0 wrap-anywhere" dir="auto">
                {upload.name}
                {upload.attachment === null
                  ? null
                  : ` · ${formatBytes(upload.attachment.byteSize, locale)}`}
              </span>
              {upload.state === 'sending' ? (
                <progress
                  max={100}
                  value={upload.percent}
                  aria-label={fill(labels.uploading, { name: upload.name })}
                  className="w-full"
                />
              ) : null}
              {upload.state === 'ready' ? (
                <span>{fill(labels.ready, { name: upload.name })}</span>
              ) : null}
              {upload.state === 'failed' ? (
                <span className="text-[color:var(--color-error)]">
                  {fill(labels.uploadFailed, { name: upload.name })}{' '}
                  {failureText(upload.failure)}
                </span>
              ) : null}
              {upload.state === 'sending' ? null : (
                <div>
                  <Button
                    type="button"
                    tone="secondary"
                    disabled={pending}
                    onClick={() => void remove(upload)}
                  >
                    {fill(labels.remove, { name: upload.name })}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div>
        <Button disabled={pending || sending || over > 0} aria-busy={pending}>
          {pending ? labels.pending : labels.submit}
        </Button>
      </div>
    </form>
  );
}

/**
 * The file picker, rendered only once the page is interactive: without
 * JavaScript there is no upload transport, and a control that could not work
 * would be a dead one.
 */
function AttachmentPicker({
  pickerId,
  pickerHelpId,
  labels,
  disabled,
  onChoose,
}: {
  readonly pickerId: string;
  readonly pickerHelpId: string;
  readonly labels: ComposerLabels;
  readonly disabled: boolean;
  readonly onChoose: (files: readonly File[]) => void;
}) {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (!hydrated) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={pickerId} className="text-sm font-medium">
        {labels.attach}
      </label>
      <input
        id={pickerId}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        aria-describedby={pickerHelpId}
        disabled={disabled}
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          // Cleared at once, so choosing the same file again is a new choice.
          event.target.value = '';
          onChoose(chosen);
        }}
        className="min-h-11 w-full text-sm"
      />
      <p id={pickerHelpId} className="text-xs text-[color:var(--color-foreground-muted)]">
        {labels.attachHelp}
      </p>
    </div>
  );
}
