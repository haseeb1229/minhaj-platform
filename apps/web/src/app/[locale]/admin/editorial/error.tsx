'use client';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui';
export default function EditorialError({ reset }: { reset: () => void }) {
  const t = useTranslations('editorial');
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
