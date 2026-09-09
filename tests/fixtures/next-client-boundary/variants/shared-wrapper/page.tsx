'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// Client -> shared wrapper -> server-core.
import { createLogger } from '@/shared/server-wrapper';

export default function SharedWrapperPage() {
  const logger = createLogger({ level: 'info', nodeEnv: 'development' });
  return <button onClick={() => logger.info('x')}>shared wrapper</button>;
}
