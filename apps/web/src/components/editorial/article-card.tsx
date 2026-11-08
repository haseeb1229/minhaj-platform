import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { PublicEditorialSummary } from '@minhaj/contracts/editorial';

import { MediaCard } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { leadCardImage } from './lead-image';
import { translationFor } from './presentation';

/**
 * ONE ARTICLE CARD (Phase 30-R; R2 anatomy): the shared image-led card — the
 * article's own lead image where it has one, its headline in its own language
 * and direction, its own summary and its chronology date. An article without
 * an image is a deliberate text-first card, never a placeholder picture; one
 * whose words are not in the interface language says which language they are.
 */
export async function ArticleCard({
  locale,
  record,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly record: PublicEditorialSummary;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const translation = translationFor(record, locale);
  const image = record.leadImage ?? null;
  const date = record.chronologyAt ?? null;
  return (
    <MediaCard
      href={localizedPath(locale, `/library/articles/${encodeURIComponent(record.slug)}`)}
      title={translation.title}
      description={translation.excerpt}
      lang={translation.languageCode}
      dir={directionOf(translation.languageCode)}
      headingLevel={headingLevel}
      aspect="wide"
      sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
      image={image === null ? null : leadCardImage(image, translation.leadAlt ?? '')}
      {...(translation.languageCode === locale
        ? {}
        : {
            language: {
              label: t(`languages.${translation.languageCode}`),
              code: translation.languageCode,
            },
          })}
      {...(date === null
        ? {}
        : {
            meta: [
              <time key="date" dateTime={date.toISOString().slice(0, 10)}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'long',
                  timeZone: 'UTC',
                }).format(date)}
              </time>,
            ],
          })}
    />
  );
}
