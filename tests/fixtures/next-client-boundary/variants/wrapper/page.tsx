'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// A Client Component reaching server-core via a re-export wrapper. Laundering
// the import through an intermediate module must not launder the boundary.
import { createLogger } from '@/wrapper/reexport';

export default function WrapperPage() {
  const logger = createLogger({ level: 'info', nodeEnv: 'development' });
  return <button onClick={() => logger.info('x')}>wrapper</button>;
}
