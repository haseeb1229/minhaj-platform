// MUST FAIL — the other half.
import type { Left } from './left';

export interface Right {
  readonly left: Left | null;
}
