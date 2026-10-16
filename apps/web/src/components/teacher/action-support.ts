import 'server-only';

import { revalidatePath } from 'next/cache';

import type { Locale } from '@minhaj/contracts';

/**
 * What every Teacher-area Server Action does last: re-render every page of
 * the area, because a moved class, a mark or a withdrawn window may be shown
 * on any of them. Who acts is resolved first by `personalGate` — the session
 * the action re-resolves itself, never a form field — and a refusal is mapped
 * by `learningRejected`, Learning's own category vocabulary.
 */
export function refreshTeacher(locale: Locale): void {
  revalidatePath(`/${locale}/teacher`, 'layout');
}

/** One text field, as typed; the service validates its shape. */
export function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}

/** A fold choice as the form states it: a named repetition, or none. */
export function fold(form: FormData, name: string): 'earlier' | 'later' | null {
  const raw = form.get(name);
  return raw === 'earlier' || raw === 'later' ? raw : null;
}
