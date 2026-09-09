// MUST FAIL — the Quran PUBLIC declaration interface. Messaging may not depend
// on Quran at all, publicly or otherwise; this proves the finding is the
// allowlist rule and not merely an internals rule.
import type { CanonReference } from '../quran/index';

export type Used = CanonReference;
