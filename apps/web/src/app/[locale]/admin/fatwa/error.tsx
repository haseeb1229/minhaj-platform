'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The Fatwa administration error boundary. It says that something failed and
 * offers a retry, and NOTHING about what failed — no stack, no SQL, no
 * constraint name and never a question or a ruling (SECURITY_BASELINE.md
 * §19.2). The action already logged the operation that failed, by name only.
 */
export default function FatwaAdminError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('fatwaAdmin');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
