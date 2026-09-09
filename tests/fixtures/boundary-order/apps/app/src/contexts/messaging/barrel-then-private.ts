// FIXTURE — MUST FAIL. Public entry reached THROUGH A BARREL, internals
// reached directly. The barrel makes the legal reach transitive and the
// illegal one direct — different trail lengths, same requirement.
import { isCurrentlyEnrolled } from '@/shared/learning-barrel';
import { enrolments } from '@/contexts/learning/internal/enrolment-repository';

export const check = isCurrentlyEnrolled;
export const rows = enrolments;
