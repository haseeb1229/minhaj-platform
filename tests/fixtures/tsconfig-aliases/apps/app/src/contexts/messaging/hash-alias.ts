// MUST FAIL — an arbitrary alias shape. The rule is not "support one more
// alias"; it is "resolve whatever the workspace declares".
import { canon } from '#domain/contexts/quran';

export const used = canon;
