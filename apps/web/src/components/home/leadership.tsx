import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import { leadImagePath, type PublicPageSummary } from '@minhaj/contracts/editorial';
import type { PublicPersonCard } from '@minhaj/contracts/people';
import { getTranslations } from 'next-intl/server';

import { contentLanguageBadge } from '@/components/content-language';
import { translationFor } from '@/components/editorial/presentation';
import { portraitPath } from '@/components/people/portrait';
import { EditorialCard, MediaCard } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE LEADERSHIP (R2): the founder's published biography as the feature, then
 * every published profile as a portrait. Only published records — the
 * biography Page and People's own public cards — and nothing renders when
 * neither exists. A profile without a portrait is a titled card, never an
 * avatar placeholder.
 */
export async function Leadership({
  locale,
  founder,
  people,
}: {
  readonly locale: Locale;
  readonly founder: PublicPageSummary | null;
  readonly people: readonly PublicPersonCard[];
}) {
  if (founder === null && people.length === 0) return null;
  const [t, profile] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'people' }),
  ]);

  const feature = (page: PublicPageSummary) => {
    const translation = translationFor(page, locale);
    const language = contentLanguageBadge(translation.languageCode, locale);
    const image = page.leadImage ?? null;
    return (
      <EditorialCard
        variant="lead"
        as="article"
        href={localizedPath(locale, page.routeBinding)}
        title={translation.title}
        {...(translation.excerpt === '' ? {} : { description: translation.excerpt })}
        {...(language === undefined ? {} : { language })}
        lang={translation.languageCode}
        dir={directionOf(translation.languageCode)}
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
        sizes="(min-width: 64rem) 34rem, 100vw"
      />
    );
  };

  return (
    <HomeSection
      id="home-leadership"
      header={{
        heading: t('explore.leadership.title'),
        action: {
          href: pathFor(locale, requireRoute('explore.leadership')),
          text: t('home.people.action'),
        },
      }}
    >
      <div
        className={`grid grid-cols-1 gap-x-10 gap-y-8 ${founder !== null && people.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}
      >
        {founder === null ? null : feature(founder)}
        {people.length === 0 ? null : (
          <ul
            aria-label={t('home.people.label')}
            className="grid list-none grid-cols-2 gap-x-4 gap-y-6 p-0 sm:grid-cols-3"
          >
            {people.map((person) => (
              <MediaCard
                key={person.id}
                href={localizedPath(locale, `/people/${encodeURIComponent(person.slug)}`)}
                title={person.name}
                aspect="portrait"
                sizes="(min-width: 40rem) 12rem, 45vw"
                lang={person.resolvedLocale}
                dir={directionOf(person.resolvedLocale)}
                // A portrait's credit travels with it wherever it is shown.
                {...(person.portrait === null || person.portrait.credit === null
                  ? {}
                  : {
                      meta: [
                        <span key="credit" dir="auto">
                          {profile('portraitCredit')}: {person.portrait.credit}
                        </span>,
                      ],
                    })}
                image={
                  person.portrait === null
                    ? null
                    : {
                        path: portraitPath(person.id, person.portrait.assetId),
                        alt: '',
                        width: person.portrait.width,
                        height: person.portrait.height,
                      }
                }
              />
            ))}
          </ul>
        )}
      </div>
    </HomeSection>
  );
}
