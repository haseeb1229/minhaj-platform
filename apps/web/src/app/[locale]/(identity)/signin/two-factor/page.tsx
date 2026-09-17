import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import { AuthLayout, Field, TextInput, TextLink } from '@/components/ui';
import { verifySecondFactorAction } from '../../actions';
import { ActionForm } from '../../form-state';

/**
 * The second-factor challenge.
 *
 * REACHED ONLY AFTER A CORRECT PASSWORD, and it is a distinct page rather than
 * a second panel on the sign-in form because at this point the person is
 * genuinely in a different state: the password was accepted, no session
 * exists, and a short-lived server-side challenge does. Rendering it inside the
 * sign-in page would invite re-submitting the credential, which would start a
 * new challenge and discard the one in flight.
 *
 * IT DISCLOSES NOTHING. No address, no name, no indication of whose challenge
 * this is — the pending identity lives in the server-side record and the
 * signed cookie, and this page never reads either. Somebody who opens it
 * without a challenge simply gets a form that will not work.
 *
 * TWO PROOFS, ONE PAGE. The authenticator code is the ordinary route; a
 * single-use recovery code is the route for somebody who has lost the
 * authenticator, and it is deliberately reachable here rather than only
 * through a support conversation (SECURITY_BASELINE.md §8.2).
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST. There is nothing here to prerender and nothing to cache. */
export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TwoFactorPage({ params, searchParams }: PageProps) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'identity' });

  // Carried through the form and validated AT THE ACTION, never trusted here
  // (SECURITY_BASELINE.md §9.3).
  const returnTo = typeof query['returnTo'] === 'string' ? query['returnTo'] : '';
  const recovery = query['recovery'] === '1';

  const messages = {
    'invalid-credentials': t('twoFactor.failed'),
    'invalid-input': t('common.checkFields'),
    'rate-limited': t('common.rateLimited'),
    unknown: t('common.unavailable'),
  };

  return (
    <AuthLayout
      title={recovery ? t('twoFactor.recoveryTitle') : t('twoFactor.title')}
      description={
        recovery ? t('twoFactor.recoveryDescription') : t('twoFactor.description')
      }
      footer={
        <span>
          {recovery ? (
            <TextLink
              href={`/${locale}/signin/two-factor?returnTo=${encodeURIComponent(returnTo)}`}
            >
              {t('twoFactor.useCode')}
            </TextLink>
          ) : (
            <TextLink
              href={`/${locale}/signin/two-factor?recovery=1&returnTo=${encodeURIComponent(returnTo)}`}
            >
              {t('twoFactor.useRecovery')}
            </TextLink>
          )}
          {' · '}
          <TextLink href={`/${locale}/signin`}>{t('twoFactor.backToSignIn')}</TextLink>
        </span>
      }
    >
      <ActionForm
        action={verifySecondFactorAction}
        submitLabel={recovery ? t('twoFactor.recoverySubmit') : t('twoFactor.submit')}
        pendingLabel={t('common.working')}
        messages={messages}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="kind" value={recovery ? 'recovery-code' : 'totp'} />

        <Field
          id="code"
          label={recovery ? t('twoFactor.recoveryCode') : t('twoFactor.code')}
          {...(recovery ? {} : { help: t('twoFactor.codeHelp') })}
        >
          {(props) => (
            <TextInput
              {...props}
              name="code"
              type="text"
              required
              // `one-time-code` is what lets a phone offer the code from the
              // authenticator or an SMS autofill; `off` on the recovery field
              // because a recovery code is written down, not autofilled.
              autoComplete={recovery ? 'off' : 'one-time-code'}
              inputMode={recovery ? 'text' : 'numeric'}
              autoFocus
            />
          )}
        </Field>
      </ActionForm>
    </AuthLayout>
  );
}
