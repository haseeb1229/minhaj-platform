// FIXTURE — MUST FAIL. Hosting a context's service means depending on that
// context's PUBLIC interface. The host "never bypasses a bounded context's
// public interface" (ARCHITECTURE.md §3.1).
export type { MessageStore } from '../../../apps/web/src/contexts/messaging/internal/port';
