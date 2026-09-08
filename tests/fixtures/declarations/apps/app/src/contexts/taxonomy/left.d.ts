// MUST FAIL — one half of a cycle expressed entirely in declaration files.
import type { Right } from './right';

export interface Left {
  readonly right: Right | null;
}
