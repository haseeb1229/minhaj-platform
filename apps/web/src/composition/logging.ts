import 'server-only';

import { createLogger, type Logger } from '@minhaj/server-core/logger';

import { serverEnv } from '@/config/server-env';

/**
 * THE application logger, composed here.
 *
 * `createLogger` deliberately takes its level and environment as arguments
 * rather than reading `process.env` itself, so the package has one job and the
 * caller validates configuration first. Layer 4 is that caller: this is the one
 * place the validated environment and the logging package meet
 * (ARCHITECTURE.md §3.1.1).
 *
 * Built lazily and cached. Constructing it at import time would read
 * configuration during a build, which is exactly what `serverEnv()` is
 * arranged to avoid.
 *
 * WHAT IT NEVER RECEIVES. Passwords, tokens, connection strings, message
 * bodies, recipient addresses. The package redacts and sanitises what reaches
 * it, but a value that is never passed cannot be leaked by a redaction rule
 * with a gap in it (SECURITY_BASELINE.md §19.2).
 */
let cached: Logger | null = null;

export function appLogger(): Logger {
  const environment = serverEnv();

  cached ??= createLogger({
    level: environment.LOG_LEVEL,
    nodeEnv: environment.NODE_ENV,
  });

  return cached;
}
