'use client';

import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';

import { Button, Select } from '@/components/ui/forms';
import { Icon } from '@/components/ui/icon';
import { directionOf } from '@/config/locale';
import { QUICK_JUMP_MAX_LENGTH } from './quick-jump';
import {
  SURAH_SORTS,
  arrangeSurahs,
  filterSurahs,
  foldRows,
  surahIndexHref,
  type SurahGroup,
  type SurahIndexQuery,
  type SurahIndexRow,
  type SurahSort,
} from './surah-index';

/**
 * THE SURAH INDEX (Quran Part 2) — every Surah as a row, with a filter that
 * narrows as the reader types and a choice of order.
 *
 * COMPLETE WITHOUT IT. The server renders this component with the address's
 * own `?q=` and `?sort=` already applied, inside a real GET form, so a reader
 * without JavaScript filters and orders by submitting it. With JavaScript the
 * same pure functions (`./surah-index`) answer each keystroke, the address is
 * kept in step on the index page so a filtered list can be shared or reloaded,
 * and the number of Surahs shown is announced politely.
 *
 * Labels are plain strings with `{placeholder}`s, filled here; this module
 * reaches no server code and no translation provider.
 */

export interface SurahIndexLabels {
  /** "Surahs" — the list's accessible name. */
  readonly list: string;
  readonly filter: string;
  readonly filterHelp: string;
  readonly order: string;
  readonly sorts: Readonly<Record<SurahSort, string>>;
  readonly apply: string;
  /** "Showing {shown} of {total} Surahs" */
  readonly count: string;
  /** "No Surah matches “{query}”." */
  readonly none: string;
  readonly clear: string;
  /** "Surah {number}" — the link's name when no display name is recorded, and its prefix. */
  readonly surah: string;
  /** Group headings, by revelation place. */
  readonly groups: Readonly<Record<Exclude<SurahGroup['key'], 'all'>, string>>;
}

function fill(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

function Row({
  row,
  labels,
  Heading,
}: {
  readonly row: SurahIndexRow;
  readonly labels: SurahIndexLabels;
  readonly Heading: 'h2' | 'h3' | 'h4';
}) {
  const number = fill(labels.surah, { number: row.number });
  // An Urdu or Arabic reader's title IS the Arabic name: it is then set in the
  // Quran face once, rather than repeated at the row's end.
  const arabicTitle =
    row.name !== null && row.name.locale === 'ar' && row.name.text === row.nameArabic;
  return (
    <li className="relative flex min-w-0 items-center gap-4 rounded-panel border border-border bg-surface-raised px-4 py-3 transition-colors duration-[var(--duration-fast)] focus-within:border-border-strong hover:border-border-strong hover:bg-surface-sunken">
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-full border border-accent-rule bg-accent-surface text-sm font-semibold text-accent tabular-nums"
      >
        {row.number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Heading className="min-w-0 text-base font-semibold">
          <a
            href={row.href}
            className="text-foreground no-underline after:absolute after:inset-0 after:rounded-panel hover:text-action"
          >
            {row.name === null ? (
              number
            ) : (
              <>
                <span className="sr-only">{`${number} · `}</span>
                <span
                  lang={row.name.locale}
                  dir={directionOf(row.name.locale)}
                  className={
                    arabicTitle
                      ? 'quran-name text-xl leading-loose wrap-anywhere'
                      : 'wrap-anywhere'
                  }
                >
                  {row.name.text}
                </span>
              </>
            )}
          </a>
        </Heading>
        {row.meaning === null ? null : (
          <p
            lang={row.meaning.locale}
            dir={directionOf(row.meaning.locale)}
            className="text-sm wrap-anywhere text-foreground-muted"
          >
            {row.meaning.text}
          </p>
        )}
        <p className="text-caption text-foreground-muted">{row.facts}</p>
      </div>
      {row.nameArabic === null || arabicTitle ? null : (
        // Whatever a source supplies wraps rather than squeezing the title or
        // widening the page: it may take at most two fifths of the row.
        <span
          lang="ar"
          dir="rtl"
          className="quran-name max-w-[40%] min-w-0 shrink text-end text-2xl leading-loose wrap-anywhere"
        >
          {row.nameArabic}
        </span>
      )}
    </li>
  );
}

const LIST_CLASSES =
  'grid list-none grid-cols-1 gap-3 p-0 *:min-w-0 sm:grid-cols-2 xl:grid-cols-3';

export function SurahIndex({
  rows,
  initial,
  action,
  idPrefix,
  headingLevel,
  syncAddress,
  labels,
}: {
  readonly rows: readonly SurahIndexRow[];
  /** The address's own request, already applied by the server. */
  readonly initial: SurahIndexQuery;
  /** Where the GET form goes: the Surah index page. */
  readonly action: string;
  /** Makes this instance's element ids unique on its page. */
  readonly idPrefix: string;
  /** The level of a revelation group's heading; each row's is one below. */
  readonly headingLevel: 'h2' | 'h3';
  /** Keep the address in step with the filter (the index page, not the landing). */
  readonly syncAddress: boolean;
  readonly labels: SurahIndexLabels;
}) {
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<SurahSort>(initial.sort);
  const deferred = useDeferredValue(q);
  const folded = useMemo(() => foldRows(rows), [rows]);
  const shown = useMemo(() => filterSurahs(folded, deferred), [folded, deferred]);
  const groups = useMemo(() => arrangeSurahs(shown, sort), [shown, sort]);
  // One list: each row's title at `headingLevel`. Grouped: the group heading
  // takes that level and each row's title sits one below it.
  const GroupHeading = headingLevel;
  const GroupedRowHeading = headingLevel === 'h2' ? 'h3' : 'h4';

  function remember(next: SurahIndexQuery) {
    if (!syncAddress) return;
    try {
      window.history.replaceState(
        null,
        '',
        surahIndexHref(window.location.pathname, next),
      );
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
  const count = fill(labels.count, { shown: shown.length, total: rows.length });

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
                  remember({ q: next, sort });
                }}
                aria-describedby={`${id('help')} ${id('count')}`}
                className="min-h-11 w-full rounded-control border border-border-strong bg-surface ps-10 pe-3 text-base"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-56">
            <label htmlFor={id('sort')} className="text-sm font-semibold">
              {labels.order}
            </label>
            <Select
              id={id('sort')}
              name="sort"
              value={sort}
              onChange={(event) => {
                const next = event.currentTarget.value as SurahSort;
                setSort(next);
                remember({ q, sort: next });
              }}
            >
              {SURAH_SORTS.map((option) => (
                <option key={option} value={option}>
                  {labels.sorts[option]}
                </option>
              ))}
            </Select>
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
        {count}
      </p>

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-panel border border-dashed border-border-strong px-5 py-6">
          <p>{fill(labels.none, { query: deferred.trim() })}</p>
          <a
            href={surahIndexHref(action, { q: '', sort })}
            onClick={(event) => {
              event.preventDefault();
              setQ('');
              remember({ q: '', sort });
            }}
            className="inline-flex items-center gap-2 font-semibold text-action"
          >
            <Icon name="arrow-end" size={16} />
            {labels.clear}
          </a>
        </div>
      ) : groups.length === 1 && groups[0]?.key === 'all' ? (
        <ol aria-label={labels.list} className={LIST_CLASSES}>
          {groups[0].rows.map((row) => (
            <Row key={row.number} row={row} labels={labels} Heading={headingLevel} />
          ))}
        </ol>
      ) : (
        groups.map((group) => {
          if (group.key === 'all') return null;
          const headingId = id(`group-${group.key}`);
          return (
            <section
              key={group.key}
              aria-labelledby={headingId}
              className="flex flex-col gap-3"
            >
              <GroupHeading id={headingId} className="text-lg font-semibold">
                {labels.groups[group.key]}{' '}
                <span className="text-sm font-medium text-foreground-muted tabular-nums">
                  ({group.rows.length})
                </span>
              </GroupHeading>
              <ol aria-labelledby={headingId} className={LIST_CLASSES}>
                {group.rows.map((row) => (
                  <Row
                    key={row.number}
                    row={row}
                    labels={labels}
                    Heading={GroupedRowHeading}
                  />
                ))}
              </ol>
            </section>
          );
        })
      )}
    </div>
  );
}
