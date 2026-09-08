'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// A Client Component reaching server-core through its subpath export.
import { createLogger } from '@minhaj/server-core/logger';

export default function SubpathPage() {
  const logger = createLogger({ level: 'info', nodeEnv: 'development' });
  return <button onClick={() => logger.info('x')}>subpath</button>;
}
