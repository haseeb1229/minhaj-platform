import 'server-only';

import { parsePrerenderEnv, type PrerenderEnv } from '@minhaj/contracts/env/prerender';

/**
 * Configuration a STATICALLY RENDERED page may read.
 *
 * WHY IT IS SEPARATE FROM `serverEnv()`. The public shell is prerendered, and a
 * prerender happens during `next build` — in CI, and on machines that hold no
 * production credential. `serverEnv()` validates the whole runtime environment
 * and correctly refuses a development `AUTH_SECRETS` in production, so reading
 * it from a prerendered page would make every build demand secrets it never
 * uses. This reads the two non-secret variables a prerender genuinely needs,
 * validated by the same field definitions the full server schema imports. The
 * import points at a narrow module that contains no secret-bearing schema.
 *
 * Cached after the first parse, like `serverEnv()`, for the same reason: the
 * environment does not change during a process lifetime.
 */

let cached: PrerenderEnv | null = null;

export function prerenderEnv(): PrerenderEnv {
  cached ??= parsePrerenderEnv(process.env);
  return cached;
}
