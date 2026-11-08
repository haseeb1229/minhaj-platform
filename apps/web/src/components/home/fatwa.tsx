import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability, PublicFatwaSummary } from '@minhaj/contracts/fatwa';
import { getTranslations } from 'next-intl/server';

import { FatwaList, categoryLabels } from '@/components/fatwa/list';
import { FatwaFixtureNotice } from '@/components/fatwa/parts';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE LATEST RULINGS (restored from the pre-R2 portal) — only while the Fatwa
 * service is activated and has published rulings, and with the fixture notice
 * on a proof deployment, exactly as the Fatwa pages carry it. Fatwa's own
 * public browse, newest first, through Fatwa's own list.
 */
export async function FatwaModule({
  locale,
  availability,
  items,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly items: readonly PublicFatwaSummary[];
}) {
  if (!availability.active || items.length === 0) return null;
  const [t, fatwa, categories] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'fatwa' }),
    categoryLabels(locale),
  ]);

  return (
    <HomeSection
      id="home-fatwa"
      header={{
        heading: fatwa('landing.rulings'),
        action: {
          href: pathFor(locale, requireRoute('fatwa')),
          text: t('home.links.fatwa'),
        },
      }}
    >
      <FatwaFixtureNotice locale={locale} availability={availability} />
      <FatwaList
        locale={locale}
        items={items}
        categories={categories}
        label={fatwa('landing.rulings')}
        headingLevel="h3"
        t={fatwa}
      />
    </HomeSection>
  );
}
