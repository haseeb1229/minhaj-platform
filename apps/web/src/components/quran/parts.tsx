import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  PublicRecitation,
  PublicRecitationSegment,
  QuranAvailability,
} from '@minhaj/contracts/quran';

import type { ContentLanguage } from '@/composition/public-references';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  Field,
  Icon,
  PageHeading,
  Prose,
  Select,
  TextLink,
} from '@/components/ui';
import { corpusNotice, type ReadingContext } from './read';
import { REFERENCE_LINKS } from './reference-sources';
import {
  READING_LAYERS,
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  type ReadingLayer,
  type TextSize,
} from './presentation';
import { RecitationPlayer } from './recitation-player';

/**
 * The parts every public Quran page shares (Phase 18; SECURITY_BASELINE.md
 * §16.2).
 *
 * SCRIPTURE IS MARKED WITH ITS OWN LANGUAGE. The canonical Arabic is always in
 * an element with `lang="ar" dir="rtl"`, whatever the interface locale; every
 * translation, transliteration and Tafsir is in its OWN labelled group with its
 * content language and direction. A screen reader therefore announces each in
 * the right voice and can tell them apart without seeing them.
 *
 * NO ANIMATION ON SCRIPTURE, AND NO DECORATION. These are markup and classes;
 * nothing moves. Sizes are ephemeral query values, never stored.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in English,
 * Urdu and Arabic.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;

/** Home / Quran — the trail every Quran page starts with. */
export async function quranTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'quran' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    quran: { href: localizedPath(locale, '/quran'), text: t('title') },
  };
}

/**
 * THE FIXTURE BANNER. Shown on every Quran page while the active corpus is
 * engineering fixture text, before anything else on the page, in words — never
 * a colour alone — so nobody can mistake a proof environment's text for the
 * Quran.
 */
export function FixtureBanner({ text }: { readonly text: string }) {
  return (
    <p
      role="note"
      className="rounded-panel border-2 border-warning bg-warning-surface px-4 py-3 font-semibold text-warning"
    >
      {text}
    </p>
  );
}

/** Where "About this text" lives: the Quran landing, at this anchor. */
const ABOUT_ANCHOR = 'about-this-text';

/**
 * THE REFERENCE NOTICE — one discreet, truthful line at the top of every Quran
 * page while the active corpus is the staging reference preview (Rebaseline
 * R2). It says the text is shown for review and has not been checked by
 * Minhaj-ul-Quran's religious authority for this platform, and points to the
 * full attribution. It never calls the text approved and never says it is not
 * the Quran: it is the Quran, from a named, licensed source.
 */
async function ReferenceNotice({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return (
    <p role="note" className="flex items-start gap-2 text-sm text-foreground-muted">
      <Icon name="info" size={16} className="mt-1 text-warning" />
      <span>
        {t.rich('reference.notice', {
          link: (chunks) => (
            <TextLink href={`${localizedPath(locale, '/quran')}#${ABOUT_ANCHOR}`}>
              {chunks}
            </TextLink>
          ),
        })}
      </span>
    </p>
  );
}

/**
 * What every Quran page says first about its corpus — decided in one place
 * (`QURAN_MODE_POSTURE`): the fixture banner, the reference-preview line, or
 * nothing for an approved corpus.
 */
export async function CorpusNotice({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
}) {
  switch (corpusNotice(availability)) {
    case 'fixture': {
      const t = await getTranslations({ locale, namespace: 'quran' });
      return <FixtureBanner text={t('fixture')} />;
    }
    case 'reference':
      return <ReferenceNotice locale={locale} />;
    case null:
      return null;
  }
}

/**
 * "ABOUT THIS TEXT" — the reference preview's full attribution: the Tanzil
 * Project's Uthmani text with its version and licence (its terms require the
 * source to be named and linked), the Irfan-ul-Quran translation with its
 * rights holder and official site, and the plain statement that none of it has
 * been reviewed for this platform. Rendered only in reference mode; the
 * translation line only where a translation is shown.
 */
export async function AboutThisText({
  locale,
  availability,
  translation,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  /** Whether any public translation is shown beside the text. */
  readonly translation: boolean;
}) {
  if (corpusNotice(availability) !== 'reference') return null;
  const t = await getTranslations({ locale, namespace: 'quran' });
  const link = (href: string) => (chunks: ReactNode) => (
    <TextLink href={href}>{chunks}</TextLink>
  );
  return (
    <section
      id={ABOUT_ANCHOR}
      aria-labelledby={`${ABOUT_ANCHOR}-heading`}
      className="scroll-mt-20 border-t border-border pt-6"
    >
      <div className="grid grid-cols-1 gap-x-10 gap-y-3 text-sm md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <h2 id={`${ABOUT_ANCHOR}-heading`} className="text-subheading font-semibold">
          {t('reference.aboutHeading')}
        </h2>
        <div className="flex max-w-[var(--measure-prose)] flex-col gap-3">
          <p>
            {t.rich('reference.arabic', {
              tanzil: link(REFERENCE_LINKS.tanzil),
              licence: link(REFERENCE_LINKS.licence),
            })}
          </p>
          {translation ? (
            <p>
              {t.rich('reference.translation', {
                official: link(REFERENCE_LINKS.official),
              })}
            </p>
          ) : null}
          <p className="text-foreground-muted">{t('reference.status')}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * The frame of a Quran page: the column, the trail, and the corpus notice at
 * the very top whenever it applies.
 */
export async function QuranFrame({
  locale,
  availability,
  trail,
  children,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
  readonly children: ReactNode;
}) {
  const parts = await quranTrail(locale);
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <CorpusNotice locale={locale} availability={availability} />
        <Breadcrumbs label={parts.label} trail={trail} />
        {children}
      </div>
    </Container>
  );
}

/**
 * THE HONEST UNAVAILABLE STATE. While no corpus is active a Quran page says
 * exactly that — no count, no card, no sample and no decision identifier — and
 * offers the way home.
 */
export async function QuranUnavailable({
  locale,
  section,
}: {
  readonly locale: Locale;
  /** The section's own name, for a page beneath the landing. */
  readonly section?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  return (
    <Container>
      <div className="flex flex-col gap-6 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={parts.label}
          trail={
            section === undefined
              ? [parts.home, { text: t('title') }]
              : [parts.home, parts.quran, { text: section }]
          }
        />
        <Prose>
          <PageHeading>{section ?? t('title')}</PageHeading>
          <Alert tone="info">{t('unavailable.body')}</Alert>
          <p>
            <TextLink href={localizedPath(locale, '')}>{t('unavailable.home')}</TextLink>
          </p>
        </Prose>
      </div>
    </Container>
  );
}

/* ===========================================================================
 * Scripture and layers
 * ========================================================================= */

export const LAYER_SIZE: Readonly<Record<TextSize, string>> = {
  small: 'text-sm',
  medium: 'text-base',
  large: 'text-lg',
  larger: 'text-xl',
};

/**
 * One layer's text in its own LABELLED group, marked with its own language and
 * direction, so a translation is never read out as though it were the Arabic.
 */
export function LayerBlock({
  id,
  label,
  text,
  language,
  size,
  muted = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  readonly language: { readonly code: string; readonly direction: 'ltr' | 'rtl' };
  readonly size: TextSize;
  readonly muted?: boolean;
}) {
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <p id={id} className="text-xs text-foreground-muted">
        {label}
      </p>
      <p
        lang={language.code}
        dir={language.direction}
        className={`${LAYER_SIZE[size]} break-words ${
          muted ? 'text-foreground-muted' : ''
        }`}
      >
        {text}
      </p>
    </div>
  );
}

/** A content language's name and direction, or the code itself when unknown. */
export function languageOf(
  languages: ReadonlyMap<string, ContentLanguage>,
  code: string,
): { readonly code: string; readonly name: string; readonly direction: 'ltr' | 'rtl' } {
  const known = languages.get(code);
  return {
    code,
    name: known?.name ?? code,
    direction: known?.direction ?? 'ltr',
  };
}

/* ===========================================================================
 * Reading preferences
 * ========================================================================= */

/**
 * One visible notice per preference that could not be honoured. The page shows
 * no layer for it — it never substitutes another work.
 */
export async function LayerNotices({
  locale,
  unavailable,
}: {
  readonly locale: Locale;
  readonly unavailable: readonly ReadingLayer[];
}) {
  if (unavailable.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'quran' });
  return (
    <div className="flex flex-col gap-2">
      {unavailable.map((layer) => (
        <Alert key={layer} tone="warning">
          {t(`notice.${layer}`)}
        </Alert>
      ))}
    </div>
  );
}

/** Where the reading form lives on a page — the settings sheet links to it. */
export const READING_OPTIONS_ID = 'reading-options';

/**
 * The reading options — a REAL GET form, so every choice works without
 * JavaScript and every reading is a shareable address, and none of it is stored
 * anywhere. The options are exactly the public works; the canonical address of
 * the page carries none of them.
 *
 * R2: folded into a disclosure at the end of the reader. The everyday choices
 * (which translations, how large) live in the reader's settings sheet; this
 * form chooses particular works, a transliteration, a tafsir and a recitation.
 */
export async function ReadingForm({
  locale,
  action,
  context,
  languages,
}: {
  readonly locale: Locale;
  readonly action: string;
  readonly context: ReadingContext;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const { options, choice } = context;
  const workOption = (work: { slug: string; name: string; languageCode: string }) => (
    <option key={work.slug} value={work.slug}>
      {`${work.name} · ${languageOf(languages, work.languageCode).name}`}
    </option>
  );
  const changed =
    READING_LAYERS.some((layer) => choice[layer] !== null) ||
    choice.size !== DEFAULT_TEXT_SIZE;

  return (
    <details
      id={READING_OPTIONS_ID}
      className="group scroll-mt-20 rounded-panel border border-border bg-surface-raised"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span className="text-subheading font-semibold">{t('reading.heading')}</span>
          <span className="text-sm text-foreground-muted">{t('reading.summary')}</span>
        </span>
        <Icon
          name="chevron-down"
          size={20}
          className="text-foreground-muted group-open:rotate-180"
        />
      </summary>
      <form
        method="get"
        action={action}
        aria-label={t('reading.heading')}
        className="flex flex-col gap-4 border-t border-border px-5 pt-4 pb-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field id="reading-translation" label={t('reading.translation')}>
            {(props) => (
              <Select
                {...props}
                name="translation"
                defaultValue={choice.translation ?? ''}
              >
                <option value="">{t('reading.defaultTranslation')}</option>
                {options.translations.map(workOption)}
              </Select>
            )}
          </Field>
          <Field id="reading-transliteration" label={t('reading.transliteration')}>
            {(props) => (
              <Select
                {...props}
                name="transliteration"
                defaultValue={choice.transliteration ?? ''}
              >
                <option value="">{t('reading.none')}</option>
                {options.transliterations.map(workOption)}
              </Select>
            )}
          </Field>
          <Field id="reading-tafsir" label={t('reading.tafsir')}>
            {(props) => (
              <Select {...props} name="tafsir" defaultValue={choice.tafsir ?? ''}>
                <option value="">{t('reading.none')}</option>
                {options.tafsirs.map(workOption)}
              </Select>
            )}
          </Field>
          <Field id="reading-reciter" label={t('reading.reciter')}>
            {(props) => (
              <Select {...props} name="reciter" defaultValue={choice.reciter ?? ''}>
                <option value="">{t('reading.none')}</option>
                {options.recitations.map((recitation) => (
                  <option key={recitation.slug} value={recitation.slug}>
                    {recitation.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="reading-size" label={t('reading.size')}>
            {(props) => (
              <Select {...props} name="size" defaultValue={choice.size}>
                {TEXT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t(`size.${size}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button tone="secondary">{t('reading.apply')}</Button>
          {changed ? <TextLink href={action}>{t('reading.reset')}</TextLink> : null}
        </div>
      </form>
    </details>
  );
}

/* ===========================================================================
 * Recitation
 * ========================================================================= */

/** The accessible range of a segment: "Surah 2, ayat 1–5" or "Surah 2, Ayah 6". */
export function segmentRange(
  t: QuranTranslator,
  segment: Pick<PublicRecitationSegment, 'surah' | 'startAyah' | 'endAyah'>,
): string {
  return segment.startAyah === segment.endAyah
    ? t('ayahName', { surah: segment.surah, ayah: segment.startAyah })
    : t('rangeName', {
        surah: segment.surah,
        start: segment.startAyah,
        end: segment.endAyah,
      });
}

/** One segment's native player, named by the recitation and the range it covers. */
export async function SegmentPlayer({
  locale,
  recitation,
  segment,
}: {
  readonly locale: Locale;
  readonly recitation: Pick<PublicRecitation, 'id' | 'name'>;
  readonly segment: PublicRecitationSegment;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  return (
    <RecitationPlayer
      recitationId={recitation.id}
      segmentId={segment.id}
      assetId={segment.assetId}
      labels={{
        player: t('player.name', {
          name: recitation.name,
          range: segmentRange(t, segment),
        }),
        unsupported: t('player.unsupported'),
        failed: t('player.failed'),
      }}
    />
  );
}
