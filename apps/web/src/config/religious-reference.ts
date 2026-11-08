import 'server-only';

import { religiousReferencePreviewSchema } from '@minhaj/contracts/quran';

import { publicIndexingEnabled } from './indexing';

/**
 * Does THIS deployment admit a `reference` Quran corpus — Rebaseline R2's
 * staging reference preview (OPEN_DECISIONS.md §1.1, owner decision
 * 2026-11-06)?
 *
 * The answer every public Quran composition root hands its reader, so a
 * reference corpus is inactive everywhere a deployment has not opted in: no
 * page, search projection, sitemap, navigation entry or audio route sees it.
 *
 * TWO CONDITIONS, BOTH REQUIRED, BOTH FAIL CLOSED:
 *
 *   1. `RELIGIOUS_REFERENCE_PREVIEW` is exactly `enabled`. Absent, empty or
 *      anything else is "no" (startup validation already refuses a value that
 *      is not `enabled`).
 *   2. The deployment is NOT indexable — read from the build's own indexing
 *      posture. Startup validation refuses the preview beside indexing; this
 *      second, independent check means a preview can never reach an indexable
 *      deployment even if that validation were bypassed.
 *
 * NON-SECRET, AND READ HERE rather than through the secret-bearing server
 * configuration, because the public roots that ask must not reach that module
 * (ARCHITECTURE.md §8.1, §8.3.1.1) — the same arrangement as
 * `./correspondence.ts`.
 */
export function religiousReferencePreviewAdmitted(): boolean {
  const parsed = religiousReferencePreviewSchema.safeParse(
    process.env['RELIGIOUS_REFERENCE_PREVIEW']?.trim() || undefined,
  );
  return parsed.success && parsed.data === 'enabled' && !publicIndexingEnabled();
}
