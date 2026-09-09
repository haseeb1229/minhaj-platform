'use client';

// FIXTURE — MUST FAIL. Reaching server-only code through a client-reachable
// ordinary barrel, even though the same barrel also re-exports a valid action.
import { sendMessage } from '@/shared/action-barrel';

export function Barrel(): string {
  return typeof sendMessage;
}
