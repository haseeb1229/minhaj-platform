'use client';

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  readPreferences,
  writePreferences,
  type ReaderPreferences,
  type ReaderPresentation,
} from './reader-preferences';

/**
 * THE READER'S PREFERENCES, SHARED BY ITS ISLANDS (Quran Part 1). The sticky
 * bar's settings and the mode switch at the head of the text are two islands
 * of one page; both read and change the same preferences through this store,
 * so neither can show a mode the other has left.
 *
 * READ AFTER HYDRATION, NEVER DURING THE SERVER RENDER. The server snapshot is
 * the default, so the first client render is the server's (no hydration
 * mismatch, and the shared document is the same for every visitor); the
 * stored value follows from `localStorage`, guarded — a private window or
 * blocked storage forgets, it never breaks the page.
 */

let current: ReaderPreferences | null = null;
const listeners = new Set<() => void>();

function load(): ReaderPreferences {
  try {
    return readPreferences(window.localStorage.getItem(PREFERENCES_KEY));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function snapshot(): ReaderPreferences {
  return (current ??= load());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot = (): ReaderPreferences => DEFAULT_PREFERENCES;

export function useReaderPreferences(): ReaderPreferences {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Changes the preferences, keeps them in this browser and tells every island. */
export function updateReaderPreferences(next: Partial<ReaderPreferences>): void {
  current = { ...snapshot(), ...next };
  try {
    window.localStorage.setItem(PREFERENCES_KEY, writePreferences(current));
  } catch {
    /* Not kept: still applied for this visit. */
  }
  for (const listener of listeners) listener();
}

/**
 * Puts a presentation on the reader element: attributes, and the two sizes as
 * custom properties through the CSSOM (`style-src 'self'` permits it).
 */
export function applyPresentation(
  reader: HTMLElement,
  presentation: ReaderPresentation,
): void {
  if (presentation.mode !== null) reader.setAttribute('data-mode', presentation.mode);
  reader.setAttribute('data-shown', presentation.shown);
  reader.setAttribute('data-leading', presentation.leading);
  reader.setAttribute('data-layout', presentation.layout);
  reader.setAttribute('data-notes', presentation.notes);
  if (presentation.arabicScale === null)
    reader.style.removeProperty('--quran-arabic-scale');
  else reader.style.setProperty('--quran-arabic-scale', String(presentation.arabicScale));
  reader.style.setProperty(
    '--quran-translation-scale',
    String(presentation.translationScale),
  );
}
