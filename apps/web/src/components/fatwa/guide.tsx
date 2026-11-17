import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import {
  ActionLink,
  AwaitingPage,
  Container,
  Hero,
  Icon,
  SectionHeader,
  TextLink,
} from '@/components/ui';
import { OFFICIAL_FATWA_SITE } from './official-site';
import { FatwaLandingTop, FatwaPrinciples, fatwaTrail } from './parts';
import { FATWA_PROCESS_STEPS, fatwaSectionPath } from './presentation';

/**
 * THE SECTION'S GUIDE WHILE THE SERVICE IS NOT OPEN (Fatwa Part 1) — the
 * landing's front door and the pages that await the service.
 *
 * PRODUCT DESCRIPTION, NEVER A RULING. No `fatwa.publish` grant exists and no
 * ruling is published (OPEN_DECISIONS.md §1.4), so nothing here reads a
 * Fatwa record beyond whether the service is activated: it says what the
 * service will be, how a question will become an answer, and where things
 * stand — and shows nothing in a ruling's place, no sample, no example. It
 * names no scholar, states no position and promises no response time.
 *
 * WHAT IS OPEN IS LINKED; WHAT AWAITS THE SERVICE IS NAMED, NEVER LINKED. Only
 * the process page renders whatever the service's state; search, the
 * categories and asking are named and marked "Opens when the service opens",
 * as Hadith names the pages that await a collection. The one other open way is
 * OUTBOUND: Minhaj-ul-Quran's own fatwa website, a plain link from
 * `official-site.ts` — never fetched, embedded or tracked (ROUTE_MAP.md §3.8).
 */

/** What the service will hold, in the order a visitor meets it. */
const OFFER = Object.freeze([
  { key: 'rulings', icon: 'book' },
  { key: 'browse', icon: 'list' },
  { key: 'ask', icon: 'message' },
] as const);

/** The four parts of the Fatwa menu, and the one page each holds. */
const PARTS = Object.freeze([
  { part: 'find', page: 'search', path: 'search' },
  { part: 'browse', page: 'categories', path: 'categories' },
  { part: 'ask', page: 'ask', path: 'ask' },
  { part: 'understand', page: 'howItWorks', path: 'how-it-works' },
] as const);

/** The pages that stand while the service is inactive. */
const OPEN_WHILE_INACTIVE: ReadonlySet<string> = new Set(['how-it-works']);

/** The sections a page awaiting the service can stand for. */
export type FatwaAwaitingSection = 'search' | 'categories' | 'ask';

/**
 * MINHAJ-UL-QURAN'S OWN FATWA WEBSITE — the one way to an answer while this
 * service is not open. A plain outbound link that says it leaves this site.
 */
export async function FatwaOfficialSite({
  locale,
  id,
  level,
}: {
  readonly locale: Locale;
  /** The heading's id, which labels the section. */
  readonly id: string;
  readonly level: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const Heading = level;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-panel bg-surface-sunken p-5 sm:p-6"
    >
      <Heading id={id} className="text-subheading font-semibold text-balance">
        {t('unavailable.officialHeading')}
      </Heading>
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('unavailable.officialBody')}
      </p>
      <div className="flex flex-col gap-1.5 pt-1">
        <a
          href={OFFICIAL_FATWA_SITE}
          rel="external noopener noreferrer"
          className="inline-flex min-h-11 max-w-full items-center gap-2 self-start rounded-control border border-border-strong bg-surface-raised px-4 text-sm font-semibold text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface"
        >
          <span className="wrap-anywhere">{t('unavailable.officialLink')}</span>
          <Icon name="external" size={16} className="shrink-0 text-foreground-muted" />
        </a>
        <p className="text-caption text-foreground-muted">
          {t('unavailable.officialNote')}
        </p>
      </div>
    </section>
  );
}

/**
 * HOW THIS SECTION IS ORGANISED — the Fatwa menu's four parts, each with its
 * page, the open one linked and the rest named and marked.
 */
async function FatwaSectionMap({ locale }: { readonly locale: Locale }) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  return (
    <section className="flex flex-col gap-5" aria-labelledby="fatwa-map">
      <SectionHeader
        id="fatwa-map"
        heading={t('door.mapHeading')}
        intro={t('door.mapIntro')}
      />
      <ul className="grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
        {PARTS.map(({ part, page, path }) => {
          const open = OPEN_WHILE_INACTIVE.has(path);
          return (
            <li key={part} className="flex h-full min-w-0 flex-col gap-2.5">
              <h3 className="border-b border-border pb-2 text-subheading font-semibold">
                {shell(`menu.columns.${part}`)}
              </h3>
              <p className="text-sm font-medium">
                {open ? (
                  <TextLink href={fatwaSectionPath(locale, path)}>
                    {t(`sections.${page}`)}
                  </TextLink>
                ) : (
                  <span>{t(`sections.${page}`)}</span>
                )}
              </p>
              <p className="text-sm text-foreground-muted">{t(`sectionBody.${page}`)}</p>
              {open ? null : (
                <p className="mt-auto flex items-start gap-1.5 text-caption font-medium text-foreground-muted">
                  <Icon name="info" size={16} className="mt-0.5 shrink-0" />
                  <span>{t('door.opens')}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * `/fatwa` WHILE THE SERVICE IS NOT ACTIVATED — the section's front door
 * (Fatwa Part 1; the R2 "coming" page until then, historical).
 *
 * In the order a visitor needs it: what Fatwa here will be, and that it is not
 * open (the hero, leading to the process); where things stand, beside the way
 * to an answer now — Minhaj-ul-Quran's own fatwa website; what the service
 * will offer; how a question will become an answer, who answers and how the
 * asker stays anonymous; what a reader can rely on; and how the section is
 * organised. It searches, counts and lists nothing: there is nothing to
 * search, count or list.
 */
export async function FatwaFrontDoor({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return (
    <>
      <FatwaLandingTop locale={locale} availability={null} />
      <Hero title={t('title')} lede={t('door.lede')}>
        <p className="flex max-w-[var(--measure-prose)] items-start gap-2 text-sm text-foreground-muted">
          <Icon name="info" size={16} className="mt-1 shrink-0 text-accent" />
          <span>{t('unavailable.body')}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ActionLink href={fatwaSectionPath(locale, 'how-it-works')}>
            {t('unavailable.howItWorks')}
          </ActionLink>
        </div>
      </Hero>
      <Container>
        <div className="flex flex-col gap-[var(--space-section)] pt-10 pb-[var(--space-section)]">
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section
              aria-labelledby="fatwa-state"
              className="flex min-w-0 flex-col gap-3 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-6"
            >
              <p className="flex w-fit max-w-full items-center gap-1.5 text-caption font-semibold text-accent">
                <Icon name="info" size={16} className="shrink-0" />
                <span>{t('awaiting.status')}</span>
              </p>
              <h2 id="fatwa-state" className="text-heading font-semibold text-balance">
                {t('door.stateHeading')}
              </h2>
              <p className="max-w-[var(--measure-prose)]">{t('door.state')}</p>
            </section>
            <FatwaOfficialSite locale={locale} id="fatwa-official" level="h2" />
          </div>

          <section aria-labelledby="fatwa-offer" className="flex flex-col gap-6">
            <SectionHeader id="fatwa-offer" heading={t('unavailable.offerHeading')} />
            <ul className="grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 md:grid-cols-3">
              {OFFER.map(({ key, icon }) => (
                <li key={key} className="flex min-w-0 flex-col gap-2">
                  <Icon name={icon} size={24} className="text-accent" />
                  <h3 className="text-subheading font-semibold">
                    {t(`unavailable.offer.${key}.title`)}
                  </h3>
                  <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
                    {t(`unavailable.offer.${key}.body`)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="fatwa-process" className="flex flex-col gap-6">
            <SectionHeader
              id="fatwa-process"
              heading={t('door.processHeading')}
              intro={t('door.processIntro')}
              action={{
                href: fatwaSectionPath(locale, 'how-it-works'),
                text: t('door.processAll'),
              }}
            />
            <ol className="grid list-none grid-cols-1 gap-x-6 gap-y-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {FATWA_PROCESS_STEPS.map((step, index) => (
                <li key={step} className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-semibold text-accent tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 pt-1.5 font-medium text-balance">
                    <span className="sr-only">
                      {t('howItWorks.stepNumber', { number: index + 1 })}{' '}
                    </span>
                    {t(`howItWorks.steps.${step}.title`)}
                  </span>
                </li>
              ))}
            </ol>
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 border-t border-border pt-6 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-subheading font-semibold">{t('door.whoHeading')}</h3>
                <p className="max-w-[var(--measure-prose)] text-foreground-muted">
                  {t('door.who')}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-subheading font-semibold">
                  {t('unavailable.askHeading')}
                </h3>
                <p className="max-w-[var(--measure-prose)] text-foreground-muted">
                  {t('unavailable.askBody')}
                </p>
              </div>
            </div>
          </section>

          <FatwaPrinciples locale={locale} />

          <FatwaSectionMap locale={locale} />
        </div>
      </Container>
    </>
  );
}

/**
 * A FATWA PAGE THAT AWAITS THE SERVICE — Search, Categories and Ask while no
 * activation exists (Fatwa Part 1; replacing the Phase-20 bare unavailable
 * state, historical). The shared `AwaitingPage`, as Hadith's pages that await
 * a collection: the page's name, what will appear here, that nothing is shown
 * in its place, and the open ways onward — the process page, and
 * Minhaj-ul-Quran's own fatwa website. Asking offers nothing to type into: no
 * form exists, so nothing can be sent to a service nobody is authorised to
 * answer.
 */
export async function FatwaAwaiting({
  locale,
  section,
}: {
  readonly locale: Locale;
  readonly section: FatwaAwaitingSection;
}) {
  const [t, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    fatwaTrail(locale),
  ]);
  const title = t(`sections.${section}`);
  return (
    <AwaitingPage
      crumbs={{ label: parts.label, trail: [parts.home, parts.fatwa, { text: title }] }}
      status={t('awaiting.status')}
      title={title}
      lede={t(`awaiting.what.${section}`)}
      notice={{
        id: 'fatwa-awaiting-notice',
        title: t('awaiting.noticeTitle'),
        children: (
          <>
            <p className="max-w-[var(--measure-prose)]">
              {t(section === 'ask' ? 'awaiting.noticeAsk' : 'awaiting.notice')}
            </p>
            <p>
              <TextLink href={fatwaSectionPath(locale, 'how-it-works')}>
                {t('unavailable.howItWorks')}
              </TextLink>
            </p>
          </>
        ),
      }}
      back={<TextLink href={fatwaSectionPath(locale)}>{t('awaiting.back')}</TextLink>}
    >
      <div className="max-w-3xl">
        <FatwaOfficialSite locale={locale} id="fatwa-awaiting-official" level="h2" />
      </div>
    </AwaitingPage>
  );
}
