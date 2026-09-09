'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// Reaching server-core by RELATIVE SOURCE PATH, bypassing the package exports
// map entirely. The `server-only` marker inside the module is what catches it.
import { createLogger } from '../../../../../../packages/server-core/src/index';

export default function RelativeSourcePage() {
  const logger = createLogger({ level: 'info', nodeEnv: 'development' });
  return <button onClick={() => logger.info('x')}>relative source</button>;
}
