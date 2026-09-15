import { getTranslations } from 'next-intl/server';

import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { Alert, AuthLayout, Field, TextInput, TextLink } from '@/components/ui';
import { confirmVerificationAction, resendVerificationAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * The emailed verification link — protocol class D (SECURITY_BASELINE.md §7.4).
 *
 * THIS GET MUTATES NOTHING. It reads the token's state and renders a
 * confirmation, so a mail scanner, a link prefetcher or an over-eager security
 * appliance following the link cannot consume it. The token is consumed by the
 * POST the person submits, which is itself a Class-A request.
 *
 * `inspectToken` is non-mutating on a correct token, so rendering this page
 * twice leaves the link exactly as usable as it was.
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
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
      <AuthLayout title={t('verify.title')}>
        <Alert tone="error">{t('verify.missing')}</Alert>
        <TextLink href={`/${locale}/signin`}>{t('common.backToSignIn')}</TextLink>
      </AuthLayout>
    );
  }

  const { identity } = identityRuntime();
  const state = await identity.inspectVerification({ email, token });

  if (state !== 'valid') {
    // An expired or already-used link offers the way forward rather than a
    // dead end — and says nothing about whether the address has an account.
    return (
      <AuthLayout title={t('verify.title')}>
        <Alert tone="error">
          {state === 'expired' ? t('verify.expired') : t('verify.invalid')}
        </Alert>

        <ActionForm
          action={resendVerificationAction}
          submitLabel={t('verify.resend')}
          pendingLabel={t('common.working')}
          messages={{
            success: t('verify.resent'),
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
                defaultValue={email}
                required
              />
            )}
          </Field>
        </ActionForm>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('verify.title')} description={t('verify.description')}>
      <ActionForm
        action={confirmVerificationAction}
        submitLabel={t('verify.submit')}
        pendingLabel={t('common.working')}
        messages={{
          success: t('verify.done'),
          'invalid-token': t('verify.invalid'),
          'expired-token': t('verify.expired'),
          'too-many-attempts': t('verify.invalid'),
          'rate-limited': t('common.rateLimited'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />
      </ActionForm>

      <TextLink href={`/${locale}/signin`}>{t('common.backToSignIn')}</TextLink>
    </AuthLayout>
  );
}
