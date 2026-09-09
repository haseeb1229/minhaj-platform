// Messaging is an INCLUDED root of the project. It imports a declaration the
// project's `exclude` removes from root discovery — which `tsc -p` loads
// anyway, because `exclude` governs discovery and never the module closure.
import type { Barrel } from '../../shared/barrel';

export const messaging: Barrel = { ok: true };
