// REVIEW #3 EXACT REPRODUCTION — MUST FAIL.
// A `~/*` alias declared by the workspace's own tsconfig. It resolved for
// TypeScript and for the build, and was invisible to the analyser because only
// `@/*` had been hard-coded.
import { canon } from '~/contexts/quran';

export const used = canon;
