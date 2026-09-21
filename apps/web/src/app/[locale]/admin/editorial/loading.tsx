import { getTranslations } from 'next-intl/server';
export default async function Loading() {
  const t = await getTranslations('editorial');
  return (
    <p role="status" aria-busy="true">
      {t('loading')}
    </p>
  );
}
