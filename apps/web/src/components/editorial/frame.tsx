import type { ReactNode } from 'react';

import { Breadcrumbs, Container, PageHeading, PageHero } from '@/components/ui';

/**
 * The page frames Editorial's public surfaces share — News, Events and
 * Collections — so the three read as one publication rather than three
 * templates.
 *
 * A LANDING opens with the shared `PageHero` under a quiet trail; a LISTING or
 * an ARCHIVE opens with a compact introduction band; a RECORD opens with its
 * own header (see each detail page). Every frame renders the page's single
 * `h1`, and the trail is a real breadcrumb navigation that never competes with
 * the heading for attention.
 *
 * SERVER COMPONENTS ONLY, logical properties only, and nothing that moves.
 */

type Trail = readonly { readonly href?: string; readonly text: string }[];

/** A section landing: the trail above the shared hero band. */
export function LandingFrame({
  trailLabel,
  trail,
  title,
  lede,
  eyebrow,
  actions,
  tone = 'plain',
  children,
}: {
  readonly trailLabel: string;
  readonly trail: Trail;
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly actions?: ReactNode;
  readonly tone?: 'plain' | 'ink';
  readonly children?: ReactNode;
}) {
  return (
    <>
      <Container>
        <div className="pt-5 pb-1">
          <Breadcrumbs label={trailLabel} trail={trail} />
        </div>
      </Container>
      <PageHero
        title={title}
        tone={tone}
        {...(lede === undefined ? {} : { lede })}
        {...(eyebrow === undefined ? {} : { eyebrow })}
        {...(actions === undefined ? {} : { actions })}
      >
        {children}
      </PageHero>
    </>
  );
}

/** A listing or archive: a compact band with the trail, the `h1` and a lede. */
export function ListingIntro({
  trailLabel,
  trail,
  title,
  lede,
  eyebrow,
  children,
}: {
  readonly trailLabel: string;
  readonly trail: Trail;
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="border-b border-[color:var(--color-border)]">
      <Container>
        <div className="flex flex-col gap-4 pt-6 pb-[var(--space-page)]">
          <Breadcrumbs label={trailLabel} trail={trail} />
          <div className="flex max-w-3xl flex-col gap-3 pt-2">
            {eyebrow === undefined ? null : <Eyebrow>{eyebrow}</Eyebrow>}
            <PageHeading>{title}</PageHeading>
            {lede === undefined ? null : (
              <p className="text-lede max-w-[var(--measure-prose)] text-[color:var(--color-foreground-muted)]">
                {lede}
              </p>
            )}
          </div>
          {children}
        </div>
      </Container>
    </div>
  );
}

/** The type of a record, in words — never a colour alone. */
export function Eyebrow({ children }: { readonly children: ReactNode }) {
  return (
    <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
      {children}
    </p>
  );
}

/**
 * A card that holds MORE THAN ONE link — a headline plus its byline, Centre or
 * topics. The headline's anchor carries `card-link`, so the whole surface is a
 * pointer target for the record itself; every other link sits in a
 * `CARD_RAISED` layer above that stretched target, so it stays a link of its
 * own. The accessibility tree is unchanged: one named link per destination.
 */
export const CARD_SURFACE =
  'card-surface relative flex h-full min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-[color:var(--color-border-strong)] hover:shadow-[var(--shadow-raised)]';

/** The headline link of a card: quiet until hovered, stretched over the card. */
export const CARD_TITLE_LINK =
  'card-link text-[color:var(--color-foreground)] no-underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:underline active:text-[color:var(--color-action)]';

/** The layer every secondary link inside a card sits in. */
export const CARD_RAISED = 'relative z-10';

/** A section's frame on a record page: an `h2` with a rule beneath it. */
export function RecordSection({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <h2
        id={id}
        className="text-subheading border-b border-[color:var(--color-border)] pb-2 font-semibold"
      >
        {heading}
      </h2>
      {children}
    </section>
  );
}
