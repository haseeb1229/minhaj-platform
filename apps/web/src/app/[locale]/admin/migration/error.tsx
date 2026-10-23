'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The Migration administration error boundary. It says that something failed
 * and offers a retry, and NOTHING about what failed — no stack, no SQL, no
 * address, no title, no payload (SECURITY_BASELINE.md §19.2). The page already
 * logged the operation that failed, by name.
 */
export default function MigrationAdminError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('adminMigration');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
