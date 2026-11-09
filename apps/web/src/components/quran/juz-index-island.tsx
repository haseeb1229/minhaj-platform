'use client';

import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/forms';
import { Icon } from '@/components/ui/icon';
import { directionOf } from '@/config/locale';
import { filterJuz, juzIndexHref, type JuzIndexRow } from './juz-layout';
import { QUICK_JUMP_MAX_LENGTH } from './quick-jump';

/**
 * THE JUZ INDEX (Quran Part 3) — every Juz as a card: its number, the opening
 * words of its first Ayah in the Quran face, its range, the Surahs it begins
 * and ends in, and its pages and hizb — with a filter by number.
 *
 * COMPLETE WITHOUT IT. The server renders this component with the address's
 * own `?q=` already applied, inside a real GET form, so a reader without
 * JavaScript filters by submitting it. With JavaScript the same pure function
 * (`./juz-layout`) answers each keystroke, the address is kept in step on the
 * index page, and the number of Juz shown is announced politely.
 *
 * Labels are plain strings with `{placeholder}`s, filled here; this module
 * reaches no server code and no translation provider. The opening words are
 * the server's, cut from the stored text; nothing here alters them.
 */

export interface JuzIndexLabels {
  /** "Juz" — the list's accessible name. */
  readonly list: string;
  readonly filter: string;
  readonly filterHelp: string;
  readonly apply: string;
  /** "Showing {shown} of {total} Juz" */
  readonly count: string;
  /** "No Juz matches “{query}”." */
  readonly none: string;
  readonly clear: string;
  /** "Juz {number}" */
  readonly juz: string;
  /** "Surah {number}" — where no display name is recorded. */
  readonly surah: string;
  /** "Opening words" */
  readonly opening: string;
}

function fill(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

function Card({
  row,
  labels,
  Heading,
}: {
  readonly row: JuzIndexRow;
  readonly labels: JuzIndexLabels;
  readonly Heading: 'h2' | 'h3';
}) {
  return (
    <li className="relative flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised px-4 py-4 transition-colors duration-[var(--duration-fast)] focus-within:border-border-strong hover:border-border-strong hover:bg-surface-sunken">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-accent-rule bg-accent-surface text-sm font-semibold text-accent tabular-nums"
        >
          {row.number}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Heading className="text-base font-semibold">
            <a
              href={row.href}
              className="text-foreground no-underline after:absolute after:inset-0 after:rounded-panel hover:text-action"
            >
              {fill(labels.juz, { number: row.number })}
            </a>
          </Heading>
          <p className="text-caption text-foreground-muted">{row.range}</p>
        </div>
      </div>
      {row.opening === null || row.opening.text === '' ? null : (
        // Right to left whatever the interface: the words begin on the right.
        <p dir="rtl" className="min-w-0 text-start">
          <span className="sr-only">{`${labels.opening}: `}</span>
          <span lang="ar" className="quran-name text-2xl leading-loose wrap-anywhere">
            {row.opening.text}
            {row.opening.more ? <span aria-hidden="true">{' …'}</span> : null}
          </span>
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-3 text-sm">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {row.surahs.map((surah, index) => (
            <span key={surah.number} className="inline-flex min-w-0 items-baseline gap-2">
              {index === 0 ? null : (
                <span aria-hidden="true" className="text-foreground-muted">
                  –
                </span>
              )}
              {surah.name === null ? (
                <span className="font-medium">
                  {fill(labels.surah, { number: surah.number })}
                </span>
              ) : (
                <span
                  lang={surah.name.locale}
                  dir={directionOf(surah.name.locale)}
                  className={`font-medium wrap-anywhere ${surah.name.locale === 'ar' ? 'quran-name text-base' : ''}`}
                >
                  {surah.name.text}
                </span>
              )}
            </span>
          ))}
          {row.surahCount === null ? null : (
            <span className="text-foreground-muted">{`· ${row.surahCount}`}</span>
          )}
        </p>
        {row.facts === '' ? null : (
          <p className="text-caption text-foreground-muted tabular-nums">{row.facts}</p>
        )}
      </div>
    </li>
  );
}

export function JuzIndex({
  rows,
  initial,
  action,
  idPrefix,
  headingLevel,
  syncAddress,
  labels,
}: {
  readonly rows: readonly JuzIndexRow[];
  /** The address's own filter, already applied by the server. */
  readonly initial: string;
  /** Where the GET form goes: the Juz index page. */
  readonly action: string;
  /** Makes this instance's element ids unique on its page. */
  readonly idPrefix: string;
  /** The level of each card's title. */
  readonly headingLevel: 'h2' | 'h3';
  /** Keep the address in step with the filter (the index page, not the landing). */
  readonly syncAddress: boolean;
  readonly labels: JuzIndexLabels;
}) {
  const [q, setQ] = useState(initial);
  const deferred = useDeferredValue(q);
  const shown = useMemo(() => filterJuz(rows, deferred), [rows, deferred]);

  function remember(next: string) {
    if (!syncAddress) return;
    try {
      window.history.replaceState(null, '', juzIndexHref(window.location.pathname, next));
    } catch {
      /* An address that cannot be replaced leaves the list as it is. */
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // The list already answers what was typed; the landing's form still opens
    // the index page with the same request, as it does without script.
    if (!syncAddress) return;
    event.preventDefault();
  }

  const id = (part: string) => `${idPrefix}-${part}`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <form
        method="get"
        action={action}
        role="search"
        aria-label={labels.filter}
        onSubmit={onSubmit}
        className="flex min-w-0 flex-col gap-2 rounded-panel border border-border bg-surface-raised p-4"
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={id('q')} className="text-sm font-semibold">
              {labels.filter}
            </label>
            <div className="relative min-w-0">
              <Icon
                name="search"
                size={20}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-muted"
              />
              <input
                id={id('q')}
                name="q"
                type="search"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                maxLength={QUICK_JUMP_MAX_LENGTH}
                value={q}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setQ(next);
                  remember(next);
                }}
                aria-describedby={`${id('help')} ${id('count')}`}
                className="min-h-11 w-full rounded-control border border-border-strong bg-surface ps-10 pe-3 text-base"
              />
            </div>
          </div>
          <Button tone="secondary">{labels.apply}</Button>
        </div>
        <p id={id('help')} className="text-caption text-foreground-muted">
          {labels.filterHelp}
        </p>
      </form>

      <p
        id={id('count')}
        role="status"
        className="text-sm font-medium text-foreground-muted"
      >
        {fill(labels.count, { shown: shown.length, total: rows.length })}
      </p>

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-panel border border-dashed border-border-strong px-5 py-6">
          <p>{fill(labels.none, { query: deferred.trim() })}</p>
          <a
            href={action}
            onClick={(event) => {
              event.preventDefault();
              setQ('');
              remember('');
            }}
            className="inline-flex items-center gap-2 font-semibold text-action"
          >
            <Icon name="arrow-end" size={16} />
            {labels.clear}
          </a>
        </div>
      ) : (
        <ol
          aria-label={labels.list}
          className="grid list-none grid-cols-1 gap-3 p-0 *:min-w-0 sm:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((row) => (
            <Card key={row.number} row={row} labels={labels} Heading={headingLevel} />
          ))}
        </ol>
      )}
    </div>
  );
}
