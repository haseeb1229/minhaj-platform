import 'server-only';

/**
 * Messaging's application services, hosted here for both processes
 * (ARCHITECTURE.md §3.1, §3.1.3). Messaging owns every rule below; this host
 * owns none. Nothing exported here is a database, storage or transaction
 * capability — only the service, its refusal vocabulary and the default-deny
 * peer policy.
 */

export {
  MESSAGING_REFUSAL_REASONS,
  MessagingRefusal,
  messagingFailure,
} from './types.ts';
export type {
  MessagingCapabilities,
  MessagingRateRules,
  MessagingRefusalReason,
  MessagingService,
  MessagingServiceDependencies,
  StartableConversation,
  SupportConversationView,
} from './types.ts';
export { MESSAGING_RATE_RULES, createMessagingService, denyAllPeers } from './service.ts';
export { createRealtimeMessaging, realtimeOver } from './realtime.ts';
export type { RealtimeConversation, RealtimeMessaging } from './realtime.ts';
