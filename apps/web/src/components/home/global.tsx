import type { Locale } from '@minhaj/contracts';
import { globalPaths, type PublicCountryChoice } from '@minhaj/contracts/global';
import { getTranslations } from 'next-intl/server';

import { placeName } from '@/components/global/presentation';
import { Stat } from '@/components/ui';
import { directionOf } from '@/config/locale';

import { HomeSection } from './section';

/**
 * GLOBAL REACH (R2): how many countries the directory lists, as one figure,
 * and every one of them by name — a typographic map of the network, set in
 * newspaper columns and ordered as the reader's language orders names. Each
 * name opens its country's page. Nothing renders when no country is published.
 */
export async function GlobalReach({
  locale,
  countries,
}: {
  readonly locale: Locale;
  readonly countries: readonly PublicCountryChoice[];
}) {
  if (countries.length === 0) return null;
  const [t, global] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'global' }),
  ]);
  const collator = new Intl.Collator(locale);
  const named = countries
    .map((country) => ({ country, name: placeName(country, locale) }))
    .sort((a, b) => collator.compare(a.name.text, b.name.text));

  return (
    <HomeSection
      id="home-global"
      band="sunken"
      header={{
        heading: t('home.global.heading'),
        action: { href: globalPaths.countries(locale), text: global('allCountries') },
      }}
    >
      <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <Stat
          value={new Intl.NumberFormat(locale).format(countries.length)}
          label={t('home.global.countries', { count: countries.length })}
        />
        <ul
          aria-label={global('sections.countries')}
          className="m-0 list-none columns-2 gap-x-8 p-0 sm:columns-3 xl:columns-4"
        >
          {named.map(({ country, name }) => (
            <li key={country.id} className="break-inside-avoid">
              <a
                href={globalPaths.country(locale, country.slug)}
                lang={name.locale}
                dir={directionOf(name.locale)}
                className="inline-flex min-h-11 items-center wrap-anywhere text-foreground no-underline decoration-accent-rule underline-offset-4 hover:text-action hover:underline"
              >
                {name.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </HomeSection>
  );
}
