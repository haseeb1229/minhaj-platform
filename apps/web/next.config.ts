import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { parsePrerenderEnv } from '@minhaj/contracts/env/prerender-build';
import { PROVIDER_EMBED_ORIGINS, VIDEO_PROVIDERS } from '@minhaj/contracts/media';

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
 * NOTHING THIRD-PARTY IS PRE-ALLOWED SITE-WIDE. No analytics, no font CDN, and
 * no media provider in the base policy: every page but the two below frames
 * nothing at all (`frame-src 'none'`).
 *
 * THE PHASE-10 PLAYER EXCEPTION IS ONE DIRECTIVE ON TWO ROUTES. A Video's
 * public page and its administrative editor are the only pages that render the
 * privacy-gated player, so they alone receive a policy whose `frame-src` names
 * the two privacy-enhanced provider hosts — exactly those origins, taken from
 * the same contract the player derives its frame address from
 * (`@minhaj/contracts/media`), and nothing broader. No provider SCRIPT is
 * allowed anywhere: the player is an iframe, and the provider's own document
 * runs under the provider's policy, not this one (ARCHITECTURE.md §4.7.1).
 *
 * THE PHASE-27 GIVING EXCEPTION IS ONE DIRECTIVE ON TWO ROUTES. Starting a
 * donation ends in a redirect to the payment provider's hosted checkout, and a
 * browser enforces `form-action` on the redirect that follows a form
 * submission — so the two pages that render a giving form, `/donate` and
 * `/my/donations`, alone receive a policy whose `form-action` also names the
 * provider's exact checkout origin. Nothing is framed, scripted or fetched
 * from it, and every other page keeps `form-action 'self'`.
 */
function contentSecurityPolicy(
  frameSources: readonly string[],
  formTargets: readonly string[] = [],
): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    frameSources.length === 0
      ? "frame-src 'none'"
      : `frame-src ${frameSources.join(' ')}`,
    formTargets.length === 0
      ? "form-action 'self'"
      : `form-action 'self' ${formTargets.join(' ')}`,
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self'",
    // `data:` for images only, and deliberately not for scripts or objects: it
    // is how an inline SVG or a tiny placeholder is carried, and it grants no
    // execution. No remote image host: a provider thumbnail would disclose the
    // visitor before they chose to play anything.
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
  ].join('; ');
}

const CONTENT_SECURITY_POLICY = contentSecurityPolicy([]);

const PLAYER_CONTENT_SECURITY_POLICY = contentSecurityPolicy(
  VIDEO_PROVIDERS.map((provider) => PROVIDER_EMBED_ORIGINS[provider]),
);

/**
 * The payment provider's hosted checkout origin — the SANDBOX ENGINEERING
 * ADAPTER's (Stripe), NOT a production provider selection. The Donations
 * service independently refuses any checkout address not on exactly the
 * configured provider's origin; this only lets the browser follow it.
 */
const DONATION_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';

const DONATION_CONTENT_SECURITY_POLICY = contentSecurityPolicy(
  [],
  [DONATION_CHECKOUT_ORIGIN],
);

/** The only routes that render a giving form. Exact shapes, nothing beneath them. */
const DONATION_FORM_ROUTES: readonly string[] = [
  '/:locale(en|ur|ar)/donate',
  '/:locale(en|ur|ar)/my/donations',
];

/**
 * The giving pages whose ADDRESS OR STATE IS A BEARER: the anonymous status
 * page (its token is in the path) and the provider's return page (it reads
 * this browser's status cookie). Never stored by any cache, and never sent as
 * a `Referer` — a status address must not leave in a link someone follows.
 */
const DONATION_PRIVATE_ROUTES: readonly string[] = [
  '/:locale(en|ur|ar)/donate/status/:token*',
  '/:locale(en|ur|ar)/donate/return',
];

/**
 * The only routes that render the provider player. Matched by exact shape, so
 * a Video listing, a topic view or any other page keeps `frame-src 'none'`.
 */
const PLAYER_ROUTES: readonly string[] = [
  '/:locale(en|ur|ar)/watch/videos/:slug',
  '/:locale(en|ur|ar)/admin/media/videos/:id',
];

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
  // interest-based advertising inference it never wanted. `autoplay` is refused
  // for every frame the platform ever renders (Phase 10): a provider player
  // plays only when the visitor presses play inside it, never on its own.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=(), autoplay=()',
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
    return [
      { source: '/:path*', headers: [...SECURITY_HEADERS] },
      // LATER ENTRIES OVERRIDE EARLIER ONES for the same header key, so a player
      // route receives exactly ONE policy — the base policy with its one frame
      // directive widened — never two policies intersecting.
      ...PLAYER_ROUTES.map((source) => ({
        source,
        headers: [
          { key: 'Content-Security-Policy', value: PLAYER_CONTENT_SECURITY_POLICY },
        ],
      })),
      ...DONATION_FORM_ROUTES.map((source) => ({
        source,
        headers: [
          { key: 'Content-Security-Policy', value: DONATION_CONTENT_SECURITY_POLICY },
        ],
      })),
      ...DONATION_PRIVATE_ROUTES.map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      })),
    ];
  },
};

export default withNextIntl(nextConfig);
