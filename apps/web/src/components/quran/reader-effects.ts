'use client';

import { useEffect, useState } from 'react';

import { ayahElementId, ayahOfFragment, windowStartOf } from './reading-layout';
import { LAST_READ_KEY, readLastRead, writeLastRead } from './reader-preferences';

/**
 * WHAT THE READER DOES AS IT IS READ (Quran Part 1) — the behaviours of a
 * reading page's island, each one effect, each reaching the page only by the
 * reader element's identifier. The text never passes through them: they
 * move it, observe it and remember a place, nothing else.
 */

function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Not kept: a private window or blocked storage forgets. */
  }
}

function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The Surah a page reads in windows, as the server declared it on the reader. */
export interface WindowedSurah {
  readonly number: number;
  readonly ayahCount: number;
  /** The first Ayah of the window the server rendered. */
  readonly start: number;
}

/**
 * LANDS A FRAGMENT ON ITS AYAH. `/quran/surah/2#ayah-2-255` (or an older
 * `#ayah-255`) names an Ayah the server may not have rendered — the fragment
 * never reaches it — so when that Ayah is not on the page the island replaces
 * the address with its window's (`?from=241#ayah-2-255`), which the server
 * renders with the Ayah in it. An Ayah that IS on the page is scrolled to,
 * marked as the current location and focused, so a keyboard or screen-reader
 * user starts there too.
 */
export function useFragmentLanding(readerId: string, surah: WindowedSurah | null): void {
  useEffect(() => {
    if (surah === null) return undefined;
    function land() {
      if (surah === null) return;
      const ayah = ayahOfFragment(window.location.hash, surah.number, surah.ayahCount);
      if (ayah === null) return;
      const id = ayahElementId({ surah: surah.number, ayah });
      const row = document.getElementById(id);
      if (row === null) {
        const start = windowStartOf(ayah);
        if (start === surah.start) return;
        const url = new URL(window.location.href);
        url.searchParams.delete('from');
        if (start > 1) url.searchParams.set('from', String(start));
        url.hash = id;
        window.location.replace(url.href);
        return;
      }
      const reader = document.getElementById(readerId);
      for (const other of reader?.querySelectorAll('[aria-current="location"]') ?? [])
        other.removeAttribute('aria-current');
      row.setAttribute('aria-current', 'location');
      row.scrollIntoView({ block: 'start' });
      const article = row.querySelector<HTMLElement>('article');
      if (article !== null) {
        article.tabIndex = -1;
        article.focus({ preventScroll: true });
      }
    }
    land();
    window.addEventListener('hashchange', land);
    return () => window.removeEventListener('hashchange', land);
  }, [readerId, surah]);
}

/**
 * THE NEXT WINDOW, BEFORE THE READER REACHES THE END. The page ends with a
 * plain link to its next window (`data-window-next`); as it comes within a
 * screen or so of view, the island fetches that same public address, takes
 * the ayat list out of it and appends its rows, then points the link at the
 * window after — or removes it at the Surah's end. A fetch that fails leaves
 * the link where it is, says so, and stops trying: the link still works.
 *
 * THE ROWS ARE THE SERVER'S. Nothing is built from strings: the fetched
 * document is parsed inertly (`DOMParser` runs no script) and its elements
 * are adopted as they are, from this site's own response for the same Surah.
 */
export function useWindowLoader(
  readerId: string,
  listId: string,
  surah: WindowedSurah | null,
  onLoaded: () => void,
  onFailed: () => void,
): void {
  useEffect(() => {
    if (surah === null || typeof IntersectionObserver === 'undefined') return undefined;
    const reader = document.getElementById(readerId);
    const list = document.getElementById(listId);
    const link = reader?.querySelector<HTMLAnchorElement>('a[data-window-next]');
    if (reader === null || list === null || link === null || link === undefined)
      return undefined;
    const next: HTMLAnchorElement = link;
    let busy = false;
    let stopped = false;
    const controller = new AbortController();

    async function more() {
      if (busy || stopped) return;
      busy = true;
      list?.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(next.href, {
          credentials: 'same-origin',
          headers: { accept: 'text/html' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('window');
        const fetched = new DOMParser().parseFromString(
          await response.text(),
          'text/html',
        );
        const rows = fetched.getElementById(listId);
        if (rows === null || rows.getAttribute('data-surah') !== String(surah?.number))
          throw new Error('window');
        for (const row of [...rows.children])
          list?.append(document.importNode(row, true));
        const following = fetched.querySelector<HTMLAnchorElement>('a[data-window-next]');
        if (following === null) {
          stopped = true;
          observer.disconnect();
          next.closest('[data-window-nav]')?.remove();
        } else {
          next.href = following.getAttribute('href') ?? next.href;
          next.textContent = following.textContent;
        }
        onLoaded();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        stopped = true;
        observer.disconnect();
        onFailed();
      } finally {
        busy = false;
        list?.removeAttribute('aria-busy');
      }
      // Still in view (a short window on a tall screen): keep going.
      if (!stopped && next.isConnected) {
        const box = next.getBoundingClientRect();
        if (box.top < window.innerHeight + 1200) void more();
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void more();
      },
      { rootMargin: '0px 0px 1200px 0px' },
    );
    observer.observe(next);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [readerId, listId, surah, onLoaded, onFailed]);
}

/**
 * THE AYAH IN VIEW: the Juz it is in, how far through the reading it is (the
 * Surah's own count where the page reads one Surah) and — on a reading page —
 * "last read" in this browser. Rows added by the window loader are observed
 * too (`version` changes when they arrive). The stored last place is marked
 * `aria-current="location"` when it is on the page.
 */
export function usePosition(
  readerId: string,
  initialJuz: number,
  remember: boolean,
  ayahCount: number | null,
  version: number,
): { readonly juz: number; readonly value: number; readonly max: number } {
  const [juz, setJuz] = useState(initialJuz);
  const [progress, setProgress] = useState({ value: 0, max: 1 });

  useEffect(() => {
    if (version !== 0) return;
    const place = readLastRead(load(LAST_READ_KEY));
    if (place === null) return;
    const reader = document.getElementById(readerId);
    // A fragment the page was opened at is the current location already.
    if (reader === null || reader.querySelector('[aria-current="location"]') !== null)
      return;
    document
      .getElementById(ayahElementId(place))
      ?.setAttribute('aria-current', 'location');
  }, [readerId, version]);

  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null || typeof IntersectionObserver === 'undefined') return undefined;
    const rows = [...reader.querySelectorAll<HTMLElement>('li[data-ayah]')];
    if (rows.length === 0) return undefined;
    let timer: number | null = null;
    // The rows inside the reading band now — kept across callbacks, because
    // each callback reports only the rows that crossed its edges.
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = rows.indexOf(entry.target as HTMLElement);
          if (index < 0) continue;
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        if (visible.size === 0) return;
        const index = Math.min(...visible);
        const row = rows[index];
        if (row === undefined) return;
        const [surah, ayah] = (row.dataset['ayah'] ?? '').split(':').map(Number);
        setProgress(
          ayahCount === null || ayah === undefined
            ? { value: index + 1, max: rows.length }
            : { value: ayah, max: ayahCount },
        );
        const rowJuz = Number(row.dataset['juz']);
        if (Number.isInteger(rowJuz) && rowJuz > 0) setJuz(rowJuz);
        if (!remember || surah === undefined || ayah === undefined) return;
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          save(LAST_READ_KEY, writeLastRead({ surah, ayah }));
        }, 800);
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );
    for (const row of rows) observer.observe(row);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [readerId, remember, ayahCount, version]);

  return { juz, value: progress.value, max: progress.max };
}
