import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import type { PublicSurah } from '@minhaj/contracts/quran';

import { Button, Icon, Stat } from '@/components/ui';
import { surahName } from './presentation';
import { tafsirSurahPath } from './tafsir-layout';
import type { SurahChip } from './books-view';

/**
 * THE QURAN SECTION'S EXPLORE HUBS (Quran Part 10) — the parts a hub of
 * material from another owner shares: Books (Part 10) and Videos (Part 11).
 * Each hub is Layer-4 composition of its owner's public reads; these parts
 * read nothing and take only what a page resolved.
 *
 *   ExploreHero      the hub's header: eyebrow, title, lede, the figures it
 *                    can truthfully state, and the ways onward;
 *   ExploreFilters   a GET form of plain controls — every view an address,
 *                    usable without script;
 *   ActiveFilters    what narrows the view now, each removable by a link;
 *   PassageChips     the Surahs a book or a lecture explains, each a link to
 *                    that Surah's tafsir;
 *   languageName     a content language named in the interface language.
 *
 * LOGICAL PROPERTIES ONLY, so the same markup is right in English, Urdu and
 * Arabic; every control is a 44-pixel target.
 */

/** A content language named in the interface language ("Urdu" on an English page). */
export function languageName(code: string, locale: Locale): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(code) ??
      code
    );
  } catch {
    return code;
  }
}

export function ExploreHero({
  eyebrow,
  title,
  lede,
  stats,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly stats: readonly {
    /** A count, or a figure already written for the reader (a span of years). */
    readonly value: number | string;
    readonly label: string;
    readonly href?: string;
  }[];
  readonly actions: readonly { readonly href: string; readonly text: string }[];
}) {
  return (
    <header className="flex flex-col gap-6 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-8">
      <div className="flex max-w-3xl min-w-0 flex-col gap-3">
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
          {eyebrow}
        </p>
        <h1 className="text-display font-semibold tracking-[var(--tracking-display)] text-balance">
          {title}
        </h1>
        <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
          {lede}
        </p>
      </div>
      {stats.length === 0 ? null : (
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {stats.map((stat) => (
            <Stat
              key={stat.label}
              value={stat.value}
              label={stat.label}
              {...(stat.href === undefined ? {} : { href: stat.href })}
            />
          ))}
        </div>
      )}
      {actions.length === 0 ? null : (
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {actions.map((action) => (
            <li key={action.href}>
              <a
                href={action.href}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline"
              >
                {action.text}
                <Icon name="arrow-end" size={16} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

/**
 * A REAL `<form method="get">` to the hub's own address: the controls are its
 * children, laid out in one row where there is room and stacked on a phone.
 * Hidden fields carry the parts of the view the form does not show (the
 * shelf), and the page parameter is never carried — a changed filter starts
 * again at the first page.
 */
export function ExploreFilters({
  action,
  label,
  hidden,
  submit,
  reset,
  children,
}: {
  readonly action: string;
  readonly label: string;
  readonly hidden: readonly { readonly name: string; readonly value: string }[];
  readonly submit: string;
  /** Shown only while something narrows the view. */
  readonly reset: { readonly href: string; readonly text: string } | null;
  readonly children: ReactNode;
}) {
  return (
    <form
      method="get"
      action={action}
      aria-label={label}
      className="grid grid-cols-1 items-end gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]"
    >
      {hidden.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
      {children}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button>{submit}</Button>
        {reset === null ? null : (
          <a
            href={reset.href}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-action underline-offset-4 hover:underline"
          >
            {reset.text}
          </a>
        )}
      </div>
    </form>
  );
}

/** The filters narrowing the view now, each with a link that removes it alone. */
export function ActiveFilters({
  label,
  filters,
}: {
  readonly label: string;
  readonly filters: readonly {
    readonly key: string;
    readonly text: ReactNode;
    readonly removeHref: string;
    readonly removeLabel: string;
  }[];
}) {
  if (filters.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {filters.map((filter) => (
        <li key={filter.key} className="min-w-0">
          <a
            href={filter.removeHref}
            aria-label={filter.removeLabel}
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-action bg-surface-raised px-4 text-sm font-medium text-foreground no-underline hover:bg-surface-sunken"
          >
            <span className="min-w-0 wrap-anywhere">{filter.text}</span>
            <Icon name="close" size={16} className="shrink-0 text-foreground-muted" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Surahs a book or a lecture explains: each a chip naming the Surah (in
 * the interface's script where the reader records one, else its Arabic name,
 * marked as Arabic) with the citations, linking to that Surah's tafsir.
 */
export function PassageChips({
  locale,
  label,
  chips,
  more,
  moreText,
  surahs,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly chips: readonly SurahChip[];
  readonly more: number;
  readonly moreText: string;
  readonly surahs: ReadonlyMap<number, PublicSurah>;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-caption font-semibold text-foreground-muted">{label}</p>
      <ul aria-label={label} className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const surah = surahs.get(chip.surah);
          const name = surah === undefined ? null : surahName(surah, locale);
          return (
            <li key={chip.surah} className="min-w-0 max-w-full">
              <a
                href={tafsirSurahPath(locale, chip.surah)}
                className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-1.5 rounded-full border border-border-strong bg-surface-raised px-3 py-1 text-caption font-medium text-foreground no-underline hover:border-accent"
              >
                {name === null ? null : (
                  <span
                    lang={name.locale}
                    className={`wrap-anywhere ${name.locale === 'ar' ? 'quran-name' : ''}`}
                  >
                    {name.text}
                  </span>
                )}
                <bdi
                  dir="ltr"
                  className="min-w-0 font-semibold wrap-anywhere text-accent tabular-nums"
                >
                  {chip.citations.join(' · ')}
                </bdi>
              </a>
            </li>
          );
        })}
        {more === 0 ? null : (
          <li className="inline-flex min-h-11 items-center px-1 text-caption text-foreground-muted">
            {moreText}
          </li>
        )}
      </ul>
    </div>
  );
}
