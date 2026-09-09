'use client';

// FIXTURE — MUST FAIL. The target's "directive" is a comment and a string
// constant. `'use server'` is not a text marker; it is read from the real
// module prologue.
import { pretend } from '@/actions/commented-directive';

export function Commented(): string {
  return typeof pretend;
}
