import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import { AuthLayout, Field, TextInput, TextLink } from '@/components/ui';
import { MIN_PASSWORD_LENGTH } from '@minhaj/contracts/identity';
import { signUpAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * Create an account.
 *
 * The success message is the SAME whether or not the address already has an
 * account: "check your email". Anything more specific turns this form into a
 * way to discover who is registered (SECURITY_BASELINE.md §15.2).
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function SignUpPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });

  return (
    <AuthLayout
      title={t('signUp.title')}
      description={t('signUp.description')}
      footer={
        <span>
          {t('signUp.haveAccount')}{' '}
          <TextLink href={`/${locale}/signin`}>{t('signUp.signIn')}</TextLink>
        </span>
      }
    >
      <ActionForm
        action={signUpAction}
        submitLabel={t('signUp.submit')}
        pendingLabel={t('common.working')}
        messages={{
          success: t('signUp.submitted'),
          'invalid-input': t('common.checkFields'),
          'rate-limited': t('common.rateLimited'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />

        <Field id="name" label={t('common.name')}>
          {(props) => (
            <TextInput
              {...props}
              name="name"
              autoComplete="name"
              required
              maxLength={200}
            />
          )}
        </Field>

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

        <Field
          id="password"
          label={t('common.password')}
          help={t('common.passwordHelp', { min: MIN_PASSWORD_LENGTH })}
        >
          {(props) => (
            <TextInput
              {...props}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
          )}
        </Field>
      </ActionForm>
    </AuthLayout>
  );
}
