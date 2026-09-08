// FIXTURE — MUST FAIL as a WORKSPACE cycle: alpha -> beta -> alpha.
import { beta } from '@fixture/beta';
export const alpha = (): string => beta();
