import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import { formatDuration, isoDuration } from '@minhaj/contracts/media';

import { Breadcrumbs } from '@/components/ui';
import { absoluteUrl } from '@/config/origin';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';

/**
 * The small presentation parts Watch, Listen and the photograph pages share —
 * one implementation, so a duration, a date, a page link and a breadcrumb
 * claim read the same on every Media surface.
 */

/** A date-only fact, formatted in the interface locale and never shifted by a zone. */
export function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

/** A duration, machine-readable and always left-to-right (`1:02:03`). */
export function Duration({ seconds }: { readonly seconds: number }) {
  return (
    <time dateTime={isoDuration(seconds)} dir="ltr">
      {formatDuration(seconds)}
    </time>
  );
}

/**
 * Previous and next page links — the platform's ONE pager, kept under its
 * Phase-10 name for the many listings that import it from here. New code
 * imports `Pager` from `@/components/ui`.
 */
export { Pager as Pagination } from '@/components/ui/pager';

/**
 * The opening of a Media page that is not a section landing: the trail, the
 * page's ONE `h1`, then what kind of record it is (`eyebrow`), a lede and a
 * line of metadata.
 *
 * R2: THE HEADING LEADS. What was an upper-case label above the title now sits
 * under it as a quiet line of badges and words, so the title is the first
 * thing read and nothing competes with it.
 *
 * `lang` and `dir` mark the TITLE, which is content and may be in another
 * language from the page; the eyebrow and the metadata are interface text.
 * The lede is a node, so a caller may mark its own content language on it.
 */
export function MediaPageHeader({
  crumbs,
  eyebrow,
  title,
  lang,
  dir,
  lede,
  meta,
  children,
}: {
  readonly crumbs: {
    readonly label: string;
    readonly trail: readonly { readonly href?: string; readonly text: string }[];
  };
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly lang?: string;
  readonly dir?: 'ltr' | 'rtl';
  readonly lede?: ReactNode;
  readonly meta?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6 border-b border-border pb-8">
      <Breadcrumbs label={crumbs.label} trail={crumbs.trail} />
      <div className="flex max-w-3xl min-w-0 flex-col gap-3">
        <h1
          className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
          {...(lang === undefined ? {} : { lang })}
          {...(dir === undefined ? {} : { dir })}
        >
          {title}
        </h1>
        {eyebrow === undefined ? null : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground-muted">
            {eyebrow}
          </div>
        )}
        {lede === undefined ? null : (
          <div className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {lede}
          </div>
        )}
        {meta === undefined ? null : <div className="pt-1">{meta}</div>}
        {children}
      </div>
    </header>
  );
}

/**
 * The surface every Media card shares — a whole-card link made from ONE anchor
 * (`MEDIA_CARD_LINK`, stretched by the global `card-link` rule) — so a card
 * with a poster or a mark keeps the same shape, hover and focus echo as the
 * shared `LinkCard`.
 */
export const MEDIA_CARD =
  'card-surface group relative flex h-full min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-surface-raised shadow-panel transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-raised';

/** The title link of a Media card — the card's ONE anchor, stretched over it. */
export const MEDIA_CARD_LINK =
  'card-link text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline active:text-action';

/** A dot-separated run of eyebrow words; the separators are decorative. */
export function EyebrowWords({ words }: { readonly words: readonly ReactNode[] }) {
  const present = words.filter(
    (word) => word !== null && word !== undefined && word !== false && word !== '',
  );
  return present.map((word, index) => (
    <span key={index} className="inline-flex items-center gap-x-2">
      {index === 0 ? null : <span aria-hidden="true">·</span>}
      <span>{word}</span>
    </span>
  ));
}

/**
 * JSON-LD, ONLY WHAT IS TRUE and only when the page may be indexed at all: a
 * `BreadcrumbList`. No `AudioObject` or `ImageObject` is claimed — ROUTE_MAP.md
 * §9.6 lists neither, and either one's content address would be a byte route
 * behind an authorisation decision, which is not a public, stable media URL to
 * advertise.
 */
export function BreadcrumbData({
  contentLocales,
  trail,
}: {
  readonly contentLocales: readonly Locale[];
  readonly trail: readonly { readonly name: string; readonly path: string }[];
}) {
  if (!isContentIndexable({ contentLocales })) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((entry, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: entry.name,
            item: absoluteUrl(entry.path),
          })),
        }),
      }}
    />
  );
}
