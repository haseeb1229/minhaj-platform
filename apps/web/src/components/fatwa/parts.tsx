import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability } from '@minhaj/contracts/fatwa';

import {
  Alert,
  Breadcrumbs,
  Container,
  PageHeading,
  Prose,
  TextLink,
} from '@/components/ui';
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
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in English,
 * Urdu and Arabic.
 */

export type FatwaTranslator = Awaited<ReturnType<typeof getTranslations<'fatwa'>>>;

/** Home / Fatwa — the trail every Fatwa page starts with. */
export async function fatwaTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
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
      className="rounded-[var(--radius-panel)] border-2 border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 font-semibold text-[color:var(--color-warning)]"
    >
      {t('fixture')}
    </p>
  );
}

/** The frame of a Fatwa page: the column, the fixture banner, the trail. */
export async function FatwaFrame({
  locale,
  availability,
  trail,
  children,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
  readonly children: ReactNode;
}) {
  const parts = await fatwaTrail(locale);
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 py-12">
        <FatwaFixtureNotice locale={locale} availability={availability} />
        <Breadcrumbs label={parts.label} trail={trail} />
        {children}
      </div>
    </Container>
  );
}

/** The honest state of every public Fatwa page while the service is inactive. */
export async function FatwaUnavailable({
  locale,
  section,
}: {
  readonly locale: Locale;
  /** The page's own name, for a page beneath the landing. */
  readonly section?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const parts = await fatwaTrail(locale);
  return (
    <Container>
      <div className="flex flex-col gap-6 py-12">
        <Breadcrumbs
          label={parts.label}
          trail={
            section === undefined
              ? [parts.home, { text: t('title') }]
              : [parts.home, parts.fatwa, { text: section }]
          }
        />
        <Prose>
          <PageHeading>{section ?? t('title')}</PageHeading>
          <Alert tone="info">{t('unavailable.body')}</Alert>
          <p>
            <TextLink href={fatwaSectionPath(locale, 'how-it-works')}>
              {t('unavailable.howItWorks')}
            </TextLink>
          </p>
          <p>
            <TextLink href={`/${locale}`}>{t('unavailable.home')}</TextLink>
          </p>
        </Prose>
      </div>
    </Container>
  );
}

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
