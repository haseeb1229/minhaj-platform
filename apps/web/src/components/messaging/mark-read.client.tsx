'use client';

import { useEffect, useRef } from 'react';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';

/**
 * Marks a conversation read once its newest page has been shown
 * (DELIVERY_PLAN.md Phase 24).
 *
 * THE SAME SERVER ACTION THE NO-JAVASCRIPT FORM POSTS, called once after the
 * page mounts with the newest sequence the page rendered — never a higher one
 * the reader has not seen. The service clamps it, never lowers a high-water
 * mark, and re-decides on this request whether the reader may still read the
 * conversation at all. It renders nothing.
 *
 * ONCE PER POSITION. The action's refresh re-renders the page, and a
 * re-rendered page may hand this island a new action reference; the guard is
 * the conversation and sequence it last marked, so a refresh never becomes a
 * loop of marks.
 */
export function MarkReadOnView({
  action,
  locale,
  conversationId,
  sequence,
}: {
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  readonly locale: string;
  readonly conversationId: string;
  readonly sequence: number;
}) {
  const marked = useRef<string | null>(null);

  useEffect(() => {
    const key = `${conversationId}:${String(sequence)}`;
    if (marked.current === key) return;
    marked.current = key;
    const form = new FormData();
    form.set('locale', locale);
    form.set('conversationId', conversationId);
    form.set('sequence', String(sequence));
    // A failure changes nothing the reader sees; the next view tries again.
    action({ status: 'idle' }, form).catch(() => undefined);
  }, [action, locale, conversationId, sequence]);

  return null;
}
