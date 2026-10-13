import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability } from '@minhaj/contracts/fatwa';

import { Alert, PageHeading, Prose, TextLink } from '@/components/ui';
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
    >
      <Prose>
        <PageHeading>{title}</PageHeading>
        <p>{t('howItWorks.intro')}</p>
        <Alert tone="info">
          {availability.active ? t('howItWorks.accepting') : t('howItWorks.notAccepting')}
        </Alert>
      </Prose>
      <ol className="flex flex-col gap-6">
        {STEPS.map((step, index) => (
          <li key={step} className="flex max-w-[var(--measure-prose)] flex-col gap-1">
            <h2 className="text-lg font-semibold">
              {t('howItWorks.stepNumber', { number: index + 1 })}{' '}
              {t(`howItWorks.steps.${step}.title`)}
            </h2>
            <p>{t(`howItWorks.steps.${step}.body`)}</p>
          </li>
        ))}
      </ol>
      <Prose>
        <p>{t('howItWorks.noPromise')}</p>
        {availability.active ? (
          <>
            <p>
              <TextLink href={fatwaSectionPath(locale, 'ask')}>
                {t('sections.ask')}
              </TextLink>{' '}
              <span className="text-sm">({t('signInRequired')})</span>
            </p>
            <p>
              <TextLink href={fatwaSectionPath(locale)}>{t('ruling.all')}</TextLink>
            </p>
          </>
        ) : (
          <p>
            <TextLink href={`/${locale}`}>{t('unavailable.home')}</TextLink>
          </p>
        )}
      </Prose>
    </FatwaFrame>
  );
}
