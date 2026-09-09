// MUST FAIL — the other half. A cycle is a cycle whatever specifier text
// expresses it.
import { alpha } from '#domain/contexts/taxonomy/alpha';

export const beta = `beta:${String(alpha)}`;
