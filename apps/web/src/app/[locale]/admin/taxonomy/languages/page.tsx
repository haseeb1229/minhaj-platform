import { getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { queryValue } from '../../shared';
import { ActionForm } from '../../../(identity)/form-state';
import {
  createLanguageAction,
  setLanguageStatusAction,
  updateLanguageAction,
} from '../actions';
import { taxonomyCopy } from '../copy';

/**
 * Content-language reference data.
 *
 * THE DISTINCTION IS THE PRODUCT, so it is said on the page and not only in the
 * schema. A row here is a language CONTENT is written in; the three interface
 * locales are what the site is READ in, and they are a compiled contract
 * (ROUTE_MAP.md §1.2) that nothing on this screen can change. The UI may be
 * English while the work is Urdu, and conflating the two is the modelling error
 * DOMAIN_MODEL.md §18 names.
 *
 * There is therefore no control here that adds an interface locale, and adding
 * `fa` as a content language creates no `/fa/...` route. The notice at the top
 * says so in words, because an administrator who assumed otherwise would be
 * making a reasonable guess about a screen labelled "languages".
 *
 * RETIRED, NEVER DELETED. A work recorded in a language stays true after the
 * organisation stops publishing in it, and the runtime principal holds no
 * DELETE on the table.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

export default async function ContentLanguagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Search>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });

  const page = await requireAdminPage(
    locale,
    'taxonomy.read',
    `/${locale}/admin/taxonomy/languages`,
  );
  const copy = await taxonomyCopy(locale);
  const mayAdminister = page.authorization.can('taxonomy.administer');

  const languages = await taxonomyRuntime().taxonomy.listLanguages({
    includeRetired: true,
  });

  // ONE language open for editing at a time, named in the URL.
  //
  // The listing is reference data and stays whole — an administrator needs to
  // see the catalogue. The EDITOR is what is bounded: rendering a form set per
  // row is fine for three languages and is a page nobody can use at fifty, and
  // "it will always be small" is the assumption that makes a surface unusable
  // the first time it is not. It also makes each language's
  // editor linkable, exactly as the topics surface is.
  const selectedCode = queryValue(query, 'code');
  const selected =
    selectedCode === null
      ? null
      : (languages.find((language) => language.code === selectedCode) ?? null);

  const editHref = (code: string): string =>
    `/${locale}/admin/taxonomy/languages?code=${encodeURIComponent(code)}`;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('taxonomy.languages.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('taxonomy.languages.description')}
        </p>
      </header>

      <Alert tone="info">{t('taxonomy.languages.notInterfaceLocale')}</Alert>

      {languages.length === 0 ? (
        <EmptyState>{t('taxonomy.languages.none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('taxonomy.languages.caption')}
            columns={[
              t('taxonomy.languages.code'),
              t('taxonomy.languages.englishName'),
              t('taxonomy.languages.nativeName'),
              t('taxonomy.languages.direction'),
              t('taxonomy.languages.status'),
              ...(mayAdminister ? [t('taxonomy.languages.actions')] : []),
            ]}
          >
            {languages.map((language) => (
              <DataRow key={language.code}>
                <DataCell>
                  <code className="text-xs">{language.code}</code>
                </DataCell>
                <DataCell wrap>{language.englishName}</DataCell>
                <DataCell wrap>
                  {/*
                   * The endonym is rendered in ITS OWN language and direction.
                   * A right-to-left name inside a left-to-right table is
                   * exactly the mixed-direction case the localisation
                   * foundation exists for, and `lang` plus `dir` on the value
                   * is what makes it render and read correctly.
                   */}
                  <span lang={language.code} dir={language.direction}>
                    {language.nativeName}
                  </span>
                </DataCell>
                <DataCell>
                  <code className="text-xs">{language.direction}</code>
                </DataCell>
                <DataCell>
                  <StatusBadge
                    tone={language.status === 'active' ? 'positive' : 'caution'}
                  >
                    {t(
                      language.status === 'active'
                        ? 'taxonomy.languages.statusActive'
                        : 'taxonomy.languages.statusRetired',
                    )}
                  </StatusBadge>
                </DataCell>

                {mayAdminister ? (
                  <DataCell>
                    <TextLink href={editHref(language.code)}>
                      {t('taxonomy.languages.edit')}
                    </TextLink>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      {mayAdminister ? (
        <>
          <Panel>
            <div className="flex flex-col gap-3">
              <SectionHeading>{t('taxonomy.languages.createTitle')}</SectionHeading>

              <ActionForm
                action={createLanguageAction}
                submitLabel={t('taxonomy.languages.createSubmit')}
                pendingLabel={t('common.saving')}
                messages={{ ...copy.messages, success: t('taxonomy.languages.created') }}
              >
                <input type="hidden" name="locale" value={locale} />

                <Field
                  id="language-code"
                  label={t('taxonomy.languages.code')}
                  help={t('taxonomy.languages.codeHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="code"
                      type="text"
                      required
                      maxLength={16}
                    />
                  )}
                </Field>

                <Field id="language-english" label={t('taxonomy.languages.englishName')}>
                  {(props) => (
                    <TextInput
                      {...props}
                      name="englishName"
                      type="text"
                      required
                      maxLength={120}
                    />
                  )}
                </Field>

                <Field
                  id="language-native"
                  label={t('taxonomy.languages.nativeName')}
                  help={t('taxonomy.languages.nativeNameHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="nativeName"
                      type="text"
                      required
                      maxLength={120}
                    />
                  )}
                </Field>

                <Field
                  id="language-direction"
                  label={t('taxonomy.languages.direction')}
                  help={t('taxonomy.languages.directionHelp')}
                >
                  {(props) => (
                    <Select {...props} name="direction" defaultValue="ltr">
                      <option value="ltr">{t('taxonomy.languages.ltr')}</option>
                      <option value="rtl">{t('taxonomy.languages.rtl')}</option>
                    </Select>
                  )}
                </Field>
              </ActionForm>
            </div>
          </Panel>

          {selectedCode !== null && selected === null ? (
            <Alert tone="error">{t('denied.notFound')}</Alert>
          ) : null}

          {selected !== null ? (
            <Panel>
              <div className="flex flex-col gap-3">
                <SectionHeading>
                  {t('taxonomy.languages.editing', { code: selected.code })}
                </SectionHeading>

                <ActionForm
                  action={updateLanguageAction}
                  submitLabel={t('taxonomy.languages.updateSubmit')}
                  pendingLabel={t('common.saving')}
                  tone="secondary"
                  messages={{
                    ...copy.messages,
                    success: t('taxonomy.languages.updated'),
                  }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  {/*
                   * The CODE is identity and is not editable. Changing it would
                   * silently split one content language into two, orphaning
                   * every record that already cites the old one.
                   */}
                  <input type="hidden" name="code" value={selected.code} />

                  <Field
                    id={`english-${selected.code}`}
                    label={t('taxonomy.languages.englishName')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name="englishName"
                        type="text"
                        required
                        maxLength={120}
                        defaultValue={selected.englishName}
                      />
                    )}
                  </Field>

                  <Field
                    id={`native-${selected.code}`}
                    label={t('taxonomy.languages.nativeName')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name="nativeName"
                        type="text"
                        required
                        maxLength={120}
                        defaultValue={selected.nativeName}
                        lang={selected.code}
                        dir={selected.direction}
                      />
                    )}
                  </Field>

                  <Field
                    id={`direction-${selected.code}`}
                    label={t('taxonomy.languages.direction')}
                  >
                    {(props) => (
                      <Select
                        {...props}
                        name="direction"
                        defaultValue={selected.direction}
                      >
                        <option value="ltr">{t('taxonomy.languages.ltr')}</option>
                        <option value="rtl">{t('taxonomy.languages.rtl')}</option>
                      </Select>
                    )}
                  </Field>
                </ActionForm>

                <ActionForm
                  action={setLanguageStatusAction}
                  submitLabel={t(
                    selected.status === 'active'
                      ? 'taxonomy.languages.retireSubmit'
                      : 'taxonomy.languages.restoreSubmit',
                  )}
                  pendingLabel={t('common.saving')}
                  tone={selected.status === 'active' ? 'destructive' : 'secondary'}
                  messages={{
                    ...copy.messages,
                    success: t('taxonomy.languages.statusChanged'),
                  }}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="code" value={selected.code} />
                  <input
                    type="hidden"
                    name="status"
                    value={selected.status === 'active' ? 'retired' : 'active'}
                  />
                </ActionForm>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
