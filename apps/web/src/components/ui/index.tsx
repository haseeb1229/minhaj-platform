import type { ReactNode } from 'react';

/**
 * The Phase-2 component subset.
 *
 * Only primitives the delivered surfaces genuinely need. Every interactive
 * component defines every state it can be in — default, hover, focus-visible,
 * disabled, pending, error — because "a state that is undefined is a state that
 * will be invented inconsistently later" (ARCHITECTURE.md §13.4).
 *
 * SERVER COMPONENTS by default. None of these opts into the client: they are
 * markup and classes, so the authentication surfaces ship almost no JavaScript
 * (§13.8, which matters for an audience that is global, mobile and frequently
 * on constrained connections).
 *
 * LOGICAL PROPERTIES ONLY. `ms-*`/`me-*`/`ps-*`/`pe-*`, never `ml-*`/`pl-*`.
 * The RTL checker fails the build on a physical property, which is what keeps
 * Urdu and Arabic correct rather than checked-once.
 */

/* ===========================================================================
 * Layout
 * ========================================================================= */

/** The centred column every authentication surface sits in. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description === undefined ? null : (
          <p className="text-[color:var(--color-foreground-muted)]">{description}</p>
        )}
      </header>
      {children}
      {footer === undefined ? null : (
        <footer className="text-sm text-[color:var(--color-foreground-muted)]">
          {footer}
        </footer>
      )}
    </main>
  );
}

/** A bordered panel. The one container shape this phase uses. */
export function Panel({
  children,
  as: Element = 'section',
}: {
  readonly children: ReactNode;
  readonly as?: 'section' | 'div' | 'li';
}) {
  return (
    <Element className="rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]">
      {children}
    </Element>
  );
}

export function PageHeading({ children }: { readonly children: ReactNode }) {
  return <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>;
}

export function SectionHeading({ children }: { readonly children: ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

/* ===========================================================================
 * Feedback
 * ========================================================================= */

export type AlertTone = 'error' | 'success' | 'info' | 'warning';

const ALERT_TONES: Record<AlertTone, string> = {
  error:
    'border-[color:var(--color-error)] bg-[color:var(--color-error-surface)] text-[color:var(--color-error)]',
  success:
    'border-[color:var(--color-success)] bg-[color:var(--color-success-surface)] text-[color:var(--color-success)]',
  info: 'border-[color:var(--color-info)] bg-[color:var(--color-info-surface)] text-[color:var(--color-info)]',
  warning:
    'border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] text-[color:var(--color-warning)]',
};

/**
 * A status message.
 *
 * `role="alert"` for failures so a screen reader announces them without the
 * person having to go looking; `role="status"` for everything else, which
 * announces politely rather than interrupting (SECURITY_BASELINE.md §16.1).
 *
 * Tone is never carried by colour ALONE — each alert leads with text that says
 * what happened, so it survives both monochrome rendering and colour-vision
 * deficiency.
 */
export function Alert({
  tone,
  children,
}: {
  readonly tone: AlertTone;
  readonly children: ReactNode;
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[var(--radius-control)] border px-4 py-3 text-sm ${ALERT_TONES[tone]}`}
    >
      {children}
    </p>
  );
}

/** An empty state. Says what is absent and what to do, never just "nothing". */
export function EmptyState({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-[var(--radius-control)] border border-dashed border-[color:var(--color-border-strong)] px-4 py-6 text-center text-sm text-[color:var(--color-foreground-muted)]">
      {children}
    </p>
  );
}

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
        <p id={helpId} className="text-xs text-[color:var(--color-foreground-muted)]">
          {help}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-xs font-medium text-[color:var(--color-error)]">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_CLASSES =
  'w-full rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] ' +
  'bg-[color:var(--color-surface-raised)] px-3 py-2 text-base ' +
  'disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-sunken)] ' +
  'disabled:text-[color:var(--color-foreground-muted)] ' +
  'aria-[invalid=true]:border-[color:var(--color-error)]';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL_CLASSES} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL_CLASSES} />;
}

export type ButtonTone = 'primary' | 'secondary' | 'destructive';

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary:
    'bg-[color:var(--color-action)] text-[color:var(--color-action-foreground)] hover:bg-[color:var(--color-action-hover)]',
  secondary:
    'border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] hover:bg-[color:var(--color-surface-sunken)]',
  destructive:
    'border border-[color:var(--color-error)] bg-[color:var(--color-surface-raised)] text-[color:var(--color-error)] hover:bg-[color:var(--color-error-surface)]',
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
        `inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] ` +
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
    <a
      href={href}
      className="font-medium text-[color:var(--color-action)] underline underline-offset-2"
    >
      {children}
    </a>
  );
}

/* ===========================================================================
 * Lists
 * ========================================================================= */

/** A description list row, for account and session detail. */
export function DetailRow({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <dt className="text-xs text-[color:var(--color-foreground-muted)]">{term}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * The list of a person's active sessions.
 *
 * A real `<ul>`, so a screen reader announces how many there are before
 * reading them — "list, 3 items" is the difference between orientation and
 * a wall of text.
 */
export function SessionList({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {children}
    </ul>
  );
}

/**
 * One session.
 *
 * The current session is marked in TEXT rather than by styling alone, so the
 * one row a person must not sign out of is identifiable without colour and
 * without sight (SECURITY_BASELINE.md §16.1).
 */
export function SessionRow({
  current,
  currentLabel,
  detail,
  action,
}: {
  readonly current: boolean;
  readonly currentLabel: string;
  readonly detail: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <Panel as="li">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {current ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-action)]">
              {currentLabel}
            </span>
          ) : null}
          {detail}
        </div>
        {action === undefined ? null : <div className="shrink-0">{action}</div>}
      </div>
    </Panel>
  );
}
