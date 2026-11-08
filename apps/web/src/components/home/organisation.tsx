import type { Locale } from '@minhaj/contracts';
import type { PublicPageSummary } from '@minhaj/contracts/editorial';
import { getTranslations } from 'next-intl/server';

import { ExploreCard } from '@/components/explore/cards';
import { CardGrid } from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE ORGANISATION'S OWN PAGES (restored from the pre-R2 portal): the
 * published Pages bound to Explore routes, picture-led, from one bounded read.
 * Only what is published renders; nothing renders when nothing is. The
 * founder's biography leads the leadership module instead, so the caller
 * leaves it out here.
 */
export async function OrganisationModule({
  locale,
  pages,
}: {
  readonly locale: Locale;
  readonly pages: readonly PublicPageSummary[];
}) {
  if (pages.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <HomeSection
      id="home-organisation"
      header={{
        heading: t('home.organisation.heading'),
        intro: t('home.organisation.intro'),
        action: {
          href: pathFor(locale, requireRoute('explore')),
          text: t('home.exploreAction'),
        },
      }}
    >
      <CardGrid label={t('home.organisation.heading')}>
        {pages.map((page) => (
          <ExploreCard key={page.routeBinding} locale={locale} page={page} />
        ))}
      </CardGrid>
    </HomeSection>
  );
}
