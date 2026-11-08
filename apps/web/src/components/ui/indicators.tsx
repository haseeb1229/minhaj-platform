import type { ReactNode } from 'react';

/**
 * SMALL LABELS AND FIGURES (R2): a badge for a type, a language or a status,
 * and one figure with its caption.
 *
 * TEXT, NEVER COLOUR ALONE. Every badge says what it means in words, so it
 * survives monochrome, a screen reader and colour-vision deficiency
 * (SECURITY_BASELINE.md §16.1). Colour only groups.
 */

const TONES = {
  neutral: 'border-border-strong/60 bg-surface-raised text-foreground-muted',
  accent: 'border-accent-rule bg-accent-surface text-accent',
  action: 'border-action/30 bg-surface-raised text-action',
  positive: 'border-success/40 bg-success-surface text-success',
  caution: 'border-warning/40 bg-warning-surface text-warning',
  critical: 'border-error/40 bg-error-surface text-error',
  info: 'border-info/40 bg-info-surface text-info',
} as const;

/**
 * A short label. `kind` sets the default tone: a content TYPE is gold leaf, a
 * LANGUAGE is quiet, a STATUS takes the tone its meaning needs.
 */
export function Badge({
  kind = 'type',
  tone,
  lang,
  children,
}: {
  readonly kind?: 'type' | 'language' | 'status';
  readonly tone?: keyof typeof TONES;
  /** The language of the badge's own words, when they are not the page's. */
  readonly lang?: string;
  readonly children: ReactNode;
}) {
  const resolved = tone ?? (kind === 'type' ? 'accent' : 'neutral');
  return (
    <span
      {...(lang === undefined ? {} : { lang })}
      className={`inline-flex max-w-full min-w-0 items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap ${TONES[resolved]}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * The language a piece of CONTENT is written in, shown when it differs from
 * the interface language. `label` is the language's name in the interface
 * language ("Urdu" on an English page); the code marks the badge for
 * assistive technology only when the name is the language's own ("اردو").
 */
export function LanguageBadge({
  label,
  ownName = false,
  code,
}: {
  readonly label: string;
  /** True when `label` is written in the language it names. */
  readonly ownName?: boolean;
  readonly code: string;
}) {
  return (
    <Badge kind="language" {...(ownName ? { lang: code } : {})}>
      {label}
    </Badge>
  );
}

/**
 * One figure and what it counts. The figure is set in the display face with
 * tabular numerals; the caption is the sentence that makes it mean something.
 */
export function Stat({
  value,
  label,
  href,
}: {
  readonly value: ReactNode;
  readonly label: ReactNode;
  /** Where the counted things are listed, if anywhere. */
  readonly href?: string;
}) {
  const body = (
    <>
      <span className="font-serif text-title leading-none font-semibold text-foreground tabular-nums">
        {value}
      </span>
      <span className="text-sm text-foreground-muted">{label}</span>
    </>
  );
  // A linked figure is ONE link named by the figure and its caption together.
  return href === undefined ? (
    <div className="flex min-w-0 flex-col gap-1.5">{body}</div>
  ) : (
    <a
      href={href}
      className="flex w-fit min-w-0 flex-col gap-1.5 rounded-control no-underline decoration-accent-rule underline-offset-4 hover:underline"
    >
      {body}
    </a>
  );
}
