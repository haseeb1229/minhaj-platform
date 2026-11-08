import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { endonymOf } from '@/config/locale';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs } from '@/components/my/sections';
import { TimeZonePicker } from '@/components/my/time-zone-picker';
import { timeZoneChoices } from '@/components/my/time-zones';
import { requireLocale } from '@/config/route-locale';
import { Field, Panel, Select } from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { updateLanguageAction } from '../../../(identity)/actions';
import { requireActiveSession } from '../../guard';

/**
 * Account language and time zone — Identity-owned (ROUTE_MAP.md §5.1).
 *
 * This is the ACCOUNT's interface locale, which is a different thing from
 * CONTENT language: `/ur/library/books` is the library in Urdu, listing books
 * in every language unless filtered (DOMAIN_MODEL.md §19.1). Nothing here
 * filters content.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'language');
}

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

const LOCALES = ['en', 'ur', 'ar'] as const;

export default async function LanguagePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const tabs = {
    label: my('tabs.label.settings'),
    items: myTabs(locale, 'settings', 'language', (tab) => my(`tabs.${tab}`)),
  };
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, '/my/settings/language'),
  );

  return (
    <MyPage
      title={t('language.title')}
      description={<p>{t('language.description')}</p>}
      tabs={tabs}
      measure="reading"
    >
      <Panel>
        <ActionForm
          action={updateLanguageAction}
          submitLabel={t('common.save')}
          pendingLabel={t('common.working')}
          messages={{
            success: t('common.saved'),
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
                defaultValue={session.account.locale}
                required
              >
                {LOCALES.map((option) => (
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

          <Field
            id="timezone"
            label={t('setup.timezone')}
            help={my('settings.timeZone.help')}
          >
            {(props) => (
              <TimeZonePicker
                field={props}
                choices={timeZoneChoices(new Date(), session.account.timezone)}
                defaultValue={session.account.timezone ?? 'Asia/Karachi'}
                labels={{
                  search: my('settings.timeZone.search'),
                  device: my('settings.timeZone.device'),
                  matches: my.raw('settings.timeZone.matches') as string,
                }}
              />
            )}
          </Field>
        </ActionForm>
      </Panel>
    </MyPage>
  );
}
