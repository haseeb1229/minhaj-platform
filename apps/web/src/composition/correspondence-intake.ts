import 'server-only';
import {
  createCorrespondencePersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';
import { createCorrespondenceIntake } from '@/contexts/editorial';
import { serverEnv } from '@/config/server-env';
let runtime: ReturnType<typeof createCorrespondenceIntake> | null = null;
export function correspondenceIntake() {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  return (runtime = createCorrespondenceIntake({
    persistence: createCorrespondencePersistence(),
    limiter: createRateLimiter(configuration),
    retentionDays: environment.CORRESPONDENCE_RETENTION_DAYS ?? null,
    key: (kind, subject) =>
      rateLimitKey({ purpose: 'editorial-' + kind, subject, configuration }),
  }));
}
