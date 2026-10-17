import { getTranslations } from 'next-intl/server';

/**
 * The Messaging administration loading state — ANNOUNCED, with `role="status"`
 * and `aria-busy`, rather than only shown (SECURITY_BASELINE.md §16.1).
 */
export default async function Loading() {
  const t = await getTranslations('adminMessaging');

  return (
    <p role="status" aria-busy="true">
      {t('loading')}
    </p>
  );
}
