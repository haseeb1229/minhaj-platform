'use server';

// A GENUINE Server Action boundary. Next.js replaces a Client Component's
// import of this module with a callable reference; the implementation below,
// and everything it imports, stays on the server (ARCHITECTURE.md §7).
import { createLogger } from '@minhaj/server-core';

export async function sendMessage(body: string): Promise<string> {
  createLogger({ level: 'silent', nodeEnv: 'test' }).debug('sending');
  return body;
}
