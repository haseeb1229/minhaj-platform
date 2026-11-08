import type { ReactNode } from 'react';

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
          <p className="text-foreground-muted">{description}</p>
        )}
      </header>
      {children}
      {footer === undefined ? null : (
        <footer className="text-sm text-foreground-muted">{footer}</footer>
      )}
    </main>
  );
}

/**
 * The centred column a public page sits in.
 *
 * ONE container, so every public surface shares a gutter and a maximum width
 * instead of each route inventing its own. The inline padding is what keeps
 * text off the edge of a small phone, and it is logical, so it is on the
 * correct side in Urdu and Arabic.
 */
export function Container({
  children,
  as: Element = 'div',
}: {
  readonly children: ReactNode;
  readonly as?: 'div' | 'header' | 'footer' | 'nav' | 'main' | 'section';
}) {
  return (
    <Element className="mx-auto w-full max-w-6xl px-[var(--space-gutter)]">
      {children}
    </Element>
  );
}

/**
 * A bounded reading column.
 *
 * `--measure-prose` is a token rather than a number here because "how wide may
 * a line of text be" is a system decision, not a per-page one
 * (ARCHITECTURE.md §13.5).
 */
export function Prose({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex max-w-[var(--measure-prose)] flex-col gap-4">{children}</div>
  );
}

/**
 * A breadcrumb trail.
 *
 * A real `<nav>` with an ordered list, because the order is the meaning, and
 * `aria-current="page"` on the last item so the position is announced rather
 * than merely shown. The separator is decorative and hidden from assistive
 * technology — read aloud, a column of slashes is noise.
 *
 * NO `BreadcrumbList` STRUCTURED DATA. Phase 4 emits no JSON-LD at all on a
 * pre-adoption origin (ROUTE_MAP.md §9.6, and the phase contract's negative
 * rule); this is navigation for a person, not a search-engine claim.
 */
export function Breadcrumbs({
  label,
  trail,
}: {
  readonly label: string;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
        {trail.map((crumb, index) => (
          <li key={crumb.text} className="flex min-w-0 items-center gap-2">
            {index === 0 ? null : (
              <span aria-hidden="true" className="text-border-strong">
                /
              </span>
            )}
            {crumb.href === undefined ? (
              <span
                aria-current="page"
                className="min-w-0 font-medium wrap-anywhere text-foreground"
              >
                {crumb.text}
              </span>
            ) : (
              <a
                href={crumb.href}
                className="min-w-0 wrap-anywhere underline underline-offset-2"
              >
                {crumb.text}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
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
    <Element className="rounded-panel border border-border bg-surface-raised p-5 shadow-panel">
      {children}
    </Element>
  );
}

/**
 * A page's one `h1`, on the type scale's `title` role.
 *
 * The size, the leading and the letter spacing all come from tokens that are
 * re-tuned for Urdu and Arabic, so the many call sites stay one line each and
 * are right in every script.
 */
export function PageHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance">
      {children}
    </h1>
  );
}

/** A section's `h2`, on the type scale's `heading` role. */
export function SectionHeading({
  id,
  children,
}: {
  /** For a section that names itself by this heading (`aria-labelledby`). */
  readonly id?: string;
  readonly children: ReactNode;
}) {
  return (
    <h2 {...(id === undefined ? {} : { id })} className="text-heading font-semibold">
      {children}
    </h2>
  );
}
