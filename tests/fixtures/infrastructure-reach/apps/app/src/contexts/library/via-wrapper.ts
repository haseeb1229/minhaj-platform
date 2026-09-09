// MUST FAIL — a DIFFERENT bounded context reaching the same infrastructure
// through a different Layer 0 route. The rule is not specific to Messaging.
import { connection } from '@fixture/wrapper';

export const used = connection;
