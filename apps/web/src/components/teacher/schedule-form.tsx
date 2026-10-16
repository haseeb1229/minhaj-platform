'use client';

import { useActionState } from 'react';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { Alert, Button, Field, Select, TextInput } from '@/components/ui';

/**
 * A window as a teacher states it: a zone, a local start and end, and — only
 * once the platform has said the time is AMBIGUOUS — which of the two
 * repetitions is meant (DOMAIN_MODEL.md §19.5).
 *
 * THE ONE CLIENT COMPONENT OF THE TEACHER AREA, and it exists for one reason:
 * `ActionForm` shows a refusal but cannot change its fields by it, and a fold
 * choice shown on every form would be a question nobody can answer until the
 * clocks actually go back on their chosen time. So the choice appears exactly
 * when the refusal that needs it arrives, with the typed times kept.
 *
 * PROGRESSIVE ENHANCEMENT. The `<form action>` submits without JavaScript;
 * the fold fields then appear on the re-rendered page's refusal as well,
 * because the state this reads is the action's returned state either way.
 *
 * NOTHING A FORM NAMES IS AN OWNER. The hidden fields are a locale, an
 * identifier and a version; who acts is the session the action resolves.
 */

export interface ScheduleWords {
  readonly timeZone: string;
  readonly timeZoneHelp: string;
  readonly starts: string;
  readonly ends: string;
  readonly startFold: string;
  readonly endFold: string;
  readonly foldHelp: string;
  readonly foldEarlier: string;
  readonly foldLater: string;
}

/** A reschedule's reminder choice: the leads offered, and the words around them. */
export interface ReminderChoice {
  readonly label: string;
  readonly help: string;
  readonly keep: string;
  readonly none: string;
  readonly leads: readonly { readonly value: string; readonly text: string }[];
}

export function ScheduleForm({
  action,
  hidden,
  zones,
  defaults,
  reminder,
  words,
  submitLabel,
  pendingLabel,
  messages,
}: {
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  /** Hidden fields: the locale, the identifier and the version the act names. */
  readonly hidden: Readonly<Record<string, string>>;
  readonly zones: readonly string[];
  readonly defaults: {
    readonly timeZone: string;
    readonly startsLocal: string;
    readonly endsLocal: string;
  };
  /** The reminder choice — absent for an availability window, which has no reminder. */
  readonly reminder?: ReminderChoice;
  readonly words: ScheduleWords;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly messages: Readonly<Record<string, string>>;
}) {
  const [state, submit, pending] = useActionState<FormActionState, FormData>(action, {
    status: 'idle',
  });
  const message =
    state.status === 'success'
      ? messages['success']
      : state.status === 'error'
        ? (messages[state.failure ?? 'unknown'] ?? messages['unknown'])
        : undefined;
  const ambiguous = state.status === 'error' && state.failure === 'ambiguous-time';
  const prefix = Object.values(hidden)
    .join('-')
    .replace(/[^A-Za-z0-9-]/g, '');

  const foldChoice = (name: string, label: string) => (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {words.foldHelp}
      </p>
      <div className="flex flex-col gap-1 text-sm">
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name={name} value="earlier" defaultChecked />
          {words.foldEarlier}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name={name} value="later" />
          {words.foldLater}
        </label>
      </div>
    </fieldset>
  );

  return (
    <form
      action={submit}
      className="flex flex-col gap-4"
      noValidate
      onReset={(event) => event.preventDefault()}
    >
      {message === undefined ? null : (
        <Alert tone={state.status === 'success' ? 'success' : 'error'}>{message}</Alert>
      )}

      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <Field id={`${prefix}-zone`} label={words.timeZone} help={words.timeZoneHelp}>
        {(props) => (
          <Select {...props} name="timeZone" defaultValue={defaults.timeZone}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id={`${prefix}-starts`} label={words.starts}>
        {(props) => (
          <TextInput
            {...props}
            type="datetime-local"
            name="startsLocal"
            defaultValue={defaults.startsLocal}
            required
          />
        )}
      </Field>
      {ambiguous ? foldChoice('startFold', words.startFold) : null}

      <Field id={`${prefix}-ends`} label={words.ends}>
        {(props) => (
          <TextInput
            {...props}
            type="datetime-local"
            name="endsLocal"
            defaultValue={defaults.endsLocal}
            required
          />
        )}
      </Field>
      {ambiguous ? foldChoice('endFold', words.endFold) : null}

      {reminder === undefined ? null : (
        <Field id={`${prefix}-reminder`} label={reminder.label} help={reminder.help}>
          {(props) => (
            <Select {...props} name="reminder" defaultValue="keep">
              <option value="keep">{reminder.keep}</option>
              <option value="none">{reminder.none}</option>
              {reminder.leads.map((lead) => (
                <option key={lead.value} value={lead.value}>
                  {lead.text}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <div className="self-start">
        <Button disabled={pending} aria-busy={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
