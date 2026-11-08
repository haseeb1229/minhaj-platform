'use client';

import { useEffect, useId, useState } from 'react';

import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';

/**
 * THE SEARCH PALETTE (R2) — one search from every page, opened by the header's
 * Search button or by Ctrl+K (⌘K on a Mac).
 *
 * A REAL FORM. It submits `q` to the search page by GET, exactly as a form
 * without JavaScript would; the palette adds only the dialog and the shortcut.
 * Beneath the field it lists the platform's present areas as quick links,
 * narrowed as the visitor types — navigation, never a guessed result.
 *
 * Everything shown is handed in already translated by the server; the browser
 * receives the labels and the present areas, nothing else.
 */
export function SearchPalette({
  action,
  maxLength,
  labels,
  quickLinks,
}: {
  /** The locale's search page. */
  readonly action: string;
  readonly maxLength: number;
  readonly labels: {
    readonly open: string;
    readonly title: string;
    readonly field: string;
    readonly placeholder: string;
    readonly submit: string;
    readonly close: string;
    readonly quickLinks: string;
    readonly noQuickLinks: string;
  };
  readonly quickLinks: readonly { readonly href: string; readonly label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fieldId = `${useId()}-q`;

  // The shortcut, everywhere on the page. Ctrl+K is also the browser's own
  // "search the web" key in some browsers; on a page that offers its own
  // search, this page's search is the more useful answer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const needle = query.trim().toLocaleLowerCase();
  const matching =
    needle === ''
      ? quickLinks
      : quickLinks.filter((link) => link.label.toLocaleLowerCase().includes(needle));

  return (
    <>
      {/* A LINK FIRST: without JavaScript it opens the search page itself;
          with it, the press opens the palette instead. */}
      <a
        href={action}
        onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
          event.preventDefault();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control text-sm font-medium text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border xl:border xl:border-border-strong"
      >
        <Icon name="search" />
        {/* Named, never labelled on screen: the nine domains need the row. */}
        <span className="sr-only">{labels.open}</span>
      </a>
      <Dialog
        title={labels.title}
        hideTitle
        closeLabel={labels.close}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <form role="search" action={action} method="get" className="flex items-stretch">
          <label className="sr-only" htmlFor={fieldId}>
            {labels.field}
          </label>
          <input
            id={fieldId}
            data-autofocus
            type="search"
            name="q"
            required
            maxLength={maxLength}
            enterKeyHint="search"
            autoComplete="off"
            placeholder={labels.placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-12 w-full min-w-0 rounded-s-control border border-e-0 border-border-strong bg-surface px-4 text-base text-foreground placeholder:text-foreground-muted focus-visible:border-action"
          />
          <button
            type="submit"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-e-control bg-action text-action-foreground transition-colors duration-[var(--duration-fast)] hover:bg-action-hover"
          >
            <Icon name="search" />
            <span className="sr-only">{labels.submit}</span>
          </button>
        </form>

        <nav aria-label={labels.quickLinks} className="mt-6">
          <p className="text-caption font-semibold text-foreground-muted">
            {labels.quickLinks}
          </p>
          {matching.length === 0 ? (
            <p className="mt-2 text-sm text-foreground-muted">{labels.noQuickLinks}</p>
          ) : (
            <ul className="mt-2 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
              {matching.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-foreground no-underline hover:bg-surface-sunken"
                  >
                    <Icon name="arrow-end" size={16} className="text-accent" />
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </Dialog>
    </>
  );
}
