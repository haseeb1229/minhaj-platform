// FIXTURE — MUST FAIL. Public entry reached directly, internals reached
// through a neutral wrapper. The mirror image of the case above.
import { isCurrentlyEnrolled } from '@/contexts/learning';
import { enrolments } from '@/shared/enrolment-wrapper';

export const check = isCurrentlyEnrolled;
export const rows = enrolments;
