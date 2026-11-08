import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import { collectionPathOf, type CollectionSummary } from '@minhaj/contracts/editorial';
import { getTranslations } from 'next-intl/server';

import { contentLanguageBadge } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { EditorialCard } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * CURATED COLLECTIONS (R2) — conferences, campaigns and occasions gathered by
 * editors. A collection's summary carries words only, so each is an entry
 * under a hairline, its title in the display face: text-first by design,
 * never a grey picture standing in for one.
 */
export async function CollectionsIndex({
  locale,
  items,
}: {
  readonly locale: Locale;
  readonly items: readonly CollectionSummary[];
}) {
  if (items.length === 0) return null;
  const [t, collections] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'collections' }),
  ]);

  return (
    <HomeSection
      id="home-collections"
      header={{
        heading: collections('title'),
        intro: collections('description'),
        action: {
          href: pathFor(locale, requireRoute('collections')),
          text: t('home.links.allCollections'),
        },
      }}
    >
      <ul
        aria-label={collections('title')}
        className="grid list-none grid-cols-1 gap-x-8 gap-y-6 p-0 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items.map((item) => {
          const translation = translationFor(item, locale);
          const language = contentLanguageBadge(translation.languageCode, locale);
          return (
            <EditorialCard
              key={item.slug}
              variant="compact"
              href={localizedPath(locale, collectionPathOf(item.slug))}
              title={translation.title}
              {...(language === undefined ? {} : { language })}
              lang={translation.languageCode}
              dir={directionOf(translation.languageCode)}
            />
          );
        })}
      </ul>
    </HomeSection>
  );
}
