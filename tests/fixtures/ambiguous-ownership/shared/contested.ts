// Compiled by BOTH apps/alpha and apps/beta, which map `#shared/*` to
// different directories — so this one import resolves to two different files
// depending on which project is building. There is no correct single answer,
// and the gate must fail closed rather than pick a convenient one (§6).
import type { Target } from '#shared/target';

export type Contested = Target;
