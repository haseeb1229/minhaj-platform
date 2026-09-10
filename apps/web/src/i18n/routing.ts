import { localeSchema } from '@minhaj/contracts';
import { defineRouting } from 'next-intl/routing';

import { FALLBACK_LOCALE } from '@/config/locale';

/**
 * THE locale routing configuration (ROUTE_MAP.md §1).
 *
 * One definition, consumed by all three consumers that must agree:
 *
 *   - `apps/web/src/proxy.ts`        — resolution and redirects
 *   - `apps/web/src/i18n/navigation.ts` — locale-aware navigation
 *   - `apps/web/src/i18n/request.ts`    — per-request message loading
 *
 * The locales are DERIVED from `localeSchema`, never restated. A second
 * `['en', 'ur', 'ar']` here would be a list that can disagree with the one the
 * environment contracts validate against, and nothing would report it.
 */
export const routing = defineRouting({
  /**
   * `localeSchema.options` is the single supported-locale definition
   * (ROUTE_MAP.md §1.2), shared with environment validation.
   */
  locales: localeSchema.options,

  /**
   * The final step of ROUTE_MAP.md §1.1, reached only when a visitor expresses
   * no stored preference and sends no `Accept-Language` that matches.
   */
  defaultLocale: FALLBACK_LOCALE,

  /**
   * ROUTE_MAP.md §1.1: the locale segment is ALWAYS present. There is no
   * implicit unprefixed variant, because `/quran` and `/en/quran` addressing
   * the same page splits search authority for a corpus meant to be cited for
   * decades.
   */
  localePrefix: 'always',

  /**
   * Stored preference, then `Accept-Language` (ROUTE_MAP.md §1.1). Disabling
   * detection would leave `en` as the only outcome for every visitor.
   */
  localeDetection: true,

  /**
   * The `Link` header advertising alternate language versions is DISABLED, and
   * this is a deliberate phase boundary rather than an oversight.
   *
   * next-intl emits it for every locale in this configuration. Phase 3A
   * delivers interface locales; it delivers no content. Advertising
   * `/ur/anything` as a genuine Urdu version of `/en/anything` would therefore
   * be a claim about content that does not exist, and ROUTE_MAP.md §9.2
   * requires every advertised alternate to be "a genuine canonical language
   * version" of the content — with untranslated content excluded (§9.8).
   *
   * Phase 4 owns the content-aware canonical/`hreflang`/`x-default` system
   * (ROUTE_MAP.md §9.2.1). It turns this on when it can decide, per resource,
   * which language versions actually exist.
   */
  alternateLinks: false,

  /**
   * The stored locale preference.
   *
   * Attributes are stated explicitly rather than inherited from library
   * defaults, because they are a security surface:
   *
   *   - `path: '/'`      one preference for the whole site, not one per
   *                      directory the visitor happened to switch language in
   *   - `sameSite: 'lax'` a top-level navigation may carry it; a cross-site
   *                      subrequest may not
   *   - `secure` in production — the cookie never travels in clear text off a
   *                      developer's machine
   *   - `maxAge` finite  a year, then the visitor is re-negotiated from
   *                      `Accept-Language` rather than pinned forever
   *
   * IT CARRIES NO AUTHORITY. It selects an interface language for an anonymous
   * visitor and nothing else: no identity, no session, no permission, no
   * profile capability (SECURITY_BASELINE.md — a profile alone grants
   * nothing). It is deliberately not `httpOnly`, because locale switching is a
   * client-side navigation concern and there is nothing here to protect from a
   * script that could not simply navigate instead. Authenticated preference
   * persistence is Phase 21's, not this cookie's.
   */
  localeCookie: {
    name: 'NEXT_LOCALE',
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  },
});
