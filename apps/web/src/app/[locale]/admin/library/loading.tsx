import { getTranslations } from 'next-intl/server';

/**
 * The Library administration loading state.
 *
 * `role="status"` with `aria-busy`, so the wait is ANNOUNCED rather than only
 * shown: an operator using a screen reader otherwise gets silence between
 * submitting and arriving (SECURITY_BASELINE.md 16.1). Every delivered surface
 * defines its loading, empty, error and retry states.
 */
export default async function Loading() {
  const t = await getTranslations('library');

  return (
    <p role="status" aria-busy="true">
      {t('loading')}
    </p>
  );
}
