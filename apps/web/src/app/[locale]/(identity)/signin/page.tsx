import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import { AuthLayout, Field, TextInput, TextLink } from '@/components/ui';
import { signInAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * Sign in.
 *
 * `noindex`, like every authentication surface (ROUTE_MAP.md §4). The page
 * itself performs no mutation: the POST does, through a Server Action carrying
 * the Class-A protections.
 */
export const metadata = { robots: { index: false, follow: false } };

interface PageProps {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SignInPage({ params, searchParams }: PageProps) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'identity' });

  // Carried through the form so the action can validate it. It is NOT trusted
  // here: `safeReturnTo` decides, at the action, whether it is a destination
  // this application will send anyone to (SECURITY_BASELINE.md §9.3).
  const returnTo = typeof query['returnTo'] === 'string' ? query['returnTo'] : '';

  return (
    <AuthLayout
      title={t('signIn.title')}
      description={t('signIn.description')}
      footer={
        <span>
          {t('signIn.noAccount')}{' '}
          <TextLink href={`/${locale}/signup`}>{t('signIn.createAccount')}</TextLink>
        </span>
      }
    >
      <ActionForm
        action={signInAction}
        submitLabel={t('signIn.submit')}
        pendingLabel={t('common.working')}
        messages={{
          'invalid-credentials': t('signIn.failed'),
          'invalid-input': t('common.checkFields'),
          'rate-limited': t('common.rateLimited'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="returnTo" value={returnTo} />

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

        <Field id="password" label={t('common.password')}>
          {(props) => (
            <TextInput
              {...props}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>

        <TextLink href={`/${locale}/forgot-password`}>{t('signIn.forgot')}</TextLink>
      </ActionForm>
    </AuthLayout>
  );
}
