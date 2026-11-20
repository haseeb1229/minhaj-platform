import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { requireLocale } from '@/config/route-locale';
import {
  DetailRow,
  Field,
  Panel,
  SectionHeading,
  TextLink,
  TextInput,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { updateProfileAction } from '../../../(identity)/actions';
import { requireActiveSession } from '../../guard';

/**
 * Profile — the PRIVATE basic account profile (DOMAIN_MODEL.md §4.2).
 *
 * A user account is application identity. It is NOT automatically a public
 * Person profile, and nothing here creates or implies one — contributor
 * profiles belong to People & Contributors in Phase 5 (§5.2).
 *
 * MY MINHAJ PART 1: the trail, and the account's sign-in address shown — read
 * only, from the session — with the way to change it, which is Security's
 * (behind the password). Nothing here changes it.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'profile');
}

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
  const my = await getTranslations({ locale, namespace: 'my' });
  const tabs = {
    label: my('tabs.label.settings'),
    items: myTabs(locale, 'settings', 'profile', (tab) => my(`tabs.${tab}`)),
  };
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, '/my/settings/profile'),
  );

  return (
    <MyPage
      title={t('profile.title')}
      description={<p>{t('profile.description')}</p>}
      tabs={tabs}
      measure="reading"
      trail={{
        label: my('trail.label'),
        crumbs: myTrail(locale, my('trail.home'), [
          { path: '/settings/profile', text: my('trail.settings') },
          { text: t('profile.title') },
        ]),
      }}
    >
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

      <section className="flex flex-col gap-3" aria-labelledby="profile-email">
        <span id="profile-email">
          <SectionHeading>{my('settings.profile.emailHeading')}</SectionHeading>
        </span>
        <Panel>
          <dl>
            <DetailRow term={t('common.email')}>
              <bdi className="wrap-anywhere">{session.account.email}</bdi>
            </DetailRow>
          </dl>
          <p className="mt-3 text-sm text-foreground-muted">
            {my('settings.profile.emailHelp')}{' '}
            <TextLink href={localizedPath(locale, '/my/settings/security#email-heading')}>
              {my('settings.profile.emailLink')}
            </TextLink>
          </p>
        </Panel>
      </section>
    </MyPage>
  );
}
