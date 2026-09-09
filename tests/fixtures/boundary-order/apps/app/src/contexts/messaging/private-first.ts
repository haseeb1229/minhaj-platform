// FIXTURE — MUST FAIL. The SAME pair, declared in the opposite order. The
// verdict must be identical: an architecture gate whose answer depends on
// statement order is not enforcing anything, and reordering imports must never
// silence a finding.
import { enrolments } from '@/contexts/learning/internal/enrolment-repository';
import { isCurrentlyEnrolled } from '@/contexts/learning';

export const rows = enrolments;
export const check = isCurrentlyEnrolled;
