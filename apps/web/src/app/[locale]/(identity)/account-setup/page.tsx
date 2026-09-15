import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { identityRuntime } from '@/composition/identity';
import { endonymOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { requestContext } from '@/composition/request';
import { AuthLayout, Field, Select, TextInput } from '@/components/ui';
import { completeAccountSetupAction } from '../actions';
import { ActionForm } from '../form-state';

/**
 * Account setup — Identity-owned (DOMAIN_MODEL.md §4.2).
 *
 * It establishes the ACCOUNT: its verified address, its interface locale and
 * its timezone. That is all.
 *
 * IT IS NOT PERSONALISATION ONBOARDING. Interests, goals, learner level and
 * preferred format belong to Personalisation & Notifications in Phase 21, and
 * merging the two would recreate the dependency cycle that splitting the
 * former Phase 3 removed (§14.1). Nothing on this page asks what someone is
 * interested in.
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

const LOCALES = ['en', 'ur', 'ar'] as const;

export default async function AccountSetupPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });

  const { session } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await session.resolve(context.headers);

  // Setup is for a signed-in account. Anyone else goes to sign in, with this
  // page as a VALIDATED return destination.
  if (outcome.state !== 'active') {
    redirect(
      `/${locale}/signin?returnTo=${encodeURIComponent(`/${locale}/account-setup`)}`,
    );
  }

  return (
    <AuthLayout title={t('setup.title')} description={t('setup.description')}>
      <ActionForm
        action={completeAccountSetupAction}
        submitLabel={t('setup.submit')}
        pendingLabel={t('common.working')}
        messages={{
          'invalid-input': t('common.checkFields'),
          unknown: t('common.unavailable'),
        }}
      >
        <input type="hidden" name="locale" value={locale} />

        <Field id="accountLocale" label={t('setup.language')}>
          {(props) => (
            <Select
              {...props}
              name="accountLocale"
              defaultValue={outcome.session.account.locale}
              required
            >
              {LOCALES.map((option) => (
                // Each option carries its OWN `lang` and `dir`, so a language's
                // name renders in its own script inside a page written in
                // another (ARCHITECTURE.md §9).
                <option
                  key={option}
                  value={option}
                  lang={option}
                  dir={option === 'en' ? 'ltr' : 'rtl'}
                >
                  {endonymOf(option)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="timezone" label={t('setup.timezone')} help="IANA, e.g. Asia/Karachi">
          {(props) => (
            <TextInput
              {...props}
              name="timezone"
              defaultValue={outcome.session.account.timezone ?? 'Asia/Karachi'}
              required
            />
          )}
        </Field>
      </ActionForm>
    </AuthLayout>
  );
}
