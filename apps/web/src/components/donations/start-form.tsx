import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Locale } from '@minhaj/contracts';
import type { PublicDonationCampaign } from '@minhaj/contracts/donations';

import { ActionForm, type FormActionState } from '@/app/[locale]/(identity)/form-state';
import { Field, Select, TextInput } from '@/components/ui';
import { OperationIdField } from './operation-id-field';
import { Money, type DonationsTranslator } from './parts';
import { suggestionValue } from './presentation';

/**
 * The giving form for ONE campaign — on `/donate` anonymously and on
 * `/my/donations` linked to the signed-in account; only the action differs.
 *
 * A REQUEST, NEVER AN AUTHORITATIVE AMOUNT. The form names a campaign, a
 * currency and decimal text; the server parses that text exactly, checks it
 * against the campaign's CURRENT policy and the configured provider, and
 * creates the expected amount itself. Suggested amounts are plain radio
 * choices, so the form works with no JavaScript; an amount typed into the
 * field wins over a chosen suggestion, and the help says so.
 *
 * NO PAYMENT DETAILS, EVER. There is no card, account, address or e-mail
 * field here: payment happens on the provider's own hosted page, which the
 * form says before it is submitted.
 *
 * ONE OPERATION ID PER LOADED PAGE. A double submit, or a retry after an
 * outage, carries the same id and reaches the same donation — the id is held
 * in the browser (`OperationIdField`), so the re-render a new donation's
 * status cookie causes does not replace it; a freshly loaded page is a fresh
 * attempt.
 */

/** The words for every refusal a giving form can return — a category, never content. */
export function startFormMessages(
  t: DonationsTranslator,
): Readonly<Record<string, string>> {
  return {
    invalid: t('failure.invalid'),
    'not-activated': t('failure.notActivated'),
    'campaign-unavailable': t('failure.campaignUnavailable'),
    'amount-refused': t('failure.amountRefused'),
    'operation-conflict': t('failure.operationConflict'),
    'already-submitted': t('failure.alreadySubmitted'),
    'provider-unavailable': t('failure.providerUnavailable'),
    'account-closed': t('failure.noSession'),
    'rate-limited': t('failure.rateLimited'),
    'no-session': t('failure.noSession'),
    denied: t('failure.noSession'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
  };
}

export function DonationStartForm({
  campaign,
  locale,
  action,
  t,
}: {
  readonly campaign: PublicDonationCampaign;
  readonly locale: Locale;
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  readonly t: DonationsTranslator;
}) {
  const prefix = `donate-${campaign.id}`;
  const suggestions = campaign.currencies.flatMap((policy) =>
    policy.suggestedMinor.map((minor) => ({ currency: policy.currency, minor })),
  );

  return (
    <ActionForm
      action={action}
      submitLabel={t('form.submit')}
      pendingLabel={t('form.pending')}
      messages={startFormMessages(t)}
    >
      <input type="hidden" name="locale" value={locale} />
      <OperationIdField initial={randomUUID()} />
      <input type="hidden" name="campaignId" value={campaign.id} />

      {suggestions.length === 0 ? (
        <input type="hidden" name="suggested" value="" />
      ) : (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-sm font-medium">{t('form.suggested')}</legend>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((money, index) => {
              const id = `${prefix}-suggested-${index}`;
              return (
                <div
                  key={id}
                  className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-3"
                >
                  <input
                    id={id}
                    type="radio"
                    name="suggested"
                    value={suggestionValue(money)}
                    defaultChecked={index === 0}
                  />
                  <label htmlFor={id} className="text-sm">
                    <Money money={money} locale={locale} />
                  </label>
                </div>
              );
            })}
            <div className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-3">
              <input id={`${prefix}-own`} type="radio" name="suggested" value="" />
              <label htmlFor={`${prefix}-own`} className="text-sm">
                {t('form.own')}
              </label>
            </div>
          </div>
        </fieldset>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-currency`} label={t('form.currency')}>
          {(props) => (
            <Select
              {...props}
              name="currency"
              defaultValue={campaign.currencies[0]?.currency}
            >
              {campaign.currencies.map((policy) => (
                <option key={policy.currency} value={policy.currency}>
                  {policy.currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-amount`}
          label={t('form.amount')}
          help={
            suggestions.length === 0
              ? t('form.amountHelp')
              : t('form.amountHelpSuggested')
          }
        >
          {(props) => (
            <TextInput
              {...props}
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              maxLength={20}
            />
          )}
        </Field>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{t('form.limits')}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          {campaign.currencies.map((policy) => (
            <li key={policy.currency}>
              {t.rich('form.range', {
                minimum: () => (
                  <Money
                    money={{ currency: policy.currency, minor: policy.minimumMinor }}
                    locale={locale}
                  />
                ),
                maximum: () => (
                  <Money
                    money={{ currency: policy.currency, minor: policy.maximumMinor }}
                    locale={locale}
                  />
                ),
              })}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('form.provider')}
      </p>
    </ActionForm>
  );
}
