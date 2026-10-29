import type { Locale } from '@minhaj/contracts';
import type { PublicPageSummary } from '@minhaj/contracts/editorial';

import { CARD_SURFACE, CARD_TITLE_LINK } from './frame';
import { LeadThumbnail } from './lead-image';
import { translationFor } from './presentation';

/**
 * ONE PUBLISHED ORGANISATIONAL PAGE AS A CARD (Phase 30-R): its lead image
 * where it has one, its title in its own language and direction, and its own
 * excerpt. The address is the Page's binding — the shell route it was
 * published to — so a card always lands on the one canonical page. A Page
 * without an image is a deliberate text-first card.
 */
export function ExplorePageCard({
  locale,
  page,
  eyebrow,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly page: PublicPageSummary;
  /** The section the page belongs to, already worded in the interface language. */
  readonly eyebrow?: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const translation = translationFor(page, locale);
  const direction = translation.languageCode === 'en' ? 'ltr' : 'rtl';
  const Heading = headingLevel;
  const image = page.leadImage ?? null;
  return (
    <li className={CARD_SURFACE}>
      {image === null ? null : (
        <LeadThumbnail
          image={image}
          alt={translation.leadAlt ?? ''}
          lang={translation.languageCode}
          className="-mx-5 -mt-5 mb-1 w-[calc(100%+2.5rem)] max-w-none rounded-t-[var(--radius-panel)]"
        />
      )}
      {eyebrow === undefined ? null : (
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
          {eyebrow}
        </p>
      )}
      <Heading
        className="text-subheading leading-snug font-semibold text-balance wrap-anywhere"
        lang={translation.languageCode}
        dir={direction}
      >
        <a href={`/${locale}${page.routeBinding}`} className={CARD_TITLE_LINK}>
          {translation.title}
        </a>
      </Heading>
      {translation.excerpt === '' ? null : (
        <p
          className="line-clamp-3 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
          lang={translation.languageCode}
          dir={direction}
        >
          {translation.excerpt}
        </p>
      )}
    </li>
  );
}

/** The Explore section a published Page's binding belongs to, e.g. `about`. */
export function exploreSectionOf(binding: string): string | null {
  return /^\/explore\/([a-z-]+)(?:\/|$)/u.exec(binding)?.[1] ?? null;
}
