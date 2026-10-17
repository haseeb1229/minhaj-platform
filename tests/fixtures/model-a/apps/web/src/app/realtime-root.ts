// FIXTURE — MUST PASS. The realtime PROCESS's composition root (Phase 25).
//
// Layer 4 wires the context service to its context-owned adapter — exactly as
// `compose.ts` does for the web process — and hands the realtime transport the
// composed SERVICE. The transport's own import graph (`gateway.ts`) never
// contains the database package; this root's does, legitimately, and what it
// passes on is a narrow port, never a client, delegate, transaction handle or
// raw-query facility (ARCHITECTURE.md §3.1.1, §3.3).
import { attach } from '../../../realtime/src/gateway';
import { createMessageStore } from '@fixture/model-a-database';
import type { MessagingService } from '../contexts/messaging';

export const realtimeMessaging: MessagingService = attach(createMessageStore());
