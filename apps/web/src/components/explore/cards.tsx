import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import { leadImagePath, type PublicPageSummary } from '@minhaj/contracts/editorial';
import type { PublicPersonCard } from '@minhaj/contracts/people';

import { contentLanguageBadge } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { portraitPath } from '@/components/people/portrait';
import { MediaCard } from '@/components/ui';
import { directionOf } from '@/config/locale';

/**
 * THE EXPLORE FAMILY'S CARDS (R2) — the organisation's own published Pages and
 * its published people, image-led wherever a real picture exists.
 *
 * PUBLISHED ONLY. A card is built from a published Page summary or a published
 * People card; a reserved address that has nothing on it is never listed.
 * Each card is one link (the title), its words carry their own language and
 * direction, and a card in another language than the interface says which.
 */

/** One published organisational Page: its lead picture, title and excerpt. */
export function ExploreCard({
  locale,
  page,
  headingLevel = 'h3',
  priority = false,
}: {
  readonly locale: Locale;
  readonly page: PublicPageSummary;
  readonly headingLevel?: 'h2' | 'h3';
  readonly priority?: boolean;
}) {
  const translation = translationFor(page, locale);
  const language = contentLanguageBadge(translation.languageCode, locale);
  const image = page.leadImage ?? null;
  return (
    <MediaCard
      href={localizedPath(locale, page.routeBinding)}
      title={translation.title}
      description={translation.excerpt}
      lang={translation.languageCode}
      dir={directionOf(translation.languageCode)}
      headingLevel={headingLevel}
      aspect="wide"
      sizes="(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw"
      priority={priority}
      image={
        image === null
          ? null
          : {
              path: leadImagePath(image),
              alt: translation.leadAlt ?? '',
              width: image.width,
              height: image.height,
            }
      }
      {...(language === undefined ? {} : { language })}
    />
  );
}

/** One published person: a portrait-led card, or a text-first one without a portrait. */
export function LeaderCard({
  locale,
  person,
  creditLabel,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly person: PublicPersonCard;
  /** The localised word introducing a portrait credit ("Photo"). */
  readonly creditLabel: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const portrait = person.portrait;
  return (
    <MediaCard
      href={localizedPath(locale, `/people/${encodeURIComponent(person.slug)}`)}
      title={person.name}
      {...(person.excerpt === null ? {} : { description: person.excerpt })}
      lang={person.resolvedLocale}
      dir={directionOf(person.resolvedLocale)}
      headingLevel={headingLevel}
      aspect="portrait"
      sizes="(min-width: 64rem) 25vw, 50vw"
      image={
        portrait === null
          ? null
          : {
              path: portraitPath(person.id, portrait.assetId),
              width: portrait.width,
              height: portrait.height,
            }
      }
      {...(portrait?.credit == null
        ? {}
        : { meta: [`${creditLabel}: ${portrait.credit}`] })}
    />
  );
}
