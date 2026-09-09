// FIXTURE CONTROL — MUST BUILD.
// A Server Component (no 'use client') may legitimately use server-core and
// the database package. If this failed, the rule would be wrong rather than
// strict.
//
// `@minhaj/database` is imported as a NAMESPACE. Its public surface publishes
// context-owned adapters only — `getDatabaseClient` is private to the package
// (ARCHITECTURE.md §4.1) — so there is no named export to reach for, and the
// namespace import is what puts the module in this component's graph.
import { createLogger } from '@minhaj/server-core';
import * as database from '@minhaj/database';

export default function ControlPage() {
  const logger = createLogger({ level: 'silent', nodeEnv: 'test' });
  logger.debug('server component may use server-core');
  void database;
  return <main>control</main>;
}
