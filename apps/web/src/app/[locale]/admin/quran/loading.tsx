import { getLocale, getTranslations } from 'next-intl/server';

/**
 * The Quran administration loading state — ANNOUNCED, with `role="status"` and
 * `aria-busy`, rather than only shown (SECURITY_BASELINE.md §16.1).
 */
export default async function Loading() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'quranAdmin' });

  return (
    <p role="status" aria-busy="true">
      {t('loading')}
    </p>
  );
}
