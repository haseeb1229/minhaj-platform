// Two projects agree with this package about `#target`; ONE does not. A single
// materially incompatible independent claim is enough to fail closed (§10) —
// agreement is not a majority vote.
import type { Target } from '#target';

export type Contested = Target;
