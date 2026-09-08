// MUST FAIL — an alias reaching a context's INTERNALS. Public-interface policy
// applies to aliased routes exactly as it does to relative ones.
import { rows } from '~/contexts/quran/internal/repository';

export const used = rows;
