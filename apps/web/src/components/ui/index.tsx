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
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[color:var(--color-foreground-muted)]">
        {trail.map((crumb, index) => (
          <li key={crumb.text} className="flex min-w-0 items-center gap-2">
            {index === 0 ? null : (
              <span
                aria-hidden="true"
                className="text-[color:var(--color-border-strong)]"
              >
                /
              </span>
            )}
            {crumb.href === undefined ? (
              <span
                aria-current="page"
                className="min-w-0 font-medium wrap-anywhere text-[color:var(--color-foreground)]"
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
    <Element className="rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]">
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
export function SectionHeading({ children }: { readonly children: ReactNode }) {
  return <h2 className="text-heading font-semibold">{children}</h2>;
}

/* ===========================================================================
 * Composition — the flagship presentation pass
 *
 * Shared shapes for the public portal and the domain landings: a hero, a
 * section header, a bounded grid of cards, a whole-card link, a metadata row
 * and a set of topic chips. Server Components, logical properties only, and
 * motion limited to colour and shadow transitions the global reduced-motion
 * rule collapses to nothing.
 * ========================================================================= */

/**
 * The opening band of a page: an optional eyebrow, the page's ONE `h1`, a lede
 * and optional actions.
 *
 * `ink` is the deep band, for the one page that genuinely opens with a
 * statement (the home portal); `plain` sits on the page surface and suits a
 * domain landing. Either way it is text, never a picture: there is no hero
 * image, no gradient and nothing that moves.
 */
export function PageHero({
  title,
  lede,
  eyebrow,
  actions,
  children,
  aside,
  tone = 'plain',
}: {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly eyebrow?: ReactNode;
  /** Links, usually one primary and at most one secondary. */
  readonly actions?: ReactNode;
  /** Anything that belongs inside the band below the actions, such as a search. */
  readonly children?: ReactNode;
  /**
   * Phase 30-R. One featured item beside the words on wide screens (below them
   * on narrow ones) — a real published record, never decoration.
   */
  readonly aside?: ReactNode;
  readonly tone?: 'plain' | 'ink';
}) {
  const ink = tone === 'ink';

  return (
    <div
      className={
        ink
          ? 'surface-ink border-b-4 border-[color:var(--color-ink-accent)]'
          : 'border-b border-[color:var(--color-border)]'
      }
    >
      <Container>
        <div
          className={
            aside === undefined
              ? ''
              : 'grid grid-cols-1 items-center gap-x-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]'
          }
        >
          <div className="flex max-w-3xl min-w-0 flex-col gap-5 py-[var(--space-section)]">
            {eyebrow === undefined ? null : (
              <p
                className={`text-caption font-semibold tracking-[var(--tracking-eyebrow)] uppercase ${
                  ink
                    ? 'text-[color:var(--color-ink-accent)]'
                    : 'text-[color:var(--color-accent)]'
                }`}
              >
                {eyebrow}
              </p>
            )}
            <h1
              className={`font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere ${
                ink ? 'text-display' : 'text-title'
              }`}
            >
              {title}
            </h1>
            {lede === undefined ? null : (
              <p
                className={`text-lede max-w-[var(--measure-prose)] ${
                  ink
                    ? 'text-[color:var(--color-ink-muted)]'
                    : 'text-[color:var(--color-foreground-muted)]'
                }`}
              >
                {lede}
              </p>
            )}
            {actions === undefined ? null : (
              <div className="flex flex-wrap items-center gap-3 pt-1">{actions}</div>
            )}
            {children}
          </div>
          {aside === undefined ? null : (
            <div className="min-w-0 pb-[var(--space-section)] lg:py-[var(--space-section)]">
              {aside}
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}

/**
 * A link styled as an action. `primary` is the filled action colour; on an ink
 * band, `onInk` swaps to the band's own accent so it keeps its contrast.
 * Every state is defined: hover, active, focus-visible (the global ring, or the
 * ink accent on ink) — and there is no disabled link, because a link that
 * cannot be followed must not be rendered at all (ROUTE_MAP.md §5.2).
 */
export function ActionLink({
  href,
  children,
  tone = 'primary',
  onInk = false,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly tone?: 'primary' | 'secondary';
  readonly onInk?: boolean;
}) {
  const tones = onInk
    ? {
        primary:
          'bg-[color:var(--color-ink-accent)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-ink-foreground)] active:bg-[color:var(--color-ink-muted)]',
        secondary:
          'border border-[color:var(--color-ink-border)] text-[color:var(--color-ink-foreground)] hover:border-[color:var(--color-ink-accent)] active:bg-[color:var(--color-ink-raised)]',
      }
    : {
        primary:
          'bg-[color:var(--color-action)] text-[color:var(--color-action-foreground)] hover:bg-[color:var(--color-action-hover)] active:bg-[color:var(--color-action-hover)]',
        secondary:
          'border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)]',
      };

  return (
    <a
      href={href}
      className={`inline-flex max-w-full min-h-11 items-center justify-center rounded-[var(--radius-control)] px-5 py-2 text-sm font-semibold wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] ${tones[tone]}`}
    >
      {children}
    </a>
  );
}

/**
 * A section's header: its `h2` (with the id the section is labelled by), an
 * optional one-line introduction, and an optional "see everything" link.
 *
 * The link's text is supplied by the caller and should name its destination —
 * "All news", not "View all" — so a list of links read out of context still
 * says where each one goes (WCAG 2.4.4).
 */
export function SectionHeader({
  id,
  heading,
  intro,
  action,
}: {
  readonly id: string;
  readonly heading: ReactNode;
  readonly intro?: ReactNode;
  readonly action?: { readonly href: string; readonly text: ReactNode };
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[color:var(--color-border)] pb-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id={id} className="text-heading font-semibold text-balance">
          {heading}
        </h2>
        {intro === undefined ? null : (
          <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
            {intro}
          </p>
        )}
      </div>
      {action === undefined ? null : (
        <a
          href={action.href}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-action)] underline-offset-4 hover:underline active:text-[color:var(--color-action-hover)]"
        >
          {action.text}
          <span aria-hidden="true" className="rtl:-scale-x-100">
            →
          </span>
        </a>
      )}
    </div>
  );
}

const GRID_COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const;

/**
 * A bounded, responsive grid of cards — a real list, so a screen reader says
 * how many there are. One column on a phone, two from a small tablet, and the
 * requested count from a laptop. Every child must be an `li`; `LinkCard`
 * renders one.
 */
export function CardGrid({
  label,
  columns = 3,
  children,
}: {
  /** The list's accessible name, when its section heading does not label it. */
  readonly label?: string;
  readonly columns?: 2 | 3 | 4;
  readonly children: ReactNode;
}) {
  return (
    <ul
      {...(label === undefined ? {} : { 'aria-label': label })}
      className={`grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 ${GRID_COLUMNS[columns]}`}
    >
      {children}
    </ul>
  );
}

const CARD_SURFACE =
  'card-surface relative flex h-full min-w-0 flex-col gap-2.5 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]';

/**
 * A card that is ONE link, end to end.
 *
 * The heading holds the only anchor, and the `card-link` rule stretches it over
 * the card, so the whole surface is clickable while the accessibility tree
 * holds a single link named by the title (see `globals.css`). Nothing else in
 * the card may be interactive — a second link inside would sit underneath the
 * stretched one — so the props accept text and metadata, not arbitrary
 * children.
 *
 * `lang` and `dir` mark the TITLE AND DESCRIPTION, which are content and may be
 * in a different language from the page; the eyebrow and metadata are
 * interface text and stay in the page's language.
 */
export function LinkCard({
  href,
  title,
  description,
  eyebrow,
  meta,
  headingLevel = 'h3',
  lang,
  dir,
}: {
  readonly href: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly meta?: ReactNode;
  readonly headingLevel?: 'h2' | 'h3';
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
}) {
  const Heading = headingLevel;
  const content = {
    ...(lang === undefined ? {} : { lang }),
    ...(dir === undefined ? {} : { dir }),
  };

  return (
    <li
      className={`${CARD_SURFACE} transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-[color:var(--color-border-strong)] hover:shadow-[var(--shadow-raised)]`}
    >
      {eyebrow === undefined ? null : (
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
          {eyebrow}
        </p>
      )}
      <Heading className="text-subheading font-semibold wrap-anywhere" {...content}>
        <a
          href={href}
          className="card-link text-[color:var(--color-foreground)] no-underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:underline active:text-[color:var(--color-action)]"
        >
          {title}
        </a>
      </Heading>
      {description === undefined || description === '' ? null : (
        <p
          className="line-clamp-3 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
          {...content}
        >
          {description}
        </p>
      )}
      {meta === undefined ? null : <div className="mt-auto pt-1">{meta}</div>}
    </li>
  );
}

/**
 * Dot-separated metadata — a type, a date, a language.
 *
 * EACH ITEM IS ISOLATED with `<bdi>`, because this is exactly where scripts
 * meet: an English date beside an Urdu label, a Latin numeral inside an Arabic
 * sentence. Without isolation the bidirectional algorithm can reorder the
 * neighbours of a run, and the separator ends up on the wrong side of the wrong
 * word. The separators are decorative and hidden from assistive technology.
 */
export function MetaRow({ items }: { readonly items: readonly ReactNode[] }) {
  const present = items.filter(
    (item) => item !== null && item !== undefined && item !== false && item !== '',
  );
  if (present.length === 0) return null;

  return (
    <p className="text-caption flex flex-wrap items-center gap-x-2 gap-y-1 text-[color:var(--color-foreground-muted)]">
      {present.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-x-2">
          {index === 0 ? null : (
            <span aria-hidden="true" className="text-[color:var(--color-border-strong)]">
              ·
            </span>
          )}
          <bdi>{item}</bdi>
        </span>
      ))}
    </p>
  );
}

/**
 * Topics as a set of chip links. A real list with an accessible name; each
 * chip's label carries its own `lang` when the topic's name fell back to
 * another language.
 */
export function TopicChips({
  label,
  topics,
}: {
  readonly label: string;
  readonly topics: readonly {
    readonly href: string;
    readonly text: string;
    readonly lang?: string;
  }[];
}) {
  if (topics.length === 0) return null;

  return (
    <ul aria-label={label} className="flex list-none flex-wrap gap-2 p-0">
      {topics.map((topic) => (
        <li key={topic.href} className="min-w-0">
          <a
            href={topic.href}
            {...(topic.lang === undefined ? {} : { lang: topic.lang })}
            className="inline-flex min-h-10 items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] px-4 text-sm wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-surface)] active:bg-[color:var(--color-accent-rule)]"
          >
            {topic.text}
          </a>
        </li>
      ))}
    </ul>
  );
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

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={CONTROL_CLASSES} />;
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
      className={`inline-flex min-h-11 items-center rounded-[var(--radius-control)] border px-3 text-sm ${
        current || partial
          ? 'border-[color:var(--color-action)] font-semibold'
          : 'border-[color:var(--color-border)]'
      }`}
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
    <div className="flex min-w-0 flex-col gap-0.5 py-2">
      <dt className="text-xs text-[color:var(--color-foreground-muted)]">{term}</dt>
      <dd className="min-w-0 text-sm wrap-anywhere">{children}</dd>
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

/* ===========================================================================
 * Tabular data — the administrative surfaces
 * ========================================================================= */

/**
 * A bounded data table.
 *
 * A REAL `<table>` with a `<caption>`, because that is what makes a grid of
 * values navigable to a screen reader: it announces the caption, the column
 * count and the header for each cell. A grid of `<div>`s reads as a wall of
 * unrelated text (SECURITY_BASELINE.md §16.1).
 *
 * The horizontal scroll lives on the WRAPPER rather than the page. A table is
 * one of the three things allowed to be wider than the viewport; the document
 * itself is not, and an administrative screen on a phone is a real case for an
 * audience this platform serves.
 */
export function DataTable({
  caption,
  columns,
  children,
}: {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    /*
     * The scroll wrapper is a NAMED, FOCUSABLE region: a keyboard user can
     * reach it and scroll it with the arrow keys when the table is wider than
     * the screen, and a screen reader announces what the region holds rather
     * than an anonymous scrolling box (WCAG 2.1.1, 4.1.2).
     */
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="w-full overflow-x-auto rounded-[var(--radius-control)]"
    >
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="pb-2 text-start text-xs text-[color:var(--color-foreground-muted)]">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-[color:var(--color-border-strong)]">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 text-start text-xs font-semibold tracking-wide uppercase"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** One table row. Bordered rather than striped, so it survives a dark theme. */
export function DataRow({ children }: { readonly children: ReactNode }) {
  return (
    <tr className="border-b border-[color:var(--color-border)] align-top">{children}</tr>
  );
}

/** One table cell. */
export function DataCell({
  children,
  wrap = false,
}: {
  readonly children: ReactNode;
  readonly wrap?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${wrap ? 'break-words' : 'whitespace-nowrap'}`}>
      {children}
    </td>
  );
}

/**
 * A short status word.
 *
 * Text, never colour alone. A badge that said "active" only by being green
 * would say nothing in monochrome, nothing to a screen reader and nothing to a
 * reader with colour-vision deficiency — and account status is exactly the kind
 * of security state that must survive all three (§16.1).
 */
export function StatusBadge({
  tone,
  children,
}: {
  readonly tone: 'neutral' | 'positive' | 'caution';
  readonly children: ReactNode;
}) {
  const tones = {
    neutral:
      'border-[color:var(--color-border-strong)] text-[color:var(--color-foreground-muted)]',
    positive: 'border-[color:var(--color-success)] text-[color:var(--color-success)]',
    caution: 'border-[color:var(--color-warning)] text-[color:var(--color-warning)]',
  } as const;

  return (
    <span
      className={`inline-block rounded-[var(--radius-control)] border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
