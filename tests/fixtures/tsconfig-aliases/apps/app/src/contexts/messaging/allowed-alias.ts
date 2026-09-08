// CONTROL — MUST PASS.
// `messaging -> learning` is the one permitted same-level edge (§3.2), reached
// through its public interface via an alias. A rule that also rejected this
// would be a wrong rule, not a strict one.
import { course } from '~/contexts/learning';

export const used = course;
