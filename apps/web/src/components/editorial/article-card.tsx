import type { Locale } from '@minhaj/contracts';
import type { PublicEditorialSummary } from '@minhaj/contracts/editorial';

import { MetaRow } from '@/components/ui';
import { CARD_SURFACE, CARD_TITLE_LINK } from './frame';
import { LeadThumbnail } from './lead-image';
import { translationFor } from './presentation';

/**
 * ONE ARTICLE CARD (Phase 30-R): the lead image where the article has one,
 * its chronology date, its headline in its own language and direction, and
 * its own summary. An article without an image is a deliberate text-first
 * card — never a placeholder picture.
 */
export function ArticleCard({
  locale,
  record,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly record: PublicEditorialSummary;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const translation = translationFor(record, locale);
  const direction = translation.languageCode === 'en' ? 'ltr' : 'rtl';
  const Heading = headingLevel;
  const image = record.leadImage ?? null;
  const date = record.chronologyAt ?? null;
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
      {date === null ? null : (
        <MetaRow
          items={[
            <time key="date" dateTime={date.toISOString().slice(0, 10)}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: 'long',
                timeZone: 'UTC',
              }).format(date)}
            </time>,
          ]}
        />
      )}
      <Heading
        className="text-subheading leading-snug font-semibold text-balance wrap-anywhere"
        lang={translation.languageCode}
        dir={direction}
      >
        <a
          href={`/${locale}/library/articles/${encodeURIComponent(record.slug)}`}
          className={CARD_TITLE_LINK}
        >
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
