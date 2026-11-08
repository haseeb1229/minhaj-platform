import type { Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { CardGrid, LinkCard } from '@/components/ui';
import { EXPLORE_SECTIONS } from '@/shell/explore';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * ACROSS THE PLATFORM — the other primary domains, ALWAYS listed, each with
 * the description its own landing uses. A domain with nothing published yet is
 * still a delivered landing that says so honestly, so the home page names the
 * whole platform rather than only the parts that happen to be filled.
 */
export async function AreasModule({ locale }: { readonly locale: Locale }) {
  const [t, all] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale }),
  ]);

  const areas = [
    { key: 'learn', title: t('nav.learn'), body: all('learn.description') },
    { key: 'library', title: t('nav.library'), body: all('library.description') },
    { key: 'watch', title: t('nav.watch'), body: all('watch.description') },
    { key: 'fatwa', title: t('nav.fatwa'), body: all('fatwa.description') },
    { key: 'news-events', title: t('nav.newsEvents'), body: all('news.description') },
    { key: 'global', title: t('nav.global'), body: all('global.intro') },
  ] as const;

  return (
    <HomeSection
      id="home-areas"
      header={{ heading: t('home.areas.heading'), intro: t('home.areas.intro') }}
    >
      <CardGrid>
        {areas.map((area) => (
          <LinkCard
            key={area.key}
            href={pathFor(locale, requireRoute(area.key))}
            title={area.title}
            description={area.body}
          />
        ))}
      </CardGrid>
    </HomeSection>
  );
}

/**
 * EXPLORE — the organisation's seven sections, ALWAYS listed, from the same
 * allowlist the Explore routes validate against, so a card here and a 404
 * there cannot disagree. Each section's landing says honestly what of it is
 * published.
 */
export async function ExploreSections({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <HomeSection
      id="home-explore"
      header={{
        heading: t('home.exploreHeading'),
        intro: t('home.exploreIntro'),
        action: {
          href: pathFor(locale, requireRoute('explore')),
          text: t('home.exploreAction'),
        },
      }}
    >
      <CardGrid>
        {EXPLORE_SECTIONS.map((section) => (
          <LinkCard
            key={section}
            href={pathFor(locale, requireRoute(`explore.${section}`))}
            title={t(`explore.${section}.title` as 'explore.about.title')}
            description={t(`explore.${section}.summary` as 'explore.about.summary')}
          />
        ))}
      </CardGrid>
    </HomeSection>
  );
}
