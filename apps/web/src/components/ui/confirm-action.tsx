'use client';

import { useId, useState, type FormEvent } from 'react';

import { Dialog } from './dialog';
import { Button, Field, TextArea, type ButtonTone } from './forms';

/**
 * CONFIRM ACTION (R2) — the second look before an irreversible change.
 *
 * A form that carries a `ConfirmSpec` does not submit on its own button: the
 * press opens a modal `Dialog` that says what is about to happen and, when
 * the change wants one, asks for a reason. Only the dialog's own confirm
 * button submits, and it submits THE SAME FORM — the dialog is rendered
 * inside it, so the reason is an ordinary field of the form and reaches the
 * Server Action with everything else.
 *
 * PRESENTATION, NEVER THE CONTROL. Confirming authorises nothing: the action
 * still re-checks the permission, the posture and any step-up, server-side.
 * Without JavaScript the form submits directly, exactly as before — the
 * confirmation is an enhancement, and a reason the SERVICE requires is
 * validated by the service whatever this dialog did.
 *
 * HOW THE GATE TELLS THE TWO SUBMITS APART. The dialog's button is marked
 * `data-confirm="yes"`; a submit from any other control (the form's own
 * button, Enter in a field) is held back with `preventDefault`, which React
 * honours by not dispatching the action.
 */

export interface ConfirmSpec {
  /** The dialog's heading: the change, named ("Close this account?"). */
  readonly title: string;
  /** What will happen, and what cannot be undone. */
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** An optional reason field, submitted with the form under `name`. */
  readonly reason?: {
    readonly name: string;
    readonly label: string;
    readonly help?: string;
    readonly required: boolean;
    readonly maxLength?: number;
  };
}

/** Whether a submit came from the dialog's own confirm button. */
export function isConfirmedSubmit(
  submitter: Pick<Element, 'getAttribute'> | null | undefined,
): boolean {
  return submitter?.getAttribute('data-confirm') === 'yes';
}

/** Whether the confirm button may be pressed: a required reason must say something. */
export function reasonReady(value: string, required: boolean): boolean {
  return !required || value.trim().length > 0;
}

/**
 * The gate a form wires into its `onSubmit`, and the dialog it opens. Returns
 * `onSubmit` for the `<form>` and `dialog` to render INSIDE it.
 */
export function useConfirmGate(
  spec: ConfirmSpec | undefined,
  tone: ButtonTone,
): {
  readonly onSubmit: ((event: FormEvent<HTMLFormElement>) => void) | undefined;
  readonly dialog: React.ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const base = useId();

  if (spec === undefined) return { onSubmit: undefined, dialog: null };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (isConfirmedSubmit(submitter)) {
      setOpen(false);
      return;
    }
    event.preventDefault();
    setOpen(true);
  }

  const ready = reasonReady(reason, spec.reason?.required ?? false);

  const dialog = (
    <Dialog
      title={spec.title}
      closeLabel={spec.cancelLabel}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">{spec.body}</p>
        {spec.reason === undefined ? null : (
          <Field
            id={`${base}-reason`}
            label={spec.reason.label}
            {...(spec.reason.help === undefined ? {} : { help: spec.reason.help })}
          >
            {(props) => (
              <TextArea
                {...props}
                name={spec.reason?.name}
                rows={3}
                required={spec.reason?.required}
                maxLength={spec.reason?.maxLength ?? 500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                data-autofocus
              />
            )}
          </Field>
        )}
        <div className="flex flex-wrap gap-3">
          <Button tone={tone} data-confirm="yes" disabled={!ready}>
            {spec.confirmLabel}
          </Button>
          <Button type="button" tone="secondary" onClick={() => setOpen(false)}>
            {spec.cancelLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );

  return { onSubmit, dialog };
}
