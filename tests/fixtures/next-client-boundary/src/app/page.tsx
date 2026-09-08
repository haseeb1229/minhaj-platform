// FIXTURE CONTROL — MUST BUILD.
// A Server Component (no 'use client') may legitimately use server-core.
// If this failed, the rule would be wrong rather than strict.
import { createLogger } from '@minhaj/server-core';
import { getDatabaseClient } from '@minhaj/database';

export default function ControlPage() {
  const logger = createLogger({ level: 'silent', nodeEnv: 'test' });
  logger.debug('server component may use server-core');
  void getDatabaseClient;
  return <main>control</main>;
}
