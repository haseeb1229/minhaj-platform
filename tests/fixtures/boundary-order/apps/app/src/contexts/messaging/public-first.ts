// FIXTURE — MUST FAIL. The legal public entry is declared FIRST and the
// forbidden internals second. Recording only the first boundary entry reached
// let the public import mask the breach entirely.
import { isCurrentlyEnrolled } from '@/contexts/learning';
import { enrolments } from '@/contexts/learning/internal/enrolment-repository';

export const check = isCurrentlyEnrolled;
export const rows = enrolments;
