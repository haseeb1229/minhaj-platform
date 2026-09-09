'use client';

// FIXTURE — MUST PASS. A Client Component calling a valid Server Action. The
// action's server-side implementation is NOT bundled for the browser, so this
// is not a client leak — it is the sanctioned mutation path (ARCHITECTURE.md
// §7).
import { sendMessage } from '@/actions/send-message';

export function Composer(): string {
  void sendMessage;
  return 'composer';
}
