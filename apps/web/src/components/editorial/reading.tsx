import { localizedPath } from '@minhaj/contracts';

import type { Locale } from '@minhaj/contracts';

import { Icon } from '@/components/ui';

import type { ContentsEntry } from './long-form';

/**
 * THE PARTS OF A LONG-FORM RECORD PAGE (R2) that Articles and News share: the
 * byline as author chips, the publication facts, and the contents list.
 * Server components; the only motion is a colour transition the reduced-motion
 * rule collapses.
 */

/**
 * The people credited as AUTHORS, each a chip linking to their profile. A
 * credit whose person People no longer publishes is simply absent upstream.
 */
export function AuthorChips({
  locale,
  label,
  people,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly people: readonly { readonly slug: string; readonly name: string }[];
}) {
  if (people.length === 0) return null;
  return (
    <ul aria-label={label} className="flex list-none flex-wrap gap-2 p-0">
      {people.map((person) => (
        <li key={person.slug}>
          <a
            href={localizedPath(locale, `/people/${encodeURIComponent(person.slug)}`)}
            dir="auto"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-raised ps-1.5 pe-4 text-sm font-medium text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface active:bg-accent-rule"
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-surface text-accent">
              <Icon name="user" size={16} />
            </span>
            {person.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** One dated fact of a record ("Published 3 May 2024"), as a term and its date. */
export interface ReadingDate {
  readonly term: string;
  readonly text: string;
  /** The calendar date, `YYYY-MM-DD`. */
  readonly machine: string;
}

/** The record's publication facts, as a quiet definition list. */
export function ReadingDates({ dates }: { readonly dates: readonly ReadingDate[] }) {
  if (dates.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-foreground-muted">
      {dates.map((date) => (
        <div key={date.term} className="flex gap-1.5">
          <dt>{date.term}</dt>
          <dd>
            <time dateTime={date.machine} className="text-foreground tabular-nums">
              {date.text}
            </time>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A long record's contents: its sections as in-page links, beside the story
 * and kept in view on a wide screen, above it on a phone. Rendered only when
 * the body has sections (`withContents`).
 */
export function Contents({
  entries,
  label,
}: {
  readonly entries: readonly ContentsEntry[];
  readonly label: string;
}) {
  if (entries.length === 0) return null;
  return (
    <nav
      aria-label={label}
      className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto"
    >
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <ol className="flex list-none flex-col border-s border-border p-0 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className={entry.level === 3 ? 'ps-4' : ''}>
            <a
              href={`#${entry.id}`}
              dir="auto"
              className="-ms-px flex min-h-10 items-center border-s-2 border-transparent py-1 ps-3 text-foreground-muted no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:text-foreground"
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
