'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The newsletter operator surface's error boundary. It says that something
 * failed and offers a retry, and NOTHING about what failed — no stack, no SQL,
 * no constraint name and never an address (SECURITY_BASELINE.md §19.2). The
 * operation that failed was already logged, by name only.
 */
export default function NewsletterAdminError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('newsletter.admin');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
