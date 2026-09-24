import 'server-only';

import { applicationOrigin } from '@/config/origin';

/**
 * Anti-CSRF for a Class-A Route Handler mutation (SECURITY_BASELINE.md §7.1
 * rules 3, 4, 6 and 7).
 *
 * WHY THIS EXISTS. A Server Action carries the framework's own Origin check; a
 * Route Handler carries none, and rule 6 says it must not assume one. Phase 11's
 * audio upload is the first browser mutation that cannot be a Server Action —
 * the Server Action body cap is global and is not raised (§10.1) — so the
 * protection is explicit here, once, for any Route Handler mutation that needs
 * it.
 *
 * THREE INDEPENDENT CHECKS, ALL REQUIRED:
 *
 *   1. `Origin` IS PRESENT AND IS EXACTLY THE APPLICATION'S ORIGIN — the one
 *      configured origin (`AUTH_BASE_URL`), not the `Host` header. A browser
 *      always sends `Origin` on a cross-origin POST and on a same-origin
 *      `fetch`/XHR POST, so a missing one is refused rather than guessed about.
 *      Comparing against the CONFIGURED origin is stronger than comparing
 *      against `Host`, which a proxy rewrites and which a DNS-rebinding attacker
 *      controls.
 *   2. FETCH METADATA, where the browser sends it: `Sec-Fetch-Site` must be
 *      `same-origin`. A same-site-but-other-origin or cross-site request is
 *      refused even if something upstream mangled `Origin`.
 *   3. A CUSTOM REQUEST HEADER naming the intended operation. A header no HTML
 *      form can set makes the request non-simple, so a cross-origin page would
 *      need a CORS preflight, which this platform never approves.
 *
 * SameSite session cookies remain a further layer, never the only one (rule 5).
 * Everything here reads request metadata only — never a body, never a cookie —
 * and a request that fails any check is refused before authentication is even
 * consulted.
 */
export function isSameOriginMutation(
  request: Request,
  intent: { readonly header: string; readonly value: string },
): boolean {
  if (request.method !== 'POST') return false;

  const origin = request.headers.get('origin');
  if (origin === null || origin !== applicationOrigin()) return false;

  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;

  return request.headers.get(intent.header) === intent.value;
}
