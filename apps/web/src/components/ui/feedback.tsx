import { isValidElement, type ReactElement, type ReactNode } from 'react';

import { Icon, type IconName } from './icon';
import { Breadcrumbs, Container, PageHeading } from './layout';

/* ===========================================================================
 * Feedback
 * ========================================================================= */

export type AlertTone = 'error' | 'success' | 'info' | 'warning';

const ALERT_TONES: Record<AlertTone, string> = {
  error: 'border-error bg-error-surface text-error',
  success: 'border-success bg-success-surface text-success',
  info: 'border-info bg-info-surface text-info',
  warning: 'border-warning bg-warning-surface text-warning',
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
      className={`rounded-control border px-4 py-3 text-sm ${ALERT_TONES[tone]}`}
    >
      {children}
    </p>
  );
}

/**
 * An empty state. Says what is absent and what to do, never just "nothing".
 *
 * The one-line form (`children` only) stays a single paragraph. R2 adds an
 * optional `title` for a whole empty page or section, and an optional `action`
 * — one link to the most useful next place, named by where it goes.
 */
export function EmptyState({
  children,
  title,
  icon,
  action,
}: {
  readonly children: ReactNode;
  readonly title?: ReactNode;
  readonly icon?: IconName;
  readonly action?: { readonly href: string; readonly text: ReactNode };
}) {
  if (title === undefined && action === undefined && icon === undefined)
    return (
      <p className="rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-sm text-foreground-muted">
        {children}
      </p>
    );

  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-border-strong px-5 py-10 text-center">
      {icon === undefined ? null : <Icon name={icon} size={24} className="text-accent" />}
      {title === undefined ? null : (
        <p className="font-serif text-subheading font-semibold text-balance">{title}</p>
      )}
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {children}
      </p>
      {action === undefined ? null : (
        <a
          href={action.href}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
        >
          {action.text}
          <Icon name="arrow-end" size={16} />
        </a>
      )}
    </div>
  );
}

/**
 * A PAGE THAT AWAITS WHAT IT WILL SHOW — a section page that exists, but whose
 * content cannot be shown until something outside engineering is in place (an
 * authorised source, an approved service). Shared by Hadith's pages that await
 * a collection, Fatwa's that await the service and Explore's that await the
 * organisation's published Page (Explore, R2).
 *
 * ONE SHAPE, SAID HONESTLY: the trail; a status mark in words (never colour
 * alone); the page's own name as its one `h1`; one sentence on what WILL appear
 * here; a notice, under its own `h2`, that nothing is shown in its place; then
 * whatever the section offers onward that IS open, and the way back to the
 * section. It lists nothing and links nothing that cannot open — the caller
 * passes only open destinations.
 *
 * LOGICAL PROPERTIES ONLY, so it is right in English, Urdu and Arabic.
 */
export function AwaitingPage({
  crumbs,
  status,
  title,
  lede,
  notice,
  children,
  back,
}: {
  readonly crumbs: {
    readonly label: string;
    readonly trail: readonly { readonly href?: string; readonly text: string }[];
  };
  /** The mark above the heading, e.g. "Awaiting an authorised source". */
  readonly status: string;
  readonly title: string;
  /** What will appear on this page once it opens. */
  readonly lede: ReactNode;
  /**
   * Why nothing is shown here — or, when the caller has its own notice that
   * says so (Explore's publication-status notice), that element itself.
   */
  readonly notice:
    | {
        /** The notice heading's id, which labels its section. */
        readonly id: string;
        readonly title: ReactNode;
        readonly children: ReactNode;
      }
    | ReactElement;
  /** The open ways onward. */
  readonly children?: ReactNode;
  /** The way back to the section. */
  readonly back: ReactNode;
}) {
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={crumbs.label} trail={crumbs.trail} />

        <header className="flex flex-col gap-4">
          <p className="flex w-fit max-w-full items-center gap-1.5 rounded-full border border-accent-rule bg-accent-surface px-3 py-1 text-caption font-semibold text-accent">
            <Icon name="info" size={16} className="shrink-0" />
            <span>{status}</span>
          </p>
          <PageHeading>{title}</PageHeading>
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {lede}
          </p>
        </header>

        {isValidElement(notice) ? (
          notice
        ) : (
          <section
            aria-labelledby={notice.id}
            className="flex max-w-3xl flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel sm:p-6"
          >
            <h2 id={notice.id} className="text-subheading font-semibold">
              {notice.title}
            </h2>
            {notice.children}
          </section>
        )}

        {children}

        <p>{back}</p>
      </div>
    </Container>
  );
}

const SKELETON_SHAPES = {
  line: 'h-3.5 w-full rounded-full',
  title: 'h-6 w-3/4 rounded-full',
  block: 'h-24 w-full rounded-panel',
  poster: 'aspect-[16/9] w-full rounded-panel',
  cover: 'aspect-[2/3] w-full rounded-panel',
  avatar: 'size-12 rounded-full',
} as const;

/**
 * A placeholder for content that is on its way, in the shape of what will
 * arrive. DECORATIVE: hidden from assistive technology, so the loading
 * boundary that renders it must also say, in words, that content is loading
 * (a `role="status"` line). The pulse stops under reduced motion.
 */
export function Skeleton({
  shape = 'line',
  className = '',
}: {
  readonly shape?: keyof typeof SKELETON_SHAPES;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse bg-surface-sunken ${SKELETON_SHAPES[shape]} ${className}`}
    />
  );
}
