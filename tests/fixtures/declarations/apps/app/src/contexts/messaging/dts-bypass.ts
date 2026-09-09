// REVIEW #3 EXACT REPRODUCTION — MUST FAIL.
// `../quran/secret` resolves to `secret.d.ts`. TypeScript resolved it; the
// analyser then discarded every `.d.ts` result, so a genuine cross-context
// dependency on Quran internals was invisible.
import type { CanonSecret } from '../quran/secret';

export type Used = CanonSecret;
