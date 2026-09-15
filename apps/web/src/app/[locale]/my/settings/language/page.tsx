import { getTranslations } from 'next-intl/server';

import { endonymOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { Field, PageHeading, Panel, Select, TextInput } from '@/components/ui';
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
export const metadata = { robots: { index: false, follow: false } };

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
  const session = await requireActiveSession(locale, `/${locale}/my/settings/language`);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('language.title')}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('language.description')}
        </p>
      </header>

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

          <Field id="timezone" label={t('setup.timezone')} help="IANA, e.g. Asia/Karachi">
            {(props) => (
              <TextInput
                {...props}
                name="timezone"
                defaultValue={session.account.timezone ?? 'Asia/Karachi'}
                required
              />
            )}
          </Field>
        </ActionForm>
      </Panel>
    </main>
  );
}
