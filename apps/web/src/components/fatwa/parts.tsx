import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability } from '@minhaj/contracts/fatwa';

import { MediaPageHeader } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Container,
  Hero,
  Icon,
  SectionHeader,
} from '@/components/ui';
import { OFFICIAL_FATWA_SITE } from './official-site';
import { fatwaSectionPath } from './presentation';
import { isFatwaFixture } from './read';

/**
 * The parts every public Fatwa page shares (Phase 20; SECURITY_BASELINE.md
 * §16.2).
 *
 * THE FIXTURE BANNER COMES FIRST. While the activation is engineering fixture
 * text, every Fatwa page says so in words, before anything else, so nobody can
 * mistake a proof environment's text for a ruling.
 *
 * THE UNAVAILABLE STATE IS HONEST. While the service is not activated a page
 * says exactly that — no count, no card, no sample ruling — and offers the way
 * home and the explanation of how the service works.
 *
 * ONE OPENING FOR EVERY PAGE BENEATH THE LANDING. The banner, a quiet trail and
 * a header block — eyebrow, the page's ONE `h1`, a lede, a line of metadata —
 * so a category, a topic view, the search and a ruling read as one section.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in English,
 * Urdu and Arabic.
 */

export type FatwaTranslator = Awaited<ReturnType<typeof getTranslations<'fatwa'>>>;

interface Crumb {
  readonly href?: string;
  readonly text: string;
}

/** Home / Fatwa — the trail every Fatwa page starts with. */
export async function fatwaTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    fatwa: { href: fatwaSectionPath(locale), text: t('title') },
  };
}

/** The fixture banner when, and only when, the activation is fixture text. */
export async function FatwaFixtureNotice({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
}) {
  if (!isFatwaFixture(availability)) return null;
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return (
    <p
      role="note"
      className="rounded-panel border-2 border-warning bg-warning-surface px-4 py-3 font-semibold text-warning"
    >
      {t('fixture')}
    </p>
  );
}

/**
 * The top of the LANDING: the banner and a slim trail, above the hero band.
 * Pages beneath the landing open with `FatwaFrame` instead.
 */
export async function FatwaLandingTop({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability | null;
}) {
  const [t, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    fatwaTrail(locale),
  ]);
  return (
    <Container>
      <div className="flex flex-col gap-4 pt-6">
        {availability === null ? null : (
          <FatwaFixtureNotice locale={locale} availability={availability} />
        )}
        <Breadcrumbs label={parts.label} trail={[parts.home, { text: t('title') }]} />
      </div>
    </Container>
  );
}

/**
 * The frame of a Fatwa page beneath the landing: the column, the fixture
 * banner, then the header block — trail, eyebrow, `h1`, lede, metadata and
 * anything the page adds below them (a notice, a correction) — then the body.
 */
export async function FatwaFrame({
  locale,
  availability,
  trail,
  heading,
  children,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly trail: readonly Crumb[];
  readonly heading: {
    readonly title: ReactNode;
    readonly lede?: ReactNode;
    readonly meta?: ReactNode;
    /** Below the title block, inside the header: a notice, a correction. */
    readonly extra?: ReactNode;
  };
  readonly children: ReactNode;
}) {
  const [t, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    fatwaTrail(locale),
  ]);
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <FatwaFixtureNotice locale={locale} availability={availability} />
        <MediaPageHeader
          crumbs={{ label: parts.label, trail }}
          eyebrow={t('title')}
          title={heading.title}
          {...(heading.lede === undefined ? {} : { lede: heading.lede })}
          {...(heading.meta === undefined ? {} : { meta: heading.meta })}
        >
          {heading.extra}
        </MediaPageHeader>
        {children}
      </div>
    </Container>
  );
}

/** The three things the service guarantees about everything it lists. */
const PRINCIPLES = Object.freeze(['published', 'questions', 'corrections'] as const);

/**
 * WHAT A READER CAN RELY ON, stated before anything is listed: only reviewed,
 * published rulings appear; each sits beside a question written for
 * publication, never the asker's words; and a correction is never silent.
 * Each is a property of the service the pages enforce, not a claim about any
 * ruling — and each is true whether or not the service is active yet.
 */
export async function FatwaPrinciples({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return (
    <section aria-labelledby="fatwa-principles" className="flex flex-col gap-5">
      <SectionHeader id="fatwa-principles" heading={t('landing.trust.heading')} />
      <ul className="grid list-none grid-cols-1 gap-6 p-0 md:grid-cols-3">
        {PRINCIPLES.map((key) => (
          <li
            key={key}
            className="flex min-w-0 flex-col gap-2 border-s-2 border-accent-rule ps-4"
          >
            <h3 className="text-subheading font-semibold">
              {t(`landing.trust.${key}.title`)}
            </h3>
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {t(`landing.trust.${key}.body`)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The honest state of every public Fatwa page while the service is inactive.
 *
 * The LANDING keeps its hero and says, in the band itself, that the service is
 * not available — then describes what it will hold, as text, and links only
 * the process page (which renders either way) and home. A page beneath the
 * landing keeps its own name as its heading and says the same. Nothing here
 * searches, counts or lists: there is nothing to search, count or list.
 */
export async function FatwaUnavailable({
  locale,
  section,
}: {
  readonly locale: Locale;
  /** The page's own name, for a page beneath the landing. */
  readonly section?: string;
}) {
  const [t, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'fatwa' }),
    fatwaTrail(locale),
  ]);
  const ways = (
    <div className="flex flex-wrap items-center gap-3">
      <ActionLink href={fatwaSectionPath(locale, 'how-it-works')}>
        {t('unavailable.howItWorks')}
      </ActionLink>
      <ActionLink href={localizedPath(locale, '')} tone="secondary">
        {t('unavailable.home')}
      </ActionLink>
    </div>
  );

  if (section !== undefined)
    return (
      <Container>
        <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
          <MediaPageHeader
            crumbs={{
              label: parts.label,
              trail: [parts.home, parts.fatwa, { text: section }],
            }}
            eyebrow={t('title')}
            title={section}
          >
            <Alert tone="info">{t('unavailable.body')}</Alert>
          </MediaPageHeader>
          {ways}
        </div>
      </Container>
    );

  return (
    <>
      <FatwaLandingTop locale={locale} availability={null} />
      <Hero title={t('title')} lede={t('description')}>
        <p className="flex max-w-[var(--measure-prose)] items-start gap-2 text-sm text-foreground-muted">
          <Icon name="info" size={16} className="mt-1 text-accent" />
          <span>{t('unavailable.body')}</span>
        </p>
        {ways}
      </Hero>
      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
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

          <section
            aria-labelledby="fatwa-ask"
            className="grid grid-cols-1 gap-x-10 gap-y-3 border-t border-border pt-8 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
          >
            <h2 id="fatwa-ask" className="text-heading font-semibold text-balance">
              {t('unavailable.askHeading')}
            </h2>
            <p className="reading-face max-w-[var(--measure-prose)] text-lede">
              {t('unavailable.askBody')}
            </p>
          </section>

          <section
            aria-labelledby="fatwa-official"
            className="flex flex-col gap-3 rounded-panel bg-surface-sunken px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 id="fatwa-official" className="text-subheading font-semibold">
                {t('unavailable.officialHeading')}
              </h2>
              <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
                {t('unavailable.officialBody')}
              </p>
            </div>
            <a
              href={OFFICIAL_FATWA_SITE}
              rel="external noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-control border border-border-strong bg-surface-raised px-4 text-sm font-semibold text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface sm:self-auto"
            >
              {t('unavailable.officialLink')}
              <Icon name="external" size={16} className="text-foreground-muted" />
            </a>
          </section>

          <FatwaPrinciples locale={locale} />
        </div>
      </Container>
    </>
  );
}

/** What the service will hold, in the order a visitor meets it. */
const OFFER = Object.freeze([
  { key: 'rulings', icon: 'book' },
  { key: 'browse', icon: 'list' },
  { key: 'ask', icon: 'message' },
] as const);

/** A date, in the interface locale, never shifted by a zone, machine-readable. */
export function FatwaDate({
  value,
  locale,
}: {
  readonly value: Date;
  readonly locale: Locale;
}) {
  return (
    <time dateTime={value.toISOString()}>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
        value,
      )}
    </time>
  );
}
