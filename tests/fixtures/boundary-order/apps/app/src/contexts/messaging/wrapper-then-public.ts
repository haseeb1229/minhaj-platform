// FIXTURE — MUST FAIL. This is the reverse source order of
// public-then-wrapper.ts: the private route arrives through a neutral wrapper
// first and the legal public entry arrives directly second.
import { enrolments } from '@/shared/enrolment-wrapper';
import { isCurrentlyEnrolled } from '@/contexts/learning';

export const rows = enrolments;
export const check = isCurrentlyEnrolled;
