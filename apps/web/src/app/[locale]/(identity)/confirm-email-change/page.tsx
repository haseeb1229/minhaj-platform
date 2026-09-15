import { getTranslations } from 'next-intl/server';

import { canonicaliseEmail } from '@minhaj/contracts/identity';

import { identityRuntime } from '@/composition/identity';
import { requestContext } from '@/composition/request';
import { requireLocale } from '@/config/route-locale';
import { Alert, AuthLayout, TextLink } from '@/components/ui';
import { confirmEmailChangeAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * The emailed email-change link — protocol class D (SECURITY_BASELINE.md §7.4).
 *
 * TWO PROOFS, NOT ONE. The token proves the new address is readable; the
 * SESSION proves the account is the one asking. A change confirmed by a link
 * alone would let anyone who intercepted the message move somebody's address,
 * which is the single most valuable thing to take from an account — every
 * recovery path runs through it.
 *
 * THIS GET MUTATES NOTHING. It reads the token's state and renders a
 * confirmation; the POST consumes it. A mail scanner following the link has no
 * session and consumes nothing even if it had one.
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

export default async function ConfirmEmailChangePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'identity' });

  const newEmail = typeof query['email'] === 'string' ? query['email'] : null;
  const token = typeof query['token'] === 'string' ? query['token'] : null;

  if (newEmail === null || token === null) {
    return (
      <AuthLayout title={t('confirmChange.title')}>
        <Alert tone="error">{t('confirmChange.missing')}</Alert>
        <TextLink href={`/${locale}/my/settings/security`}>
          {t('confirmChange.backToSecurity')}
        </TextLink>
      </AuthLayout>
    );
  }

  const { identity, session } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await session.resolve(context.headers);

  // Not signed in — say so plainly and offer the way back. The destination is
  // built here and validated again at the action, so a crafted `returnTo`
  // cannot ride in on this page (SECURITY_BASELINE.md §9.3).
  if (outcome.state !== 'active') {
    const here = `/${locale}/confirm-email-change`;

    return (
      <AuthLayout title={t('confirmChange.title')}>
        <Alert tone="info">{t('confirmChange.needSignIn')}</Alert>
        <TextLink href={`/${locale}/signin?returnTo=${encodeURIComponent(here)}`}>
          {t('common.backToSignIn')}
        </TextLink>
      </AuthLayout>
    );
  }

  // ALREADY THIS ACCOUNT'S ADDRESS — so the change has been applied.
  //
  // This is the state immediately after a successful confirmation, and it is
  // also what someone sees reopening a link they already used. It has to be
  // handled BEFORE the token inspection, because the inspection cannot
  // recognise it: a change token is stored against the PAIR of addresses, and
  // once the move has happened the current address IS the new one, so the
  // lookup asks for `<new>-<new>` and correctly finds nothing.
  //
  // Reported as "no longer usable" it was actively misleading — the page told
  // people their confirmation had failed at the exact moment it succeeded.
  if (canonicaliseEmail(newEmail) === canonicaliseEmail(outcome.session.account.email)) {
    return (
      <AuthLayout title={t('confirmChange.title')}>
        <Alert tone="success">{t('confirmChange.done')}</Alert>
        <TextLink href={`/${locale}/my/settings/security`}>
          {t('confirmChange.backToSecurity')}
        </TextLink>
      </AuthLayout>
    );
  }

  const state = await identity.inspectEmailChange(outcome.session, { newEmail }, token);

  if (state !== 'valid') {
    return (
      <AuthLayout title={t('confirmChange.title')}>
        <Alert tone="error">{t('confirmChange.invalid')}</Alert>
        <TextLink href={`/${locale}/my/settings/security`}>
          {t('confirmChange.backToSecurity')}
        </TextLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('confirmChange.title')}
      description={t('confirmChange.description', { email: newEmail })}
    >
      <ActionForm
        action={confirmEmailChangeAction}
        submitLabel={t('confirmChange.submit')}
        pendingLabel={t('common.working')}
        messages={{
          success: t('confirmChange.done'),
          'invalid-token': t('confirmChange.invalid'),
          'expired-token': t('confirmChange.invalid'),
          'too-many-attempts': t('confirmChange.invalid'),
          'account-unavailable': t('confirmChange.needSignIn'),
          'rate-limited': t('common.rateLimited'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="newEmail" value={newEmail} />
        <input type="hidden" name="token" value={token} />
      </ActionForm>

      <TextLink href={`/${locale}/my/settings/security`}>
        {t('confirmChange.backToSecurity')}
      </TextLink>
    </AuthLayout>
  );
}
