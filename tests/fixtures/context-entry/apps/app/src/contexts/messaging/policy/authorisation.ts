// FIXTURE — MUST PASS. The same thing one level deeper and sideways: a nested
// own-context module reaching another nested own-context module.
import { conversations } from '../internal/store/conversations';

export const known = conversations.length;
