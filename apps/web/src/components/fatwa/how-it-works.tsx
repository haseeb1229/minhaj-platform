import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability } from '@minhaj/contracts/fatwa';

import { ActionLink, Alert } from '@/components/ui';
import { FatwaFrame, fatwaTrail } from './parts';
import { fatwaSectionPath } from './presentation';

/** The stages of the process, in order. */
const STEPS = Object.freeze([
  'ask',
  'triage',
  'drafting',
  'review',
  'publication',
  'corrections',
] as const);

/**
 * `/fatwa/how-it-works` — the PROCESS, and nothing else (ROUTE_MAP.md §3.8).
 *
 * PRODUCT GUIDANCE, NOT DOCTRINE. It describes how a question moves — asked
 * privately, triaged and assigned, drafted, reviewed by a scholar, published
 * with a separately written anonymised question, corrected in the open — and
 * names no scholar, states no position and promises no response time.
 *
 * IT EXISTS WHETHER OR NOT THE SERVICE IS ACTIVE, because how the service works
 * is true either way; it says plainly whether questions are being accepted now
 * and offers the ask entry only when they are.
 */
export async function FatwaHowItWorksPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const parts = await fatwaTrail(locale);
  const title = t('howItWorks.title');

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.fatwa, { text: title }]}
      heading={{
        title,
        lede: t('howItWorks.intro'),
        extra: (
          <div className="pt-1">
            <Alert tone="info">
              {availability.active
                ? t('howItWorks.accepting')
                : t('howItWorks.notAccepting')}
            </Alert>
          </div>
        ),
      }}
    >
      <ol className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
          >
            <h2 className="flex flex-col gap-1.5">
              <span className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
                {t('howItWorks.stepNumber', { number: index + 1 })}
              </span>{' '}
              <span className="text-subheading font-semibold text-balance">
                {t(`howItWorks.steps.${step}.title`)}
              </span>
            </h2>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t(`howItWorks.steps.${step}.body`)}
            </p>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-4 border-t border-[color:var(--color-border)] pt-6">
        <p className="max-w-[var(--measure-prose)]">{t('howItWorks.noPromise')}</p>
        <div className="flex flex-wrap items-center gap-3">
          {availability.active ? (
            <>
              <ActionLink href={fatwaSectionPath(locale, 'ask')}>
                {t('sections.ask')}
              </ActionLink>
              <span className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('signInRequired')}
              </span>
              <ActionLink href={fatwaSectionPath(locale)} tone="secondary">
                {t('ruling.all')}
              </ActionLink>
            </>
          ) : (
            <ActionLink href={`/${locale}`} tone="secondary">
              {t('unavailable.home')}
            </ActionLink>
          )}
        </div>
      </div>
    </FatwaFrame>
  );
}
