// MUST FAIL — one half of a cycle expressed entirely through aliases.
import { beta } from '~/contexts/taxonomy/beta';

export const alpha = `alpha:${beta}`;
