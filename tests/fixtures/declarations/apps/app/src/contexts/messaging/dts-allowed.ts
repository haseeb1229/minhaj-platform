// CONTROL — MUST PASS.
// A declaration-only dependency on a PERMITTED context, through its public
// interface. Declaration edges must be classified, not blanket-rejected.
import type { Enrolment } from '../learning/index';

export type Used = Enrolment;
