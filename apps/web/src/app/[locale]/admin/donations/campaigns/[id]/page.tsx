import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  DONATION_CAMPAIGN_TRANSITIONS,
  DONATION_CURRENCIES,
  DONATION_LIMITS,
  formatExactAmount,
  type CampaignCurrencyPolicy,
  type DonationCampaignRecord,
  type DonationCampaignState,
  type DonationCurrency,
} from '@minhaj/contracts/donations';

import { CampaignTitle, DonationTime, Money } from '@/components/donations/parts';
import { adminDonationsPath, isCampaignId } from '@/components/donations/presentation';
import { donationsRead } from '@/components/donations/read';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { donationsRuntime } from '@/composition/donations';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import {
  removeCurrencyPolicyAction,
  reorderCampaignAction,
  saveCurrencyPolicyAction,
  saveTranslationAction,
  transitionCampaignAction,
} from '../../actions';
import {
  RecordIdentity,
  adminDonationsCopy,
  type AdminDonationsCopy,
} from '../../shared';

/**
 * One campaign's editor (DELIVERY_PLAN.md Phase 27) — under `donations.read`;
 * every form re-checks `donations.administer`.
 *
 * ITS WORDS, PER INTERFACE LOCALE. Title, summary and description, plain
 * text, each marked with the language it is in. A campaign is published only
 * with its primary locale's words; a reader in another locale sees them with
 * an honest not-translated notice.
 *
 * ITS MONEY, EXACTLY. Each currency's minimum, maximum and up to three
 * suggested amounts are typed as DECIMAL TEXT in that currency's own unit —
 * `25.00` USD, `2500` JPY, `2.500` KWD — and parsed exactly by the service; a
 * fraction finer than the currency allows is refused, never rounded. Changing
 * a policy never touches an existing donation: each keeps its own amount.
 *
 * ITS LIFECYCLE. Draft → published → archived → published; never back to
 * draft. Archiving stops new gifts at once; a donation begun before it stands.
 * A malformed or unknown id is the administrative 404.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function DonationCampaignPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const campaigns = `${adminDonationsPath(locale)}/campaigns`;
  const path = `${campaigns}/${encodeURIComponent(id)}`;
  const context = await requireAdminPage(locale, 'donations.read', path);
  if (!isCampaignId(id)) notFound();
  const copy = await adminDonationsCopy(locale);
  const { t, d } = copy;
  const administer = context.authorization.can('donations.administer');
  const timeZone = context.session.account.timezone;

  const read = await donationsRead('donations-admin-campaign', () =>
    donationsRuntime().admin.campaign({ accountId: context.session.account.id }, id),
  );
  const back = (
    <p>
      <TextLink href={campaigns}>{t('editor.back')}</TextLink>
    </p>
  );
  if (!read.ok) {
    if (['denied', 'not-found', 'invalid'].includes(read.failure)) notFound();
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('editor.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  }
  if (read.value === null) notFound();
  const record = read.value;

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('editor.title')}</PageHeading>
        <p className="font-semibold">
          <CampaignTitle campaign={record} locale={locale} t={d} />
        </p>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('editor.state')}>
            <StatusBadge tone={record.state === 'published' ? 'positive' : 'neutral'}>
              {t(`campaignState.${record.state}`)}
            </StatusBadge>
          </DetailRow>
          <DetailRow term={t('fields.primaryLocale')}>
            {t(`localeName.${record.primaryLocale}`)}
          </DetailRow>
          <DetailRow term={t('fields.displayOrder')}>{record.displayOrder}</DetailRow>
          <DetailRow term={t('editor.referenced')}>
            {record.referenced ? t('editor.referencedYes') : t('editor.referencedNo')}
          </DetailRow>
          <DetailRow term={t('editor.version')}>{record.version}</DetailRow>
          <DetailRow term={t('editor.created')}>
            <DonationTime value={record.createdAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
          <DetailRow term={t('editor.updated')}>
            <DonationTime value={record.updatedAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
          {record.publishedAt === null ? null : (
            <DetailRow term={t('editor.published')}>
              <DonationTime
                value={record.publishedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          {record.archivedAt === null ? null : (
            <DetailRow term={t('editor.archived')}>
              <DonationTime
                value={record.archivedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
        </dl>
      </Panel>

      {administer ? <Lifecycle locale={locale} record={record} copy={copy} /> : null}

      <section
        className="flex min-w-0 flex-col gap-3"
        aria-labelledby="campaign-currencies"
      >
        <SectionHeading>
          <span id="campaign-currencies">{t('currencies.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('currencies.help')}
        </p>
        {record.currencies.length === 0 ? (
          <EmptyState>{t('currencies.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('currencies.heading')} className="flex flex-col gap-3">
            {record.currencies.map((policy) => (
              <Panel key={policy.currency} as="li">
                <CurrencyPolicy
                  locale={locale}
                  record={record}
                  policy={policy}
                  administer={administer}
                  copy={copy}
                />
              </Panel>
            ))}
          </ul>
        )}
        {administer &&
        record.currencies.length < DONATION_LIMITS.currenciesPerCampaign ? (
          <AddCurrency locale={locale} record={record} copy={copy} />
        ) : null}
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="campaign-words">
        <SectionHeading>
          <span id="campaign-words">{t('translations.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('translations.help')}
        </p>
        {localeSchema.options.map((language) => (
          <TranslationEditor
            key={language}
            locale={locale}
            language={language}
            record={record}
            administer={administer}
            copy={copy}
          />
        ))}
      </section>

      {back}
    </main>
  );
}

/* ===========================================================================
 * Lifecycle and position
 * ========================================================================= */

/** Where a campaign may go next — never back to draft. */
function nextStates(state: DonationCampaignState): readonly ('published' | 'archived')[] {
  return DONATION_CAMPAIGN_TRANSITIONS[state].filter(
    (to): to is 'published' | 'archived' => to !== 'draft',
  );
}

function Lifecycle({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: DonationCampaignRecord;
  readonly copy: AdminDonationsCopy;
}) {
  const { t } = copy;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Panel>
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">{t('lifecycle.heading')}</h2>
          {nextStates(record.state).map((to) => (
            <div key={to} className="flex flex-col gap-3">
              <p className="text-sm">{t(`lifecycle.explain.${to}`)}</p>
              <ActionForm
                action={transitionCampaignAction}
                submitLabel={t(`lifecycle.to.${to}`)}
                pendingLabel={t('pending')}
                tone={to === 'published' ? 'primary' : 'secondary'}
                messages={copy.messages}
              >
                <RecordIdentity locale={locale} record={record} />
                <input type="hidden" name="to" value={to} />
              </ActionForm>
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">{t('order.heading')}</h2>
          <ActionForm
            action={reorderCampaignAction}
            submitLabel={t('order.submit')}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
          >
            <RecordIdentity locale={locale} record={record} />
            <Field
              id="campaign-order"
              label={t('fields.displayOrder')}
              help={t('fields.displayOrderHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="displayOrder"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={DONATION_LIMITS.displayOrder}
                  required
                  defaultValue={record.displayOrder}
                />
              )}
            </Field>
          </ActionForm>
        </div>
      </Panel>
    </div>
  );
}

/* ===========================================================================
 * Currency policies — exact decimal text
 * ========================================================================= */

/** The minimum, maximum and suggestion fields, prefilled with exact text. */
function PolicyFields({
  prefix,
  currency,
  policy,
  copy,
}: {
  readonly prefix: string;
  readonly currency: DonationCurrency | null;
  readonly policy: CampaignCurrencyPolicy | undefined;
  readonly copy: AdminDonationsCopy;
}) {
  const { t } = copy;
  const exact = (minor: bigint | undefined) =>
    minor === undefined || currency === null ? '' : formatExactAmount(minor, currency);
  const amount = (name: string, label: string, value: string, required: boolean) => (
    <Field key={name} id={`${prefix}-${name}`} label={label}>
      {(props) => (
        <TextInput
          {...props}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          maxLength={20}
          required={required}
          defaultValue={value}
        />
      )}
    </Field>
  );
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {amount('minimum', t('currencies.minimum'), exact(policy?.minimumMinor), true)}
        {amount('maximum', t('currencies.maximum'), exact(policy?.maximumMinor), true)}
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium">{t('currencies.suggested')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('currencies.suggestedHelp')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((index) =>
            amount(
              `suggested${index + 1}`,
              t('currencies.suggestion', { number: index + 1 }),
              exact(policy?.suggestedMinor[index]),
              false,
            ),
          )}
        </div>
      </fieldset>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {t('currencies.exactHelp')}
      </p>
    </>
  );
}

function CurrencyPolicy({
  locale,
  record,
  policy,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly record: DonationCampaignRecord;
  readonly policy: CampaignCurrencyPolicy;
  readonly administer: boolean;
  readonly copy: AdminDonationsCopy;
}) {
  const { t } = copy;
  const prefix = `policy-${policy.currency}`;
  const money = (minor: bigint) => (
    <Money money={{ currency: policy.currency, minor }} locale={locale} />
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="font-semibold">
        <bdi>{policy.currency}</bdi>
      </h3>
      <dl className="divide-y divide-[color:var(--color-border)]">
        <DetailRow term={t('currencies.minimum')}>{money(policy.minimumMinor)}</DetailRow>
        <DetailRow term={t('currencies.maximum')}>{money(policy.maximumMinor)}</DetailRow>
        <DetailRow term={t('currencies.suggested')}>
          {policy.suggestedMinor.length === 0 ? (
            t('currencies.noSuggestions')
          ) : (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {policy.suggestedMinor.map((minor) => (
                <span key={minor.toString()}>{money(minor)}</span>
              ))}
            </span>
          )}
        </DetailRow>
      </dl>
      {administer ? (
        <>
          <ActionForm
            action={saveCurrencyPolicyAction}
            submitLabel={t('currencies.save', { currency: policy.currency })}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
            preserveInput
          >
            <RecordIdentity locale={locale} record={record} />
            <input type="hidden" name="currency" value={policy.currency} />
            <PolicyFields
              prefix={prefix}
              currency={policy.currency}
              policy={policy}
              copy={copy}
            />
          </ActionForm>
          <ActionForm
            action={removeCurrencyPolicyAction}
            submitLabel={t('currencies.remove', { currency: policy.currency })}
            pendingLabel={t('pending')}
            tone="destructive"
            messages={copy.messages}
          >
            <RecordIdentity locale={locale} record={record} />
            <input type="hidden" name="currency" value={policy.currency} />
            <ConfirmField id={`${prefix}-remove`} label={t('currencies.removeConfirm')} />
          </ActionForm>
        </>
      ) : null}
    </div>
  );
}

function AddCurrency({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: DonationCampaignRecord;
  readonly copy: AdminDonationsCopy;
}) {
  const { t } = copy;
  const offered = new Set<string>(record.currencies.map((policy) => policy.currency));
  const available = DONATION_CURRENCIES.filter((currency) => !offered.has(currency));
  if (available.length === 0) return null;
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t('currencies.addHeading')}</h3>
        <ActionForm
          action={saveCurrencyPolicyAction}
          submitLabel={t('currencies.add')}
          pendingLabel={t('pending')}
          messages={copy.messages}
          preserveInput
        >
          <RecordIdentity locale={locale} record={record} />
          <Field id="policy-new-currency" label={t('currencies.currency')}>
            {(props) => (
              <Select {...props} name="currency" defaultValue={available[0]}>
                {available.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <PolicyFields
            prefix="policy-new"
            currency={null}
            policy={undefined}
            copy={copy}
          />
        </ActionForm>
      </div>
    </Panel>
  );
}

/* ===========================================================================
 * Words, per interface locale
 * ========================================================================= */

function TranslationEditor({
  locale,
  language,
  record,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly language: Locale;
  readonly record: DonationCampaignRecord;
  readonly administer: boolean;
  readonly copy: AdminDonationsCopy;
}) {
  const { t } = copy;
  const existing = record.translations.find((entry) => entry.locale === language);
  const name = t(`localeName.${language}`);
  const id = `translation-${language}`;
  return (
    <Panel as="div">
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-sm font-semibold">
          {language === record.primaryLocale
            ? t('translations.primary', { language: name })
            : name}
        </h3>
        {existing === undefined ? (
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('translations.missing')}
          </p>
        ) : null}
        {administer ? (
          <ActionForm
            action={saveTranslationAction}
            submitLabel={t('translations.submit', { language: name })}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
            preserveInput
          >
            <RecordIdentity locale={locale} record={record} />
            <input type="hidden" name="translationLocale" value={language} />
            <Field id={`${id}-title`} label={t('fields.title')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="title"
                  required
                  defaultValue={existing?.title ?? ''}
                  maxLength={DONATION_LIMITS.title}
                  lang={language}
                  dir="auto"
                />
              )}
            </Field>
            <Field id={`${id}-summary`} label={t('fields.summary')}>
              {(props) => (
                <TextArea
                  {...props}
                  name="summary"
                  required
                  defaultValue={existing?.summary ?? ''}
                  maxLength={DONATION_LIMITS.summary}
                  rows={2}
                  lang={language}
                  dir="auto"
                />
              )}
            </Field>
            <Field id={`${id}-description`} label={t('fields.description')}>
              {(props) => (
                <TextArea
                  {...props}
                  name="description"
                  required
                  defaultValue={existing?.description ?? ''}
                  maxLength={DONATION_LIMITS.description}
                  rows={6}
                  lang={language}
                  dir="auto"
                />
              )}
            </Field>
          </ActionForm>
        ) : existing === undefined ? null : (
          <dl
            className="divide-y divide-[color:var(--color-border)]"
            lang={language}
            dir="auto"
          >
            <DetailRow term={t('fields.title')}>{existing.title}</DetailRow>
            <DetailRow term={t('fields.summary')}>{existing.summary}</DetailRow>
            <DetailRow term={t('fields.description')}>
              <span className="whitespace-pre-line">{existing.description}</span>
            </DetailRow>
          </dl>
        )}
      </div>
    </Panel>
  );
}
