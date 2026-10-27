import type { ReactNode } from 'react';

import { Breadcrumbs, Container, PageHero } from '@/components/ui';

/**
 * The Library's page frames — one implementation of "where am I, what is this
 * and what can I do here", so every Library surface opens the same way.
 *
 * PRESENTATION ONLY. Nothing here reads data, a request or a session: the
 * static Library landing and the per-request listings and records share these
 * frames, so they must stay in the prerendered render graph's rules.
 *
 * A LISTING opens with the shared `PageHero` (its heading is interface text).
 * A RECORD opens with `RecordHero` instead, because a record's title is
 * CONTENT with its own language and direction, and the `h1` itself must carry
 * them (WCAG 3.1.2) — the shared hero marks the page language only.
 */

type Trail = readonly { readonly href?: string; readonly text: string }[];

/** The breadcrumb strip above a page's opening band. Quiet, never dominant. */
function CrumbStrip({ label, trail }: { readonly label: string; readonly trail: Trail }) {
  return (
    <Container>
      <div className="pt-5">
        <Breadcrumbs label={label} trail={trail} />
      </div>
    </Container>
  );
}

/** The body column beneath an opening band. */
function Body({ children }: { readonly children: ReactNode }) {
  return (
    <Container>
      <div className="flex flex-col gap-10 py-[var(--space-page)]">{children}</div>
    </Container>
  );
}

/**
 * A Library listing: breadcrumbs, the plain hero (the page's one `h1`, its
 * description and an optional notice), then the body.
 */
export function ListingFrame({
  breadcrumbLabel,
  trail,
  title,
  lede,
  notice,
  children,
}: {
  readonly breadcrumbLabel: string;
  readonly trail: Trail;
  readonly title: string;
  readonly lede?: string;
  /** A standing qualification of everything listed, said once under the lede. */
  readonly notice?: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <CrumbStrip label={breadcrumbLabel} trail={trail} />
      <PageHero title={title} {...(lede === undefined ? {} : { lede })}>
        {notice === undefined ? null : (
          <p className="max-w-[var(--measure-prose)] border-s-2 border-[color:var(--color-accent-rule)] ps-3 text-sm text-[color:var(--color-foreground-muted)]">
            {notice}
          </p>
        )}
      </PageHero>
      <Body>{children}</Body>
    </>
  );
}

/**
 * A Library record — a book, a research record, a magazine or an issue.
 *
 * The title and the summary are rendered in THEIR OWN language and direction;
 * the eyebrow, the metadata row and the notice are interface text. The record
 * body is a two-column layout from a laptop up: the reading column, and an
 * aside for facts, attribution and context.
 */
export function RecordFrame({
  breadcrumbLabel,
  trail,
  eyebrow,
  title,
  lang,
  dir,
  summary,
  meta,
  notice,
  aside,
  children,
}: {
  readonly breadcrumbLabel: string;
  readonly trail: Trail;
  readonly eyebrow: string;
  readonly title: string;
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  /** Paragraphs of the record's own description, in the title's language. */
  readonly summary: readonly string[];
  readonly meta?: ReactNode;
  readonly notice?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <CrumbStrip label={breadcrumbLabel} trail={trail} />
      <div className="border-b border-[color:var(--color-border)]">
        <Container>
          <header className="flex max-w-3xl flex-col gap-4 py-[var(--space-page)]">
            <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
              {eyebrow}
            </p>
            <h1
              className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
              lang={lang}
              dir={dir}
            >
              {title}
            </h1>
            {summary.map((paragraph, index) => (
              <p
                key={index}
                className="text-lede max-w-[var(--measure-prose)] text-[color:var(--color-foreground-muted)]"
                lang={lang}
                dir={dir}
              >
                {paragraph}
              </p>
            ))}
            {meta}
            {notice === undefined ? null : (
              <p className="max-w-[var(--measure-prose)] border-s-2 border-[color:var(--color-accent-rule)] ps-3 text-sm text-[color:var(--color-foreground-muted)]">
                {notice}
              </p>
            )}
          </header>
        </Container>
      </div>
      <Body>
        {aside === undefined ? (
          children
        ) : (
          /*
           * The aside comes FIRST in the document: its facts and attribution
           * are short, and on a phone they belong before a long text rather
           * than after it. From a laptop up it is placed in the end column.
           */
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
            <aside className="flex min-w-0 flex-col gap-8 lg:col-start-2 lg:row-start-1">
              {aside}
            </aside>
            <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
              {children}
            </div>
          </div>
        )}
      </Body>
    </>
  );
}

/**
 * A titled block in a record's aside or body: an `h2` and its content, labelled
 * by that heading so a screen reader can jump between them.
 */
export function RecordSection({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-subheading font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/**
 * Previous and next page links — the platform's one pager, shared with every
 * public listing (`components/media/parts.tsx`), under the name Library's
 * pages use.
 */
export { Pagination as Pager } from '../media/parts';

/** The panel a listing's GET filter form sits in, with its visible heading. */
export function FilterPanel({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] p-5"
    >
      <h2 id={id} className="text-subheading font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}
