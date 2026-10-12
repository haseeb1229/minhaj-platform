import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  HadithAvailability,
  PublicHadithCitationSummary,
  PublicHadithContributor,
} from '@minhaj/contracts/hadith';

import type { ContentLanguage, referenceNames } from '@/composition/public-references';
import {
  Alert,
  Breadcrumbs,
  Container,
  PageHeading,
  Prose,
  TextLink,
} from '@/components/ui';
import { collectionName, citationHref, derivedDirection } from './presentation';
import { isFixture, readCollections } from './read';

/**
 * The parts every public Hadith page shares (Phase 19; SECURITY_BASELINE.md
 * §16.2).
 *
 * SOURCED TEXT IS MARKED WITH ITS OWN LANGUAGE. The original text, the chain,
 * every translation and every commentary entry is in its OWN labelled group,
 * marked with its content language and direction — Arabic is right-to-left in
 * every interface locale — so a screen reader announces each in the right voice
 * and can tell the original, a translation, the chain and a grading apart
 * without seeing them.
 *
 * EXACTLY AS STORED. Sourced text is one text node, its line breaks and spaces
 * preserved by CSS rather than by rewriting it, selectable and copyable, with no
 * animation and no decoration; a long unbroken reference or line wraps rather
 * than widening a narrow phone.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in English,
 * Urdu and Arabic.
 */

export type HadithTranslator = Awaited<ReturnType<typeof getTranslations<'hadith'>>>;

/** Home / Hadith — the trail every Hadith page starts with. */
export async function hadithTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
    hadith: { href: `/${locale}/hadith`, text: t('title') },
  };
}

/**
 * THE FIXTURE BANNER. Shown on every Hadith page while the activation is
 * engineering fixture text, before anything else on the page, in words — never
 * a colour alone — so nobody can mistake a proof environment's text for Hadith.
 */
export function FixtureBanner({ text }: { readonly text: string }) {
  return (
    <p
      role="note"
      className="rounded-[var(--radius-panel)] border-2 border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 font-semibold text-[color:var(--color-warning)]"
    >
      {text}
    </p>
  );
}

/** The fixture banner when, and only when, the activation is fixture text. */
export async function FixtureNotice({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  if (!isFixture(availability)) return null;
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return <FixtureBanner text={t('fixture')} />;
}

/**
 * The frame of a Hadith page: the column, the trail, and the fixture banner at
 * the very top whenever it applies.
 */
export async function HadithFrame({
  locale,
  availability,
  trail,
  children,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
  readonly children: ReactNode;
}) {
  const parts = await hadithTrail(locale);
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 py-12">
        <FixtureNotice locale={locale} availability={availability} />
        <Breadcrumbs label={parts.label} trail={trail} />
        {children}
      </div>
    </Container>
  );
}

/**
 * THE HONEST UNAVAILABLE STATE. While no collection is activated a Hadith page
 * says exactly that — no count, no card, no featured narration and no decision
 * identifier — and offers the way home.
 */
export async function HadithUnavailable({
  locale,
  section,
}: {
  readonly locale: Locale;
  /** The section's own name, for a page beneath the landing. */
  readonly section?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  return (
    <Container>
      <div className="flex flex-col gap-6 py-12">
        <Breadcrumbs
          label={parts.label}
          trail={
            section === undefined
              ? [parts.home, { text: t('title') }]
              : [parts.home, parts.hadith, { text: section }]
          }
        />
        <Prose>
          <PageHeading>{section ?? t('title')}</PageHeading>
          <Alert tone="info">{t('unavailable.body')}</Alert>
          <p>
            <TextLink href={`/${locale}`}>{t('unavailable.home')}</TextLink>
          </p>
        </Prose>
      </div>
    </Container>
  );
}

/* ===========================================================================
 * Sourced text
 * ========================================================================= */

export interface TextLanguage {
  readonly code: string;
  readonly name: string;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * A content language's name and direction from Taxonomy, or — for a code the
 * vocabulary does not describe — the code itself with a direction derived from
 * it, so Arabic is never set left-to-right.
 */
export function languageOf(
  languages: ReadonlyMap<string, ContentLanguage>,
  code: string,
): TextLanguage {
  const known = languages.get(code);
  return {
    code,
    name: known?.name ?? code,
    direction: known?.direction ?? derivedDirection(code),
  };
}

const TEXT_SIZE = {
  original: 'text-xl leading-loose',
  body: 'text-base leading-relaxed',
  small: 'text-sm leading-relaxed',
} as const;

/**
 * One sourced text in its own LABELLED group — the label says what it is
 * (original, chain, translation, commentary), and the text carries its own
 * language and direction. The characters are rendered exactly as stored:
 * `whitespace-pre-wrap` keeps every line break and space, and `wrap-anywhere`
 * lets an unbroken run wrap at 320px rather than overflow.
 *
 * `preview` clamps a LISTING's text visually; the whole text stays in the
 * document and the citation page shows it in full.
 */
export function SourcedText({
  id,
  label,
  text,
  language,
  size = 'body',
  preview = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly language: Pick<TextLanguage, 'code' | 'direction'>;
  readonly size?: keyof typeof TEXT_SIZE;
  readonly preview?: boolean;
}) {
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <p id={id} className="text-xs text-[color:var(--color-foreground-muted)]">
        {label}
      </p>
      <p
        lang={language.code}
        dir={language.direction}
        className={`${TEXT_SIZE[size]} text-start whitespace-pre-wrap wrap-anywhere select-text ${
          preview ? 'line-clamp-4' : ''
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** The ORIGINAL text of one record, exactly as its source gives it. */
export function OriginalText(
  props: Omit<Parameters<typeof SourcedText>[0], 'size'> & { readonly compact?: boolean },
) {
  const { compact = false, ...rest } = props;
  return <SourcedText {...rest} size={compact ? 'body' : 'original'} />;
}

/* ===========================================================================
 * Names
 * ========================================================================= */

/**
 * Every public collection's display name, keyed by slug — ONE read for a page
 * that lists citations from several collections. A collection with no recorded
 * name is shown by its slug.
 */
export async function collectionLabels(
  locale: Locale,
): Promise<ReadonlyMap<string, { readonly text: string; readonly locale: string }>> {
  const collections = await readCollections();
  return new Map(
    collections.map((collection) => {
      const name = collectionName(collection.names, locale);
      return [
        collection.slug,
        name === null
          ? { text: collection.slug, locale: 'en' }
          : { text: name.text, locale: name.locale },
      ];
    }),
  );
}

type Names = Awaited<ReturnType<typeof referenceNames>>;

/** Contributors whose People profile is public, linked to it, with their role. */
export function Contributors({
  locale,
  contributors,
  names,
  t,
}: {
  readonly locale: Locale;
  readonly contributors: readonly PublicHadithContributor[];
  readonly names: Names;
  readonly t: HadithTranslator;
}) {
  const rows = contributors.flatMap((contributor) => {
    const person = names.people.get(contributor.personId);
    return person === undefined ? [] : [{ ...person, role: contributor.role }];
  });
  if (rows.length === 0) return null;
  return (
    <p className="text-sm wrap-anywhere" dir="auto">
      {rows.map((row, index) => (
        <span key={`${row.slug}:${row.role}`}>
          {index === 0 ? null : ' · '}
          <TextLink href={`/${locale}/people/${encodeURIComponent(row.slug)}`}>
            {row.name}
          </TextLink>{' '}
          <span className="text-[color:var(--color-foreground-muted)]">
            ({t(`role.${row.role}`)})
          </span>
        </span>
      ))}
    </p>
  );
}

/* ===========================================================================
 * Citation listings
 * ========================================================================= */

/**
 * A list of public citations: each NAMED by its collection and number, linked
 * to its one canonical address, with the source's reference exactly as given
 * and a preview of its original text marked with its own language.
 */
export function CitationList({
  locale,
  citations,
  collections,
  languages,
  label,
  idPrefix,
  headingLevel,
  t,
}: {
  readonly locale: Locale;
  readonly citations: readonly PublicHadithCitationSummary[];
  readonly collections: ReadonlyMap<
    string,
    { readonly text: string; readonly locale: string }
  >;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly label: string;
  readonly idPrefix: string;
  readonly headingLevel: 'h2' | 'h3';
  readonly t: HadithTranslator;
}) {
  const Heading = headingLevel;
  return (
    <ol aria-label={label} className="flex flex-col">
      {citations.map((citation) => {
        const key = `${citation.collectionSlug}-${String(citation.number)}`;
        const name = collections.get(citation.collectionSlug) ?? {
          text: citation.collectionSlug,
          locale: 'en',
        };
        const title = t('citationName', {
          collection: name.text,
          number: citation.number,
        });
        return (
          <li key={key}>
            <article
              aria-label={title}
              className="flex min-w-0 flex-col gap-2 border-b border-[color:var(--color-border)] py-4"
            >
              <Heading className="text-base font-semibold wrap-anywhere">
                <TextLink
                  href={citationHref(locale, citation.collectionSlug, citation.number)}
                >
                  <span lang={name.locale}>{name.text}</span>{' '}
                  {t('number', { number: citation.number })}
                </TextLink>
              </Heading>
              <p className="text-xs text-[color:var(--color-foreground-muted)] wrap-anywhere">
                {t('fact.sourceReference')}:{' '}
                <span dir="auto" className="whitespace-pre-wrap">
                  {citation.sourceReference}
                </span>
              </p>
              <div className="max-w-[var(--measure-prose)] min-w-0">
                <OriginalText
                  id={`${idPrefix}-${key}`}
                  label={t('original')}
                  text={citation.text}
                  language={languageOf(languages, citation.textLanguage)}
                  compact
                  preview
                />
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
