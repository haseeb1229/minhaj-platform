'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// A real Client Component importing server-core directly.
import { createLogger } from '@minhaj/server-core';

export default function DirectPage() {
  const logger = createLogger({ level: 'info', nodeEnv: 'development' });
  return <button onClick={() => logger.info('x')}>direct</button>;
}
