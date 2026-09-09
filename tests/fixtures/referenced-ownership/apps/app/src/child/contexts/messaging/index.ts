// Compiled as part of the REFERENCED CHILD project. `#target` must resolve
// with the CHILD's mapping (a safe target), which is what `tsc --build`
// compiles this file with — not the parent's Quran internal (§9).
import type { Target } from '#target';

export type MessagingTarget = Target;
