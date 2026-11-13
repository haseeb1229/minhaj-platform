import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { TajweedRule } from '@minhaj/contracts/quran';

import { TAJWEED_FAMILIES } from './tajweed-layout';

/**
 * THE TAJWEED COLOUR KEY (Quran Part 9): what each colour marks, named in the
 * interface language — so the colours never carry meaning alone (WCAG 1.4.1) —
 * with the overlay's standing said plainly beside it: colour-coded tajweed,
 * not yet reviewed by a qari. The reader shows it only while the colours are
 * on (`globals.css`); the Tajweed hub shows the same words. A native
 * disclosure holds the key, so it is toggled without script and stays out of
 * the way of the text.
 */

export type TajweedFamily = (typeof TAJWEED_FAMILIES)[number]['family'];

export interface TajweedKeyLabels {
  readonly experimental: string;
  readonly key: string;
  readonly learn: string;
  readonly families: Readonly<Record<TajweedFamily, string>>;
  readonly rules: Readonly<Record<TajweedRule, string>>;
}

export async function tajweedKeyLabels(locale: Locale): Promise<TajweedKeyLabels> {
  const t = await getTranslations({ locale, namespace: 'quran.tajweed' });
  return {
    experimental: t('experimental'),
    key: t('key'),
    learn: t('learn'),
    families: Object.fromEntries(
      TAJWEED_FAMILIES.map(({ family }) => [family, t(`families.${family}`)]),
    ) as Record<TajweedFamily, string>,
    rules: Object.fromEntries(
      TAJWEED_FAMILIES.flatMap(({ rules }) => rules).map((rule) => [
        rule,
        t(`rules.${rule}`),
      ]),
    ) as Record<TajweedRule, string>,
  };
}

/** One rule's colour, as a swatch beside its name: presentation only. */
export function TajweedSwatch({ rule }: { readonly rule: TajweedRule }) {
  return <span aria-hidden="true" className={`tajweed-swatch tj-${rule}`} />;
}

/** The families of rules, each with its rules' swatches and names. */
export function TajweedLegend({ labels }: { readonly labels: TajweedKeyLabels }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {TAJWEED_FAMILIES.map(({ family, rules }) => (
        <section key={family} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-caption font-semibold text-foreground-muted">
            {labels.families[family]}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {rules.map((rule) => (
              <li key={rule} className="flex min-w-0 items-center gap-2 text-sm">
                <TajweedSwatch rule={rule} />
                <span className="min-w-0 break-words">{labels.rules[rule]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The reader's key: the overlay's standing, and the legend in a disclosure. */
export function TajweedKey({
  labels,
  attribution,
  hubHref,
}: {
  readonly labels: TajweedKeyLabels;
  readonly attribution: string | null;
  readonly hubHref: string;
}) {
  return (
    <div className="quran-tajweed-key flex flex-col gap-2" data-tajweed-key="">
      <p className="text-caption font-medium text-warning">{labels.experimental}</p>
      <details className="quran-tajweed-legend rounded-control border border-border bg-surface-raised">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">
          {labels.key}
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-3">
          <TajweedLegend labels={labels} />
          <p className="text-caption break-words text-foreground-muted">
            {attribution === null ? null : (
              <>
                <bdi>{attribution}</bdi>{' '}
              </>
            )}
            <a
              href={hubHref}
              className="font-semibold text-action underline underline-offset-4"
            >
              {labels.learn}
            </a>
          </p>
        </div>
      </details>
    </div>
  );
}
