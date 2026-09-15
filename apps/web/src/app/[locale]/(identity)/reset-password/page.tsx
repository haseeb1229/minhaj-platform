import { getTranslations } from 'next-intl/server';

import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { MIN_PASSWORD_LENGTH } from '@minhaj/contracts/identity';
import { Alert, AuthLayout, Field, TextInput, TextLink } from '@/components/ui';
import { resetPasswordAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * The emailed password-reset link — protocol class D.
 *
 * The GET renders token status and the form. It consumes nothing, so a mail
 * scanner cannot burn someone's reset link before they reach it
 * (SECURITY_BASELINE.md §7.4). The POST sets the password and consumes the
 * token, and a completed reset revokes every session the old credential
 * authorised (§2.3).
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'identity' });

  const email = typeof query['email'] === 'string' ? query['email'] : null;
  const token = typeof query['token'] === 'string' ? query['token'] : null;

  if (email === null || token === null) {
    return (
      <AuthLayout title={t('reset.title')}>
        <Alert tone="error">{t('reset.invalid')}</Alert>
        <TextLink href={`/${locale}/forgot-password`}>
          {t('reset.requestAnother')}
        </TextLink>
      </AuthLayout>
    );
  }

  const { identity } = identityRuntime();
  const state = await identity.inspectPasswordReset({ email, token });

  if (state !== 'valid') {
    return (
      <AuthLayout title={t('reset.title')}>
        <Alert tone="error">
          {state === 'expired' ? t('reset.expired') : t('reset.invalid')}
        </Alert>
        <TextLink href={`/${locale}/forgot-password`}>
          {t('reset.requestAnother')}
        </TextLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('reset.title')}>
      <ActionForm
        action={resetPasswordAction}
        submitLabel={t('reset.submit')}
        pendingLabel={t('common.working')}
        messages={{
          success: t('reset.done'),
          'invalid-token': t('reset.invalid'),
          'expired-token': t('reset.expired'),
          'too-many-attempts': t('reset.invalid'),
          'invalid-input': t('common.checkFields'),
          'rate-limited': t('common.rateLimited'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />

        <Field
          id="newPassword"
          label={t('common.newPassword')}
          help={t('common.passwordHelp', { min: MIN_PASSWORD_LENGTH })}
        >
          {(props) => (
            <TextInput
              {...props}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
          )}
        </Field>
      </ActionForm>

      <TextLink href={`/${locale}/signin`}>{t('common.backToSignIn')}</TextLink>
    </AuthLayout>
  );
}
