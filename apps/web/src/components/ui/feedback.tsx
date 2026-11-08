import type { ReactNode } from 'react';

import { Icon, type IconName } from './icon';

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
