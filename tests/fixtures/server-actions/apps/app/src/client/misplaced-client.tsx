'use client';

// FIXTURE — MUST FAIL. The target places the directive AFTER a statement, so
// it is an ordinary expression and creates no boundary.
import { misplaced } from '@/actions/misplaced-directive';

export function Misplaced(): string {
  return typeof misplaced;
}
