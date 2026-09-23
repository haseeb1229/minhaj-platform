'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The Library administration error boundary.
 *
 * It says that something failed and offers a retry, and it says NOTHING about what
 * failed. A stack, a SQL message or a constraint name rendered here would be
 * internal detail on an operator's screen, and the operator cannot act on it anyway
 * (SECURITY_BASELINE.md 19.2). The diagnosable account of the failure is the
 * structured log line the action already wrote.
 */
export default function LibraryError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('library');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
