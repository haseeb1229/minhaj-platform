import { getRequestConfig } from 'next-intl/server';

import { FALLBACK_LOCALE, isSupportedLocale } from '@/config/locale';

/**
 * Per-request internationalisation configuration.
 *
 * Located at `src/i18n/request.ts`, which is one of the paths the next-intl
 * plugin resolves by default; `next.config.ts` wires the plugin.
 *
 * THIS IS INTERFACE LOCALISATION ONLY. It selects the UI message catalogue for
 * a request. It says nothing about the language of the CONTENT a page shows —
 * `/ur/library/books` is the Library interface in Urdu listing books in every
 * content language (ROUTE_MAP.md §1.5, DOMAIN_MODEL.md §19.1). Content
 * translation is domain data owned by later phases.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  /**
   * The `[locale]` segment, unvalidated.
   *
   * It behaves as a catch-all — an unknown top-level path arrives here as a
   * "locale" — so it is validated against the accepted locale set rather than
   * trusted, and anything else falls back to `en` (ROUTE_MAP.md §1.1). This
   * function must always return a usable configuration; the request that
   * carried a bad segment is REJECTED separately, by the layout's own guard,
   * which is what turns it into a 404 instead of a page in the wrong language.
   */
  const requested = await requestLocale;
  const locale =
    requested !== undefined && isSupportedLocale(requested) ? requested : FALLBACK_LOCALE;

  return {
    locale,

    /**
     * Loaded per locale, on the server. The catalogue for one locale is the
     * only one that reaches a response.
     */
    messages: (await import(`../../messages/${locale}.json`)).default,

    /**
     * Missing and malformed messages FAIL LOUDLY IN DEVELOPMENT and render a
     * safe, deterministic placeholder in production.
     *
     * The default behaviour logs to `console.error` and renders the message
     * key. Both halves are replaced deliberately:
     *
     *   - The error is thrown during development and in tests, so a missing
     *     key is a defect someone fixes rather than a line in a log nobody
     *     reads. The key-parity test in `tests/config/messages.test.ts` is the
     *     mechanical half of the same guarantee.
     *
     *   - In production it must NOT throw: a missing Urdu string is not a
     *     reason to fail a page for a visitor who came to read it. It renders
     *     the key path, which is inert, contains no request data, and is
     *     visibly wrong to anyone looking at it.
     *
     * Nothing here logs the message, the request, or any header: an error
     * message can carry interpolated values, and interpolated values are user
     * content (SECURITY_BASELINE.md §19.2).
     */
    onError(error) {
      if (process.env.NODE_ENV === 'production') return;
      throw error;
    },

    getMessageFallback({ key, namespace }) {
      return namespace === undefined ? key : `${namespace}.${key}`;
    },
  };
});
