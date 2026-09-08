// CONTROL — MUST PASS.
// The realtime process consuming a shared package that has no prohibited
// downstream dependency. The rule must reject tunnels, not shared code.
import { MAX_SUBJECT_LENGTH } from '@minhaj/contracts-safe';

export const limit = MAX_SUBJECT_LENGTH;
