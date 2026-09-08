// ROOT-owned here, and pulled into THREE independent app closures. All four
// projects map `#target` to this same file, so nothing is contested (§10).
import type { Target } from '#target';

export type Contested = Target;
