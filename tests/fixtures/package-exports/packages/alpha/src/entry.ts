// REVIEW #3 EXACT REPRODUCTION — MUST FAIL as a workspace cycle.
// `"./*": "./src/*.ts"` is a WILDCARD export. The previous analyser matched
// export keys exactly, so this resolved for TypeScript and for the build while
// the cycle stayed invisible.
import { beta } from '@fixture/beta/nested/deep';

export const alpha = `alpha:${beta}`;
