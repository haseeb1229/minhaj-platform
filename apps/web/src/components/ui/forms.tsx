import type { ReactNode } from 'react';

/* ===========================================================================
 * Forms
 * ========================================================================= */

/**
 * A labelled field.
 *
 * The label is a real `<label for>`, help and error text are associated through
 * `aria-describedby`, and an invalid field carries `aria-invalid`. Those three
 * are what make an error identifiable to someone who cannot see the red
 * (WCAG 2.2 AA, SECURITY_BASELINE.md §16.2).
 */
export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly help?: string;
  readonly error?: string;
  readonly children: (props: {
    readonly id: string;
    readonly 'aria-describedby': string | undefined;
    readonly 'aria-invalid': boolean | undefined;
  }) => ReactNode;
}) {
  const helpId = help === undefined ? undefined : `${id}-help`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error === undefined ? undefined : true,
      })}

      {help === undefined ? null : (
        <p id={helpId} className="text-xs text-foreground-muted">
          {help}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-xs font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_CLASSES =
  'w-full rounded-control border border-border-strong ' +
  'bg-surface-raised px-3 py-2 text-base ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken ' +
  'disabled:text-foreground-muted ' +
  'aria-[invalid=true]:border-error';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL_CLASSES} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={CONTROL_CLASSES} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL_CLASSES} />;
}

export type ButtonTone = 'primary' | 'secondary' | 'destructive';

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: 'bg-action text-action-foreground hover:bg-action-hover',
  secondary: 'border border-border-strong bg-surface-raised hover:bg-surface-sunken',
  destructive: 'border border-error bg-surface-raised text-error hover:bg-error-surface',
};

/**
 * A button.
 *
 * `min-h-11` is a touch target, not a style: an audience that is predominantly
 * mobile needs one big enough to hit (ARCHITECTURE.md §13.5).
 */
export function Button({
  tone = 'primary',
  type = 'submit',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { readonly tone?: ButtonTone }) {
  return (
    <button
      {...props}
      type={type}
      className={
        `inline-flex min-h-11 items-center justify-center rounded-control ` +
        `px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ` +
        BUTTON_TONES[tone]
      }
    />
  );
}

/** A textual link. */
export function TextLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a href={href} className="font-medium text-action underline underline-offset-2">
      {children}
    </a>
  );
}

/**
 * A filter or section choice: a link with a 44-pixel target, marked when it is
 * the current view. `partial` marks the parent of the current view — the year
 * of the month being shown — highlighted but still a link. The state is carried
 * by `aria-current` and weight as well as by the border colour, never by colour
 * alone.
 */
export function FilterLink({
  href,
  current,
  partial = false,
  children,
}: {
  readonly href: string;
  readonly current: boolean;
  readonly partial?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...(current ? { 'aria-current': 'page' as const } : {})}
      className={`inline-flex min-h-11 items-center rounded-control border px-3 text-sm ${
        current || partial ? 'border-action font-semibold' : 'border-border'
      }`}
    >
      {children}
    </a>
  );
}
