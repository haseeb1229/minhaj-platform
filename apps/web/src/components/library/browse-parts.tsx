import type { ReactNode } from 'react';

import { localizedPath } from '@minhaj/contracts';
import type { LibraryKindCount } from '@minhaj/contracts/library';

import { Breadcrumbs, Container, Icon } from '@/components/ui';
import { kindHref } from './browse-view';

/**
 * LIBRARY PART 2 — what the browse and access pages share. PRESENTATION ONLY:
 * nothing here reads data or a request; each page resolves its reads and
 * passes plain values.
 *
 * LOGICAL PROPERTIES ONLY, so the same markup is right in English, Urdu and
 * Arabic; every link is a 44-pixel target.
 */

type Trail = readonly { readonly href?: string; readonly text: string }[];

/**
 * A browse page's frame: breadcrumbs (Home › Library › this page) and the
 * column the page's hero and body sit in — the shared Books listing's frame,
 * so the whole Library opens the same way.
 */
export function BrowseFrame({
  locale,
  breadcrumbLabel,
  home,
  library,
  title,
  children,
}: {
  readonly locale: string;
  readonly breadcrumbLabel: string;
  readonly home: string;
  readonly library: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const trail: Trail = [
    { href: localizedPath(locale, ''), text: home },
    { href: localizedPath(locale, '/library'), text: library },
    { text: title },
  ];
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={breadcrumbLabel} trail={trail} />
        {children}
      </div>
    </Container>
  );
}

/**
 * A Topic's or a language's holdings: one link per kind, each naming its count
 * ("12 books") and leading to that kind's listing narrowed by it.
 */
export function KindLinks({
  locale,
  label,
  kinds,
  filter,
  text,
}: {
  readonly locale: string;
  /** The list's accessible name ("What is filed under Fiqh"). */
  readonly label: string;
  readonly kinds: readonly LibraryKindCount[];
  readonly filter: { readonly topic?: string; readonly language?: string };
  readonly text: (entry: LibraryKindCount) => string;
}) {
  return (
    <ul aria-label={label} className="flex list-none flex-wrap gap-2 p-0">
      {kinds.map((entry) => (
        <li key={entry.kind} className="min-w-0">
          <a
            href={kindHref(locale, entry.kind, filter)}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-medium text-action no-underline hover:border-action hover:bg-surface-sunken"
          >
            <span className="min-w-0 wrap-anywhere tabular-nums">{text(entry)}</span>
            <Icon name="arrow-end" size={16} className="shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "Showing 25–48 of 120" under a listing's heading, polite to assistive technology. */
export function RangeSummary({ children }: { readonly children: ReactNode }) {
  return (
    <p className="text-sm text-foreground-muted" aria-live="polite">
      {children}
    </p>
  );
}

/** A closing note under a page: what its figures mean, and where to go next. */
export function ClosingNote({
  text,
  links,
}: {
  readonly text: string;
  readonly links: readonly { readonly href: string; readonly text: string }[];
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">{text}</p>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
            >
              {link.text}
              <Icon name="arrow-end" size={16} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
