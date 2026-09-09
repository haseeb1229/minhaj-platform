// The other half of the wildcard cycle, deliberately NOT at `index` — a nested
// subpath only a real pattern match resolves.
import { alpha } from '@fixture/alpha/entry';

export const beta = `beta:${String(alpha)}`;
