'use server';

// A GENUINE module-level Server Action boundary.
//
// It imports `@minhaj/server-core`, which is server-only and carries the
// `server-only` marker. A Client Component importing THIS module is the
// sanctioned mutation path (ARCHITECTURE.md §7): Next.js hands the client a
// callable reference and keeps the implementation — and `server-core` with it —
// on the server.
import { createLogger } from '@minhaj/server-core';

export async function recordEvent(name: string): Promise<string> {
  createLogger({ level: 'silent', nodeEnv: 'test' }).debug(name);
  return name;
}
