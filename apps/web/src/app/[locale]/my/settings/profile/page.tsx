import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import { Field, PageHeading, Panel, TextInput } from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { updateProfileAction } from '../../../(identity)/actions';
import { requireActiveSession } from '../../guard';

/**
 * Profile — the PRIVATE basic account profile (DOMAIN_MODEL.md §4.2).
 *
 * A user account is application identity. It is NOT automatically a public
 * Person profile, and nothing here creates or implies one — contributor
 * profiles belong to People & Contributors in Phase 5 (§5.2).
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });
  const session = await requireActiveSession(locale, `/${locale}/my/settings/profile`);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('profile.title')}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('profile.description')}
        </p>
      </header>

      <Panel>
        <ActionForm
          action={updateProfileAction}
          submitLabel={t('common.save')}
          pendingLabel={t('common.working')}
          messages={{
            success: t('common.saved'),
            'invalid-input': t('common.checkFields'),
            unknown: t('common.unavailable'),
          }}
        >
          <input type="hidden" name="locale" value={locale} />
          <Field id="name" label={t('profile.displayName')}>
            {(props) => (
              <TextInput
                {...props}
                name="name"
                defaultValue={session.account.name}
                required
                maxLength={200}
              />
            )}
          </Field>
        </ActionForm>
      </Panel>
    </main>
  );
}
