'use server';

// FIXTURE — MUST FAIL, on the ARCHITECTURE rule rather than the client one.
//
// Stopping the client-bundle walk at a Server Action boundary exempts the
// action from NOTHING else (§7.2). This module is a valid boundary AND reaches
// Learning's internals, so `context-internal-import` must still be reported —
// a directive decides what is bundled for the browser, never what a bounded
// context may depend on.
import { enrolments } from '@/contexts/learning/internal/enrolments';

export async function publish(): Promise<number> {
  return enrolments.length;
}
