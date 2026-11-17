import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { FATWA_LIMITS, type FatwaAvailability } from '@minhaj/contracts/fatwa';

import { ActionLink, Alert, Icon, TextLink } from '@/components/ui';
import { FatwaOfficialSite } from './guide';
import { FatwaFrame, fatwaTrail } from './parts';
import { FATWA_PROCESS_STEPS, fatwaSectionPath } from './presentation';

/** How a question is protected, in the order an asker needs to know it. */
const PRIVACY = Object.freeze([
  'ask.privacy.who',
  'ask.privacy.never',
  'ask.privacy.anonymised',
  'howItWorks.privacy.person',
  'howItWorks.privacy.identify',
  'howItWorks.privacy.closure',
] as const);

/** What the service never does. */
const NEVER = Object.freeze(['words', 'ai', 'unreviewed', 'silent', 'private'] as const);

type Heading = 'steps' | 'privacy' | 'expect' | 'never' | 'state';

/**
 * `/fatwa/how-it-works` — how a question becomes an answer (ROUTE_MAP.md §3.8;
 * Fatwa Part 1).
 *
 * PRODUCT GUIDANCE, NOT DOCTRINE. It describes the process — asked privately,
 * received and assigned, drafted, reviewed, published beside a separately
 * written anonymised question, corrected in the open — how the asker's
 * privacy is kept, what to expect, and what the service never does. It names
 * no scholar, states no position and promises no response time.
 *
 * IT STANDS WHETHER OR NOT THE SERVICE IS ACTIVE (Phase 20, kept by Fatwa
 * Part 1): it reads no Fatwa record, only whether the service is activated, and
 * how the service works is true either way — as Hadith's introduction stands
 * without a collection. It says plainly whether questions are accepted now;
 * while they are not, it closes with where things stand and Minhaj-ul-Quran's
 * own fatwa website, and offers the ask entry only when they are.
 *
 * A contents list sits beside the text on a laptop and above it on a phone.
 */
export async function FatwaHowItWorksPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
}) {
  const [t, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    fatwaTrail(locale),
  ]);
  const title = t('howItWorks.title');
  const active = availability.active;
  const sections: readonly Heading[] = [
    'steps',
    'privacy',
    'expect',
    'never',
    ...(active ? [] : (['state'] as const)),
  ];
  const id = (key: Heading) => `fatwa-process-${key}`;
  const heading = (key: Heading) => t(`howItWorks.headings.${key}`);
  const limits = { min: FATWA_LIMITS.questionMin, max: FATWA_LIMITS.questionMax };

  const expectations = [
    t('howItWorks.expect.account'),
    t('howItWorks.expect.length', limits),
    t('howItWorks.expect.status'),
    t('howItWorks.expect.limit'),
    t('howItWorks.noPromise'),
  ];

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
              {active ? t('howItWorks.accepting') : t('howItWorks.notAccepting')}
            </Alert>
          </div>
        ),
      }}
    >
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <nav
          aria-label={t('howItWorks.onThisPage')}
          className="min-w-0 lg:sticky lg:top-24 lg:order-last lg:self-start"
        >
          <p className="pb-2 text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-foreground-muted uppercase">
            {t('howItWorks.onThisPage')}
          </p>
          <ol className="flex list-none flex-col gap-1 border-s border-border p-0 ps-4 text-sm">
            {sections.map((key) => (
              <li key={key}>
                <a
                  href={`#${id(key)}`}
                  className="inline-flex min-h-11 items-center text-action underline-offset-4 hover:underline lg:min-h-9"
                >
                  {heading(key)}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-[var(--space-section)]">
          <section aria-labelledby={id('steps')} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5 border-b border-border pb-3">
              <h2 id={id('steps')} className="scroll-mt-24 text-heading font-semibold">
                {heading('steps')}
              </h2>
              <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
                {t('howItWorks.stepsIntro')}
              </p>
            </div>
            <ol className="flex list-none flex-col p-0">
              {FATWA_PROCESS_STEPS.map((step, index) => (
                <li
                  key={step}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 border-t border-border py-5 first:border-t-0 first:pt-0"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-semibold text-accent tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h3 className="text-subheading font-semibold text-balance">
                      <span className="sr-only">
                        {t('howItWorks.stepNumber', { number: index + 1 })}{' '}
                      </span>
                      {t(`howItWorks.steps.${step}.title`)}
                    </h3>
                    <p className="max-w-[var(--measure-prose)] text-foreground-muted">
                      {t(`howItWorks.steps.${step}.body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby={id('privacy')} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5 border-b border-border pb-3">
              <h2 id={id('privacy')} className="scroll-mt-24 text-heading font-semibold">
                {heading('privacy')}
              </h2>
              <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
                {t('howItWorks.privacyIntro')}
              </p>
            </div>
            <ul className="grid list-none grid-cols-1 gap-x-8 gap-y-4 p-0 md:grid-cols-2">
              {PRIVACY.map((key) => (
                <li key={key} className="flex min-w-0 items-start gap-3">
                  <Icon name="check" size={20} className="mt-0.5 shrink-0 text-accent" />
                  <span className="max-w-[var(--measure-prose)]">{t(key)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={id('expect')} className="flex flex-col gap-5">
            <h2
              id={id('expect')}
              className="scroll-mt-24 border-b border-border pb-3 text-heading font-semibold"
            >
              {heading('expect')}
            </h2>
            <ul className="flex list-none flex-col gap-3 p-0">
              {expectations.map((text) => (
                <li
                  key={text}
                  className="max-w-[var(--measure-prose)] border-s-2 border-accent-rule ps-4"
                >
                  {text}
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby={id('never')}
            className="flex flex-col gap-4 rounded-panel border border-border bg-surface-raised p-5 shadow-panel sm:p-6"
          >
            <h2 id={id('never')} className="scroll-mt-24 text-heading font-semibold">
              {heading('never')}
            </h2>
            <ul className="flex list-none flex-col gap-3 p-0">
              {NEVER.map((key) => (
                <li key={key} className="flex min-w-0 items-start gap-3">
                  <Icon name="close" size={20} className="mt-0.5 shrink-0 text-accent" />
                  <span className="max-w-[var(--measure-prose)]">
                    {t(`howItWorks.never.${key}`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {active ? null : (
            <section aria-labelledby={id('state')} className="flex flex-col gap-5">
              <h2
                id={id('state')}
                className="scroll-mt-24 border-b border-border pb-3 text-heading font-semibold"
              >
                {heading('state')}
              </h2>
              <p className="max-w-[var(--measure-prose)]">{t('door.state')}</p>
              <FatwaOfficialSite locale={locale} id="fatwa-process-official" level="h3" />
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
            {active ? (
              <>
                <ActionLink href={fatwaSectionPath(locale, 'ask')}>
                  {t('sections.ask')}
                </ActionLink>
                <span className="text-sm text-foreground-muted">
                  {t('signInRequired')}
                </span>
                <ActionLink href={fatwaSectionPath(locale)} tone="secondary">
                  {t('ruling.all')}
                </ActionLink>
              </>
            ) : (
              <TextLink href={fatwaSectionPath(locale)}>{t('awaiting.back')}</TextLink>
            )}
          </div>
        </div>
      </div>
    </FatwaFrame>
  );
}
