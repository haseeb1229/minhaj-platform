'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The Global Network administration error boundary. It says that something
 * failed and offers a retry, and NOTHING about what failed — no stack, no SQL,
 * no constraint name (SECURITY_BASELINE.md §19.2).
 */
export default function GlobalError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('admin.global');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
