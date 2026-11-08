import type { ReactNode } from 'react';

import { Container, SectionHeader } from '@/components/ui';

/**
 * ONE MODULE OF THE HOME PAGE (R2): a `section` labelled by its own `h2`, on
 * the band its content calls for.
 *
 *   `page`    the page surface: news, leadership, a quiet grid;
 *   `sunken`  a full-width warm band, for a shelf of covers, so the page reads
 *             as a sequence of rooms rather than one long stack of identical
 *             cards;
 *   `accent`  the gold-leaf band, kept for the one closing invitation.
 *
 * The band is full width; the content keeps the shared container. Without a
 * `header`, the children bring their own `h2` with this section's `id` — a
 * shelf does, because its arrows sit beside the heading.
 */
const BANDS = {
  page: 'py-[calc(var(--space-section)/2)]',
  sunken: 'border-y border-border bg-surface-sunken py-[var(--space-section)]',
  accent: 'border-y border-accent-rule bg-accent-surface py-[var(--space-section)]',
} as const;

export function HomeSection({
  id,
  header,
  band = 'page',
  children,
}: {
  readonly id: string;
  readonly header?: {
    readonly heading: string;
    readonly intro?: string;
    readonly action?: { readonly href: string; readonly text: string };
  };
  readonly band?: keyof typeof BANDS;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={BANDS[band]}>
      <Container>
        <div className="flex flex-col gap-6">
          {header === undefined ? null : (
            <SectionHeader
              id={id}
              heading={header.heading}
              {...(header.intro === undefined ? {} : { intro: header.intro })}
              {...(header.action === undefined ? {} : { action: header.action })}
            />
          )}
          {children}
        </div>
      </Container>
    </section>
  );
}
