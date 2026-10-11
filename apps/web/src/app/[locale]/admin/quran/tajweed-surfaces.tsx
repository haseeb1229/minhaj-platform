import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  QURAN_LIMITS,
  type QuranSourceRecord,
  type TajweedRuleRecord,
} from '@minhaj/contracts/quran';
import type { LanguageView } from '@minhaj/contracts/taxonomy';

import { requireAdminPage } from '@/composition/authorization';
import { quranRuntime } from '@/composition/quran';
import {
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { saveTajweedRule } from './actions';
import {
  actorOf,
  EditIdentity,
  EditorHeading,
  languageIndex,
  languageText,
  quranCopy,
  recordTarget,
  SlugField,
  SourceName,
  SourceSelect,
  StateBadge,
  StateControls,
  type Copy,
  type EditorParams,
  type ListParams,
} from './shared';

/**
 * Tajweed rules (`/admin/quran/tajweed`), Phase 18 — a study aid, managed under
 * `quran.administer` like every other non-canonical Quran work.
 *
 * A RULE IS SOURCED, PLAIN TEXT. Each has a fixed slug, a position, an optional
 * registered source and attribution, and a title and PLAIN-TEXT body per
 * content language. The body is a plain textarea, saved exactly as entered —
 * no rich-text editor, no markup (SECURITY_BASELINE.md §5.3).
 */

/** The schema's own ceiling on texts per rule. */
const TEXT_ROWS = 8;

/** A rule's title in the reader's language where it has one, else its first. */
function titleOf(rule: TajweedRuleRecord, locale: Locale) {
  return rule.texts.find((text) => text.languageCode === locale) ?? rule.texts[0];
}

/* ===========================================================================
 * Directory
 * ========================================================================= */

export async function TajweedDirectory({ params }: ListParams) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/quran/tajweed`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('quran.administer');

  const [rules, status, languages] = await Promise.all([
    quranRuntime().quran.tajweedRules(actor),
    quranRuntime().quran.corpusStatus(actor),
    languageIndex(),
  ]);
  const sources = new Map(status.sources.map((source) => [source.id, source]));
  const ordered = [...rules].sort((a, b) => a.position - b.position);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.tajweed')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.tajweed')}
      </p>

      {ordered.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.tajweed')}
          columns={[
            t('tajweed.position'),
            t('tajweed.title'),
            t('slug'),
            t('source'),
            t('state'),
            t('version'),
          ]}
        >
          {ordered.map((rule) => {
            const title = titleOf(rule, locale);
            return (
              <DataRow key={rule.id}>
                <DataCell>{rule.position}</DataCell>
                <DataCell wrap>
                  <TextLink href={`${base}/${rule.id}`}>
                    {title === undefined ? (
                      <span dir="ltr">{rule.slug}</span>
                    ) : (
                      <span
                        lang={title.languageCode}
                        dir={languages.get(title.languageCode)?.direction ?? 'auto'}
                      >
                        {title.title}
                      </span>
                    )}
                  </TextLink>
                </DataCell>
                <DataCell wrap>
                  <span dir="ltr">{rule.slug}</span>
                </DataCell>
                <DataCell wrap>
                  <SourceName
                    source={
                      rule.sourceId === null ? undefined : sources.get(rule.sourceId)
                    }
                    copy={copy}
                  />
                </DataCell>
                <DataCell>
                  <StateBadge state={rule.state} copy={copy} />
                </DataCell>
                <DataCell>{rule.version}</DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      )}

      {administer ? (
        ordered.length >= QURAN_LIMITS.tajweedRules ? (
          <EmptyState>{t('tajweed.full')}</EmptyState>
        ) : (
          <Panel>
            <div className="flex flex-col gap-4">
              <SectionHeading>{t('create.tajweed')}</SectionHeading>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('createHelp')}
              </p>
              <RuleForm
                locale={locale}
                record={null}
                sources={status.sources}
                languages={languages}
                copy={copy}
              />
            </div>
          </Panel>
        )
      ) : null}
    </main>
  );
}

/* ===========================================================================
 * Editor
 * ========================================================================= */

export async function TajweedEditor({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/quran/tajweed`;
  const context = await requireAdminPage(locale, 'quran.read', `${list}/${id}`);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('quran.administer');

  const record = await quranRuntime().quran.tajweedRule(actor, id);
  if (record === null) notFound();

  const [status, languages] = await Promise.all([
    quranRuntime().quran.corpusStatus(actor),
    languageIndex(),
  ]);
  const source =
    record.sourceId === null
      ? undefined
      : status.sources.find((entry) => entry.id === record.sourceId);
  const title = titleOf(record, locale);

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={list}
        locale={locale}
        title={
          title === undefined ? (
            <span dir="ltr">{record.slug}</span>
          ) : (
            <span
              lang={title.languageCode}
              dir={languages.get(title.languageCode)?.direction ?? 'auto'}
            >
              {title.title}
            </span>
          )
        }
        record={record}
        copy={copy}
      />

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="rule-state">
          <SectionHeading>
            <span id="rule-state">{t('stateTitle')}</span>
          </SectionHeading>
          <p className="text-sm">
            {t('source')}: <SourceName source={source} copy={copy} />
          </p>
          {administer ? (
            <StateControls kind="tajweed" locale={locale} record={record} copy={copy} />
          ) : null}
        </section>
      </Panel>

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="rule-details">
          <SectionHeading>
            <span id="rule-details">{t('details')}</span>
          </SectionHeading>
          {administer ? (
            <RuleForm
              locale={locale}
              record={record}
              sources={status.sources}
              languages={languages}
              copy={copy}
            />
          ) : (
            <ol className="flex flex-col gap-4">
              {record.texts.map((text) => {
                const direction = languages.get(text.languageCode)?.direction ?? 'auto';
                return (
                  <li key={text.languageCode} className="flex flex-col gap-1">
                    <span className="text-xs">
                      {languageText(text.languageCode, languages)}
                    </span>
                    <span
                      lang={text.languageCode}
                      dir={direction}
                      className="font-medium"
                    >
                      {text.title}
                    </span>
                    <p
                      lang={text.languageCode}
                      dir={direction}
                      className="text-sm whitespace-pre-wrap"
                    >
                      {text.body}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </Panel>
    </main>
  );
}

function RuleForm({
  locale,
  record,
  sources,
  languages,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: TajweedRuleRecord | null;
  readonly sources: readonly QuranSourceRecord[];
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-rule' : 'rule';
  const texts = record?.texts ?? [];
  // Every text the rule has, and one more empty row while the schema allows it.
  const rows = Math.min(TEXT_ROWS, texts.length + 1);

  return (
    <ActionForm
      action={saveTajweedRule}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <SlugField prefix={prefix} slug={record?.slug ?? null} copy={copy} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-position`}
          label={t('tajweed.position')}
          help={t('tajweed.positionHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="position"
              type="number"
              required
              min={0}
              max={QURAN_LIMITS.tajweedRules}
              inputMode="numeric"
              defaultValue={record?.position ?? 0}
            />
          )}
        </Field>
        <Field
          id={`${prefix}-attribution`}
          label={t('attribution')}
          help={t('attributionHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="attribution"
              defaultValue={record?.attribution ?? ''}
              maxLength={QURAN_LIMITS.attribution}
              dir="auto"
            />
          )}
        </Field>
      </div>
      <SourceSelect
        id={`${prefix}-source`}
        sources={sources}
        selected={record?.sourceId ?? null}
        copy={copy}
      />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold">{t('tajweed.texts')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('tajweed.textsHelp')}
        </p>
        {Array.from({ length: rows }, (_, index) => {
          const text = texts[index];
          const direction =
            text === undefined
              ? 'auto'
              : (languages.get(text.languageCode)?.direction ?? 'auto');
          const offered = [...languages.values()].filter(
            (language) =>
              language.status === 'active' || language.code === text?.languageCode,
          );
          return (
            <div key={index} className="flex flex-col gap-3">
              <Field
                id={`${prefix}-text-language-${String(index)}`}
                label={t('tajweed.textLanguage', { number: index + 1 })}
              >
                {(props) => (
                  <Select
                    {...props}
                    name={`text-language-${String(index)}`}
                    defaultValue={text?.languageCode ?? ''}
                  >
                    <option value="">{t('none')}</option>
                    {offered.map((language) => (
                      <option key={language.code} value={language.code}>
                        {languageText(language.code, languages)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                id={`${prefix}-text-title-${String(index)}`}
                label={t('tajweed.textTitle', { number: index + 1 })}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name={`text-title-${String(index)}`}
                    defaultValue={text?.title ?? ''}
                    maxLength={QURAN_LIMITS.tajweedTitle}
                    lang={text?.languageCode}
                    dir={direction}
                  />
                )}
              </Field>
              <Field
                id={`${prefix}-text-body-${String(index)}`}
                label={t('tajweed.textBody', { number: index + 1 })}
                help={t('exactTextHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`text-body-${String(index)}`}
                    rows={6}
                    defaultValue={text?.body ?? ''}
                    maxLength={QURAN_LIMITS.tajweedBody}
                    lang={text?.languageCode}
                    dir={direction}
                  />
                )}
              </Field>
            </div>
          );
        })}
      </fieldset>
    </ActionForm>
  );
}
