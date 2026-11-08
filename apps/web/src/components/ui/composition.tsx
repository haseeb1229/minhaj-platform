import type { ReactNode } from 'react';

import { descriptionDirection } from '@/config/locale';

import { Icon } from './icon';
import { Container } from './layout';

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
        ink ? 'surface-ink border-b-4 border-ink-accent' : 'border-b border-border'
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
                  ink ? 'text-ink-accent' : 'text-accent'
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
                  ink ? 'text-ink-muted' : 'text-foreground-muted'
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
        primary: 'bg-ink-accent text-ink hover:bg-ink-foreground active:bg-ink-muted',
        secondary:
          'border border-ink-border text-ink-foreground hover:border-ink-accent active:bg-ink-raised',
      }
    : {
        primary:
          'bg-action text-action-foreground hover:bg-action-hover active:bg-action-hover',
        secondary:
          'border border-border-strong bg-surface-raised hover:bg-surface-sunken active:bg-border',
      };

  return (
    <a
      href={href}
      className={`inline-flex max-w-full min-h-11 items-center justify-center rounded-control px-5 py-2 text-sm font-semibold wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] ${tones[tone]}`}
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
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id={id} className="text-heading font-semibold text-balance">
          {heading}
        </h2>
        {intro === undefined ? null : (
          <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
            {intro}
          </p>
        )}
      </div>
      {action === undefined ? null : (
        <a
          href={action.href}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline active:text-action-hover"
        >
          {action.text}
          <Icon name="arrow-end" size={16} />
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
  'card-surface relative flex h-full min-w-0 flex-col gap-2.5 rounded-panel border border-border bg-surface-raised p-5 shadow-panel';

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
      className={`${CARD_SURFACE} transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-raised`}
    >
      {eyebrow === undefined ? null : (
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
          {eyebrow}
        </p>
      )}
      <Heading className="text-subheading font-semibold wrap-anywhere" {...content}>
        <a
          href={href}
          className="card-link text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline active:text-action"
        >
          {title}
        </a>
      </Heading>
      {description === undefined || description === '' ? null : (
        <p
          className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
          {...content}
          {...(dir === undefined ? {} : { dir: descriptionDirection(dir) })}
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
    <p className="text-caption flex flex-wrap items-center gap-x-2 gap-y-1 text-foreground-muted">
      {present.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-x-2">
          {index === 0 ? null : (
            <span aria-hidden="true" className="text-border-strong">
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
            className="inline-flex min-h-10 items-center rounded-full border border-border bg-surface-raised px-4 text-sm wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface active:bg-accent-rule"
          >
            {topic.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
