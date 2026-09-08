// FIXTURE — MUST FAIL. messaging -> learning is allowed, but internals are not,
// and a relative path must not evade that.
import { table } from '../learning/internal/enrolment-repository';
export const t = table;
