'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The enlarged view of a page of photographs (Phase 12).
 *
 * PROGRESSIVE ENHANCEMENT. The grid it wraps is server-rendered: every tile is a
 * real link to the photograph's own image, so without JavaScript — or before
 * this island hydrates — a visitor still opens the full image. Once hydrated, a
 * click or Enter on a tile opens this viewer instead.
 *
 * THE BROWSER'S OWN MODAL DIALOG. `<dialog>` opened with `showModal()` makes the
 * rest of the page inert (so focus cannot escape), closes on Escape, and is
 * announced as a dialog — no focus-trap code and no dialog dependency
 * (ARCHITECTURE.md §13.6). Focus goes to the close button on opening and
 * RETURNS to the tile that opened it on closing, however it closes. The page
 * behind is scroll-locked while it is open, with the same class the mobile
 * navigation uses.
 *
 * NOTHING MOVES ON ITS OWN. No slideshow, no auto-advance and no animation:
 * the visitor pages with labelled Previous and Next buttons, or the arrow keys —
 * which follow the reading direction, so in Urdu and Arabic the right arrow goes
 * back. Paging wraps at either end, so a button never disappears from under the
 * focus. The position is announced politely.
 *
 * HONEST ABOUT MISSING PICTURES. A tile whose image fails to load — bytes that
 * vanished after the page was rendered — is marked unavailable, shows a plain
 * statement instead of a broken-image box, and is skipped by the viewer.
 *
 * WORDS ARE NEVER INVENTED. The viewer shows exactly the alternative text,
 * caption, credit and date the server resolved; where there is no alternative
 * text it says so rather than describing the picture.
 */

export interface ViewerPhoto {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  /** The language the alternative text is in; absent when it is the fallback statement. */
  readonly altLang: string | null;
  readonly caption: string | null;
  readonly captionLang: string | null;
  /** The credit, the date, or both, already formatted. */
  readonly details: string | null;
}

export interface ViewerLabels {
  readonly dialog: string;
  readonly close: string;
  readonly previous: string;
  readonly next: string;
  /** Contains `{position}` and `{total}`. */
  readonly position: string;
}

/** Marks a tile whose image failed, so CSS shows its statement instead. */
function markUnavailable(image: HTMLImageElement): number | null {
  const tile = image.closest<HTMLElement>('[data-photo-tile]');
  if (tile === null) return null;
  tile.dataset['unavailable'] = 'true';
  const index =
    tile.querySelector<HTMLElement>('[data-photo-index]')?.dataset['photoIndex'];
  return index === undefined ? null : Number(index);
}

export function PhotoViewer({
  photos,
  labels,
  children,
}: {
  readonly photos: readonly ViewerPhoto[];
  readonly labels: ViewerLabels;
  readonly children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());

  const available = photos.map((_, index) => index).filter((index) => !broken.has(index));

  /**
   * Images that failed BEFORE hydration fired their error events while nobody
   * was listening; they are found by their state instead.
   */
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;
    const failed = new Set<number>();
    for (const image of grid.querySelectorAll<HTMLImageElement>('img')) {
      if (image.complete && image.naturalWidth === 0) {
        const index = markUnavailable(image);
        if (index !== null) failed.add(index);
      }
    }
    if (failed.size > 0) setBroken((previous) => new Set([...previous, ...failed]));
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  /** Whatever closed it — Escape, the button, the backdrop — focus goes back. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const onClose = () => {
      setCurrent(null);
      document.documentElement.classList.remove('shell-scroll-locked');
      openerRef.current?.focus();
    };
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, []);

  /** A navigation while it is open must not leave the document locked. */
  useEffect(
    () => () => document.documentElement.classList.remove('shell-scroll-locked'),
    [],
  );

  function open(index: number, opener: HTMLElement) {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    openerRef.current = opener;
    setCurrent(index);
    document.documentElement.classList.add('shell-scroll-locked');
    if (!dialog.open) dialog.showModal();
  }

  function step(delta: 1 | -1) {
    if (current === null || available.length === 0) return;
    const at = available.indexOf(current);
    const next = available[(at + delta + available.length) % available.length];
    if (next !== undefined) setCurrent(next);
  }

  function onGridClick(event: React.MouseEvent<HTMLDivElement>) {
    // A modified click keeps the browser's own behaviour: a new tab, a download.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      'a[data-photo-index]',
    );
    if (link === null) return;
    const index = Number(link.dataset['photoIndex']);
    if (!Number.isInteger(index) || broken.has(index) || photos[index] === undefined)
      return;
    event.preventDefault();
    open(index, link);
  }

  function onGridError(event: React.SyntheticEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    const index = markUnavailable(target);
    if (index !== null) setBroken((previous) => new Set([...previous, index]));
  }

  function onDialogKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = (event.key === 'ArrowRight') !== rtl;
    event.preventDefault();
    step(forward ? 1 : -1);
  }

  /** A click on the backdrop lands on the dialog element itself. */
  function onDialogClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) close();
  }

  const photo = current === null ? undefined : photos[current];
  const position =
    current === null
      ? ''
      : labels.position
          .replace('{position}', String(available.indexOf(current) + 1))
          .replace('{total}', String(available.length));

  return (
    <>
      <div ref={gridRef} onClick={onGridClick} onErrorCapture={onGridError}>
        {children}
      </div>

      <dialog
        ref={dialogRef}
        aria-label={labels.dialog}
        onKeyDown={onDialogKeyDown}
        onClick={onDialogClick}
        className="m-auto max-h-[100dvh] w-[min(72rem,100vw)] max-w-full overflow-y-auto rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-0 text-[color:var(--color-foreground)] backdrop:bg-[color:var(--color-foreground)]/80"
      >
        {photo === undefined ? null : (
          <figure className="flex flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                className="text-sm text-[color:var(--color-foreground-muted)]"
                aria-live="polite"
              >
                {position}
              </p>
              <button
                type="button"
                onClick={close}
                autoFocus
                className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
              >
                {labels.close}
              </button>
            </div>

            <div className="flex items-center justify-center rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)]">
              <img
                key={photo.src}
                src={photo.src}
                alt={photo.alt}
                {...(photo.altLang === null ? {} : { lang: photo.altLang })}
                width={photo.width}
                height={photo.height}
                decoding="async"
                className="h-auto max-h-[65dvh] w-auto max-w-full object-contain"
              />
            </div>

            {photo.caption === null && photo.details === null ? null : (
              <figcaption className="flex flex-col gap-1">
                {photo.caption === null ? null : (
                  <p
                    className="break-words"
                    {...(photo.captionLang === null ? {} : { lang: photo.captionLang })}
                    dir="auto"
                  >
                    {photo.caption}
                  </p>
                )}
                {photo.details === null ? null : (
                  <p
                    className="text-sm text-[color:var(--color-foreground-muted)]"
                    dir="auto"
                  >
                    {photo.details}
                  </p>
                )}
              </figcaption>
            )}

            {available.length > 1 ? (
              <div className="flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
                >
                  {labels.previous}
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
                >
                  {labels.next}
                </button>
              </div>
            ) : null}
          </figure>
        )}
      </dialog>
    </>
  );
}
