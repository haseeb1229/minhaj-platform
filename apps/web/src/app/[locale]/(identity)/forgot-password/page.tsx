import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import { AuthLayout, Field, TextInput, TextLink } from '@/components/ui';
import { requestPasswordResetAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * Ask for a password-reset link.
 *
 * The outcome is uniform. This is the single most probed endpoint for account
 * enumeration on any platform, and a response that differed for a known
 * address would answer the question an attacker is asking
 * (SECURITY_BASELINE.md §15.2).
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function ForgotPasswordPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });

  return (
    <AuthLayout
      title={t('forgot.title')}
      description={t('forgot.description')}
      footer={<TextLink href={`/${locale}/signin`}>{t('common.backToSignIn')}</TextLink>}
    >
      <ActionForm
        action={requestPasswordResetAction}
        submitLabel={t('forgot.submit')}
        pendingLabel={t('common.working')}
        messages={{
          success: t('forgot.submitted'),
          'invalid-input': t('common.checkFields'),
          'rate-limited': t('common.rateLimited'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />

        <Field id="email" label={t('common.email')}>
          {(props) => (
            <TextInput
              {...props}
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          )}
        </Field>
      </ActionForm>
    </AuthLayout>
  );
}
