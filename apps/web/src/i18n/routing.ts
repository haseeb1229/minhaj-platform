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
   * The unprefixed interface locale — the same constant `localizedPath` uses
   * (`UNPREFIXED_LOCALE` in `@minhaj/contracts`), so the routing library and
   * the URL builder cannot disagree about which locale has no prefix.
   */
  defaultLocale: FALLBACK_LOCALE,

  /**
   * ROUTE_MAP.md §1.1 (Rebaseline R1, owner decision 2026-11-06): ENGLISH IS
   * UNPREFIXED. `/library` is the English Library; `/ur/library` and
   * `/ar/library` are the Urdu and Arabic ones. One canonical address per
   * interface locale still holds — `/en/…` never renders, the proxy answers it
   * with ONE permanent redirect to the unprefixed address before this
   * configuration is consulted. Every address is built by `localizedPath` in
   * `@minhaj/contracts`, which states the same rule.
   */
  localePrefix: 'as-needed',

  /**
   * DETECTION IS OFF: the address alone decides the interface language. An
   * unprefixed URL is English deterministically — no stored preference and no
   * `Accept-Language` header can send `/` or `/library` to `/ur` or `/ar`.
   * A shared link therefore shows every visitor the same language, and a
   * crawler (which sends no `Accept-Language`) sees what a visitor sees.
   */
  localeDetection: false,

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
   * NO LOCALE COOKIE. With detection off nothing would ever read one, and a
   * public GET that emitted `Set-Cookie` would turn a shared response private.
   * The account's interface locale remains Identity's
   * (`/my/settings/language`).
   */
  localeCookie: false,
});
