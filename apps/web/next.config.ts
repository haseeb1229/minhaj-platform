import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { parsePrerenderEnv } from '@minhaj/contracts/env/prerender-build';

/**
 * Next.js configuration.
 *
 * The next-intl plugin resolves `src/i18n/request.ts` — one of its default
 * locations — and aliases it so the server can load per-request configuration.
 * It is the only wiring the library needs at build time; the routing rules
 * themselves live in `src/i18n/routing.ts`, not here.
 */
const withNextIntl = createNextIntlPlugin();

// Validated once while the artifact is built. `nextConfig.env` substitutes the
// exact boolean into every server chunk that reads the internal name, including
// dynamic admin code. A runtime environment edit therefore cannot disagree
// with prerendered metadata, robots or sitemaps; changing launch posture means
// rebuilding, as DELIVERY_PLAN.md Phase 35 requires.
const buildPrerenderEnv = parsePrerenderEnv(process.env);

/* ===========================================================================
 * Base Content-Security-Policy
 * ========================================================================= */

/**
 * THE BASE CSP — Phase 4's, not the complete one (DELIVERY_PLAN.md Phase 33
 * owns that).
 *
 * THE TENSION THIS RESOLVES. The textbook strict CSP is a per-request nonce
 * with `strict-dynamic`. A nonce is by definition different on every response,
 * so a page carrying one cannot be a prerendered file — adopting it would make
 * the entire public shell dynamic and destroy the anonymous caching boundary
 * ARCHITECTURE.md §8 exists to establish. Phase 4 is the phase that delivers
 * that boundary. Trading it for a nonce would be trading a real, tested
 * architectural property for a stronger-sounding header.
 *
 * SO: NO NONCE, AND THE COST IS STATED RATHER THAN HIDDEN. `script-src` permits
 * `'unsafe-inline'`, because Next.js serves its streaming payload as inline
 * `<script>` elements and a hash-based allowlist would change with every build.
 * That is a genuine weakening against injected inline script, and it is the one
 * allowance this policy makes.
 *
 * `style-src` DOES NOT GET THE SAME ALLOWANCE. It would have been easy to grant
 * it alongside — most recipes do — but it was tested instead: the delivered
 * surfaces carry no inline `style` attribute and no injected `<style>`, so
 * `'self'` holds with no console violation and the stylesheet still applies.
 * The browser suite asserts both halves, which is what stops the strict form
 * from being quietly relaxed later to make something unrelated work.
 *
 * Everything else is locked down, and the directives below do real work
 * regardless of the script allowance:
 *
 *   - `'unsafe-eval'` IS NOT PERMITTED, in production or anywhere else.
 *   - `object-src 'none'` removes the plugin vector entirely.
 *   - `base-uri 'self'` stops an injected `<base>` from silently re-pointing
 *     every relative URL on the page, which is a real escalation from an
 *     otherwise harmless HTML injection.
 *   - `form-action 'self'` stops an injected form from posting credentials to
 *     another origin.
 *   - `frame-ancestors 'none'` is the clickjacking control, and the one that
 *     actually matters — `X-Frame-Options` below is its legacy companion.
 *   - `default-src 'self'` means anything not named above is same-origin only,
 *     so a directive nobody thought of fails closed.
 *
 * NOTHING THIRD-PARTY IS PRE-ALLOWED. No YouTube, no Vimeo, no Google, no
 * analytics, no font CDN. Media providers arrive with the Media phase and its
 * embed privacy contract (ARCHITECTURE.md §4.7.1); allowlisting them now would
 * be permitting script from origins this build never contacts.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self'",
  // `data:` for images only, and deliberately not for scripts or objects: it is
  // how an inline SVG or a tiny placeholder is carried, and it grants no
  // execution.
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
].join('; ');

/**
 * The security headers every response carries.
 *
 * REASONED ONE BY ONE rather than copied from a recipe, and the deliberate
 * omissions are recorded with the inclusions:
 *
 *   - `Strict-Transport-Security` IS NOT SET HERE. TLS terminates at the NGINX
 *     reverse proxy (ARCHITECTURE.md §10.1); this process is reached over plain
 *     HTTP behind it, where the header is ignored, and emitting it anyway would
 *     duplicate or contradict the proxy's own. It belongs to the terminating
 *     hop, and Phase 33 reviews the deployed set end to end.
 *
 *   - `Cross-Origin-Opener-Policy` is `same-origin-allow-popups` rather than
 *     `same-origin`. It still severs the window reference a cross-origin opener
 *     would otherwise hold, while leaving the popup flow some identity
 *     providers use intact — this phase must not break the extensibility a
 *     later authentication phase depends on.
 */
const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },

  // MIME sniffing: a browser that second-guesses a declared content type can
  // execute an uploaded text file as script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Referrer leakage: a full URL sent to another origin discloses the path a
  // visitor was reading, which on this platform can be a Fatwa question or a
  // private area's address. Origin-only when crossing origins, and nothing at
  // all when downgrading to HTTP.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Clickjacking, for browsers predating `frame-ancestors`.
  { key: 'X-Frame-Options', value: 'DENY' },

  // Browser capability policy. The platform asks for none of these, so it
  // declines all of them; `browsing-topics` additionally opts the site out of
  // interest-based advertising inference it never wanted.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()',
  },

  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  env: {
    MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED: String(
      buildPrerenderEnv.PUBLIC_INDEXING_ENABLED,
    ),
  },

  // Workspace packages are TypeScript source, compiled by the app's build.
  transpilePackages: ['@minhaj/contracts', '@minhaj/server-core', '@minhaj/database'],

  typescript: {
    // A type error must fail the build. Never relaxed to make a build pass.
    ignoreBuildErrors: false,
  },

  // Linting is its own pipeline step (`npm run lint`) running the workspace
  // flat config, which carries the architecture rules. Next 16 no longer runs
  // ESLint during `next build`, so there is nothing to disable here.

  /**
   * Applied to EVERY response, public and private alike.
   *
   * One source: a route cannot opt out, and a new route cannot forget. The
   * private surfaces layer their own `no-store` and `noindex` on top; nothing
   * here removes or relaxes those.
   */
  async headers() {
    return [{ source: '/:path*', headers: [...SECURITY_HEADERS] }];
  },
};

export default withNextIntl(nextConfig);
