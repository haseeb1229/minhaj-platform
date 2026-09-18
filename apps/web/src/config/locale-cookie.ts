import type { Locale } from '@minhaj/contracts';

/** The one anonymous preference cookie used by locale resolution. */
export const LOCALE_COOKIE = Object.freeze({
  name: 'NEXT_LOCALE',
  path: '/',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 365,
});

/** Browser syntax for persisting an explicit language-switcher choice. */
export function localeCookieValue(locale: Locale, secure: boolean): string {
  return [
    `${LOCALE_COOKIE.name}=${locale}`,
    `Path=${LOCALE_COOKIE.path}`,
    `Max-Age=${LOCALE_COOKIE.maxAge}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
