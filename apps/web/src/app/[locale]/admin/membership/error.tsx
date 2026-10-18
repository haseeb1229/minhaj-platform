'use client';

import { useTranslations } from 'next-intl';

import { Alert, Button } from '@/components/ui';

/**
 * The Membership administration error boundary. It says that something failed
 * and offers a retry, and NOTHING about what failed — no stack, no SQL, no
 * account, no type's words (SECURITY_BASELINE.md §19.2). The page already
 * logged the operation that failed, by name.
 */
export default function MembershipAdminError({ reset }: { readonly reset: () => void }) {
  const t = useTranslations('adminMembership');

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">{t('unknown')}</Alert>
      <Button type="button" onClick={reset}>
        {t('reload')}
      </Button>
    </div>
  );
}
