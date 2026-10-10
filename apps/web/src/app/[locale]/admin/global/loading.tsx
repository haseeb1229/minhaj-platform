import { getTranslations } from 'next-intl/server';

/**
 * The Global Network administration loading state — ANNOUNCED, with
 * `role="status"` and `aria-busy`, rather than only shown.
 */
export default async function Loading() {
  const t = await getTranslations('admin.global');

  return (
    <p role="status" aria-busy="true">
      {t('loading')}
    </p>
  );
}
