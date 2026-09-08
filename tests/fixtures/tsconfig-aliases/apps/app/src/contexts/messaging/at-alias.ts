// MUST FAIL — the conventional `@/*` alias, kept as a regression guard that
// the original mapping still resolves after the rewrite.
import { canon } from '@/contexts/quran';

export const used = canon;
