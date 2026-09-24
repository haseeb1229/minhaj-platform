'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The Media administration error boundary. It says that something failed and
 * offers a retry, and NOTHING about what failed — no stack, no SQL, no
 * constraint name (SECURITY_BASELINE.md §19.2). The action already logged the
 * operation that failed.
 */
export default function MediaError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('media');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
