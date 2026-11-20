import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import {
  EVENT_PREVIEW,
  type CentreNewsPage,
  type EventPage,
  type EventWhen,
} from '@minhaj/contracts/editorial';
import {
  dialablePhone,
  globalPaths,
  type CentreContact,
  type CentreScope,
  type PublicCentre,
  type PublicCentrePage,
  type PublicPlace,
} from '@minhaj/contracts/global';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { EventGrid } from '@/components/editorial/events';
import { NewsGrid } from '@/components/editorial/news';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { BreadcrumbData } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  DetailRow,
  EmptyState,
  PageHero,
  Prose,
  SectionHeader,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  CentreShelf,
  DirectoryBody,
  DirectoryCrumbs,
  MoreLink,
  RecordHeader,
  ShareRecord,
  type GlobalTranslator,
} from './frame';
import { finderPlaceHref } from './global-view';
import { centreWords, placeLocales, placeName } from './presentation';

/**
 * One Centre (ROUTE_MAP.md §3.9) — Phase 16, rebuilt in R2:
 *
 *   `/global/centres/{slug}`           its genuine facts, contacts, latest local
 *                                      News and Events, Share, and the Centres
 *                                      nearest it in the directory
 *   `/global/centres/{slug}/contact`   its public directory contacts — display only
 *
 * Its News and Events listings are `./centre-activity`, which shares the trail,
 * the bounded reads and the opening band defined here.
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. The Centre is Global's public read; its
 * News and its Events are Editorial's own bounded reads by the Centre's
 * identifier. Neither context reads the other's tables, and a failure in
 * Editorial's read degrades that section in words rather than taking the Centre
 * page down.
 *
 * ONLY GENUINE FACTS. An address, coordinates, a description and contacts are
 * shown when the organisation supplied them and are simply absent otherwise:
 * no map, logo, photograph, opening hours or official status is invented, and
 * coordinates are shown as numbers, never plotted. "Nearby" is the directory's
 * own geography — the same City, else Region, else Country — never a distance.
 *
 * THE CONTACT PAGE SENDS NOTHING. It lists the contact details the Centre has
 * published; writing to the organisation is the general `/contact` page's
 * Editorial correspondence.
 */

/** How many of a Centre's News items, and of its nearest Centres, its page previews. */
const NEWS_PREVIEW = 3;
const NEARBY = 4;

export async function centreTrail(locale: Locale, centre: PublicCentre) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'global' });
  const words = centreWords(centre, locale);
  return {
    label: shell('nav.breadcrumbs'),
    shellHome: shell('nav.home'),
    base: [
      { href: localizedPath(locale, ''), text: shell('nav.home') },
      { href: globalPaths.home(locale), text: t('title') },
      { href: globalPaths.centres(locale), text: t('sections.centres') },
    ],
    name: words?.name ?? centre.slug,
    nameLocale: words?.locale ?? centre.primaryLocale,
  };
}

/** The Centre's News, or `null` when Editorial's read failed — never a crash. */
export async function centreNews(
  centreId: string,
  offset: number,
  limit: number,
): Promise<CentreNewsPage | null> {
  try {
    return await editorialReadRuntime().centreNews([centreId], offset, limit);
  } catch {
    // The Centre is still true without its News: the page says the News is
    // unavailable instead of failing. A public content route reaches no logger
    // (it would pull the full server environment into an anonymous page), so
    // Editorial's own read path is where such a failure is observed.
    return null;
  }
}

/**
 * The Centre's Events of one view with how many each view holds, or `null`
 * when Editorial's read failed — never a crash.
 */
export async function centreEvents(
  centreId: string,
  when: EventWhen,
  offset: number,
  limit: number,
): Promise<{
  readonly page: EventPage;
  readonly counts: Readonly<Record<EventWhen, number>>;
} | null> {
  try {
    const reads = editorialReadRuntime();
    const [page, facets] = await Promise.all([
      reads.centreEvents(centreId, when, offset, limit),
      reads.eventListingFacets({ when, centreIds: [centreId] }),
    ]);
    return { page, counts: facets.when };
  } catch {
    return null;
  }
}

/**
 * The Centres nearest this one in the directory's own geography: the
 * narrowest of its City (in it or serving it), its Region and its Country
 * that holds another Centre — never itself, never a distance. `null` when
 * none does, or Global's read failed.
 */
async function nearbyCentres(centre: PublicCentre): Promise<{
  readonly page: PublicCentrePage;
  readonly place: PublicPlace;
  readonly others: readonly PublicCentrePage['items'][number][];
} | null> {
  const countryId = centre.country.id;
  const scopes: { readonly scope: CentreScope; readonly place: PublicPlace }[] = [
    ...(centre.city === null
      ? []
      : [
          {
            scope: { countryId, regionId: null, cityId: centre.city.id },
            place: centre.city,
          },
        ]),
    ...(centre.region === null
      ? []
      : [
          {
            scope: { countryId, regionId: centre.region.id, cityId: null },
            place: centre.region,
          },
        ]),
    { scope: { countryId, regionId: null, cityId: null }, place: centre.country },
  ];
  try {
    for (const { scope, place } of scopes) {
      const page = await globalReadRuntime().centresIn({
        scope,
        kind: null,
        offset: 0,
        limit: NEARBY + 1,
      });
      const others = page.items
        .filter((entry) => entry.id !== centre.id)
        .slice(0, NEARBY);
      if (others.length > 0) return { page, place, others };
    }
    return null;
  } catch {
    return null;
  }
}

function PlaceLink({
  place,
  href,
  locale,
}: {
  readonly place: PublicPlace;
  readonly href: string;
  readonly locale: Locale;
}) {
  const name = placeName(place, locale);
  return (
    <TextLink href={href}>
      <span lang={name.locale} dir={directionOf(name.locale)}>
        {name.text}
      </span>
    </TextLink>
  );
}

/** One contact as a described link — always left-to-right, whatever the page. */
function ContactValue({
  contact,
  t,
}: {
  readonly contact: CentreContact;
  readonly t: GlobalTranslator;
}) {
  if (contact.channel === 'website')
    return (
      <a
        href={contact.value}
        rel="external noopener noreferrer"
        className="font-medium break-all text-action underline underline-offset-2"
      >
        <span dir="ltr">{contact.value}</span>{' '}
        <span className="text-foreground-muted">{t('contact.external')}</span>
      </a>
    );
  const href =
    contact.channel === 'email'
      ? `mailto:${contact.value}`
      : dialablePhone(contact.value);
  return href === null ? (
    <span dir="ltr">{contact.value}</span>
  ) : (
    <a
      href={href}
      className="font-medium break-all text-action underline underline-offset-2"
    >
      <span dir="ltr">{contact.value}</span>
    </a>
  );
}

function ContactList({
  contacts,
  t,
  columns = 2,
}: {
  readonly contacts: readonly CentreContact[];
  readonly t: GlobalTranslator;
  readonly columns?: 1 | 2;
}) {
  return (
    <dl className={`grid gap-x-8 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
      {contacts.map((contact, index) => (
        <DetailRow
          key={`${contact.channel}-${String(index)}`}
          term={t(`contact.${contact.channel}`)}
        >
          <ContactValue contact={contact} t={t} />
        </DetailRow>
      ))}
    </dl>
  );
}

/**
 * One of the Centre's fact cards — a labelled section on the raised surface,
 * so Location and Contact details sit side by side as the two things a person
 * looking for a Centre came to find.
 */
function FactCard({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5"
    >
      <h2 id={id} className="text-subheading font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** Where the Centre is, as links into the directory, with its address. */
function LocationFacts({
  centre,
  locale,
  t,
}: {
  readonly centre: PublicCentre;
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  const words = centreWords(centre, locale);
  return (
    <dl className="flex flex-col">
      <DetailRow term={t('centre.country')}>
        <PlaceLink
          place={centre.country}
          href={globalPaths.country(locale, centre.country.slug)}
          locale={locale}
        />
      </DetailRow>
      {centre.region === null ? null : (
        <DetailRow term={t('centre.region')}>
          <PlaceLink
            place={centre.region}
            href={globalPaths.region(locale, centre.country.slug, centre.region.slug)}
            locale={locale}
          />
        </DetailRow>
      )}
      {centre.city === null ? null : (
        <DetailRow term={t('centre.city')}>
          <PlaceLink
            place={centre.city}
            href={globalPaths.city(locale, centre.country.slug, centre.city.slug)}
            locale={locale}
          />
        </DetailRow>
      )}
      {words?.address == null ? null : (
        <DetailRow term={t('centre.address')}>
          <address
            className="whitespace-pre-line not-italic wrap-anywhere"
            lang={words.locale}
            dir={directionOf(words.locale)}
          >
            {words.address}
          </address>
        </DetailRow>
      )}
      {centre.coordinates === null ? null : (
        <DetailRow term={t('centre.coordinates')}>
          <span dir="ltr">
            {t('centre.latitude')} {centre.coordinates.latitude}, {t('centre.longitude')}{' '}
            {centre.coordinates.longitude}
          </span>
        </DetailRow>
      )}
    </dl>
  );
}

/* ===========================================================================
 * /global/centres/{slug}
 * ========================================================================= */

export async function CentreDetailPage({
  locale,
  centre,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await centreTrail(locale, centre);
  const words = centreWords(centre, locale);
  const direction = directionOf(trail.nameLocale);
  const [news, events, nearby] = await Promise.all([
    centreNews(centre.id, 0, NEWS_PREVIEW),
    centreEvents(centre.id, 'upcoming', 0, EVENT_PREVIEW),
    nearbyCentres(centre),
  ]);
  const others = nearby?.others ?? [];
  const nearbyName = nearby === null ? null : placeName(nearby.place, locale);
  const nearbyHref =
    nearby === null
      ? null
      : nearby.place.id === centre.city?.id
        ? globalPaths.city(locale, centre.country.slug, nearby.place.slug)
        : nearby.place.id === centre.region?.id
          ? globalPaths.region(locale, centre.country.slug, nearby.place.slug)
          : globalPaths.country(locale, centre.country.slug);
  const path = globalPaths.centre(locale, centre.slug);

  return (
    <article>
      <DirectoryCrumbs
        label={trail.label}
        trail={[...trail.base, { text: trail.name }]}
      />
      <RecordHeader
        kind={t('centre.eyebrow')}
        name={trail.name}
        nameLocale={trail.nameLocale}
        actions={
          <>
            <ActionLink
              href={finderPlaceHref(globalPaths.finder(locale), {
                country: centre.country.slug,
              })}
              tone="secondary"
            >
              {t('centre.findAnother')}
            </ActionLink>
            <ShareRecord locale={locale} path={path} title={trail.name} />
          </>
        }
      >
        {centre.isVirtual ? (
          <p className="text-foreground-muted">
            <span className="font-semibold text-foreground">{t('centre.virtual')}</span> —{' '}
            {t('centre.virtualBody')}
          </p>
        ) : null}
        {words?.description == null ? null : (
          <Prose>
            {paragraphsOf(words.description).map((paragraph, index) => (
              <p key={index} lang={words.locale} dir={direction}>
                {paragraph}
              </p>
            ))}
          </Prose>
        )}
      </RecordHeader>

      <DirectoryBody>
        <div className="grid grid-cols-1 gap-4 *:min-w-0 md:grid-cols-2">
          <FactCard id="centre-facts" heading={t('centre.facts')}>
            <LocationFacts centre={centre} locale={locale} t={t} />
          </FactCard>

          <FactCard id="centre-contacts" heading={t('centre.contacts')}>
            {centre.contacts.length === 0 ? (
              <EmptyState>{t('contact.empty')}</EmptyState>
            ) : (
              <ContactList contacts={centre.contacts} t={t} columns={1} />
            )}
            <div className="mt-auto">
              <MoreLink href={globalPaths.centreContact(locale, centre.slug)}>
                {t('centre.contactPage')}
              </MoreLink>
            </div>
          </FactCard>
        </div>

        {centre.servedCities.length === 0 ? null : (
          <section className="flex flex-col gap-5" aria-labelledby="centre-served">
            <SectionHeader
              id="centre-served"
              heading={t('centre.served')}
              intro={t('centre.servedIntro')}
            />
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {centre.servedCities.map((city) => {
                const name = placeName(city, locale);
                return (
                  <li key={city.id} className="min-w-0">
                    <a
                      href={globalPaths.city(locale, centre.country.slug, city.slug)}
                      lang={name.locale}
                      dir={directionOf(name.locale)}
                      className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface-raised px-4 text-sm wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface active:bg-accent-rule"
                    >
                      {name.text}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-5" aria-labelledby="centre-events">
          <SectionHeader
            id="centre-events"
            heading={t('centre.events')}
            {...(events === null || events.counts.upcoming + events.counts.past === 0
              ? {}
              : {
                  intro: t('centre.eventsCounts', {
                    upcoming: events.counts.upcoming,
                    past: events.counts.past,
                  }),
                })}
          />
          {events === null ? (
            <Alert tone="info">{t('centre.eventsUnavailable')}</Alert>
          ) : events.page.items.length === 0 ? (
            <EmptyState>{t('centre.eventsEmpty')}</EmptyState>
          ) : (
            <EventGrid
              locale={locale}
              items={events.page.items}
              when="upcoming"
              label={t('centre.events')}
              headingLevel="h3"
            />
          )}
          <MoreLink href={globalPaths.centreEvents(locale, centre.slug)}>
            {t('centre.allEvents')}
          </MoreLink>
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="centre-news">
          <SectionHeader
            id="centre-news"
            heading={t('centre.news')}
            {...(news === null || news.total === 0
              ? {}
              : {
                  action: {
                    href: globalPaths.centreNews(locale, centre.slug),
                    text: t('centre.allNewsCount', { count: news.total }),
                  },
                })}
          />
          {news === null ? (
            <Alert tone="info">{t('centre.newsUnavailable')}</Alert>
          ) : news.items.length === 0 ? (
            <EmptyState>{t('centre.newsEmpty')}</EmptyState>
          ) : (
            <NewsGrid
              locale={locale}
              items={news.items}
              label={t('centre.news')}
              showType={false}
              headingLevel="h3"
            />
          )}
        </section>

        {others.length === 0 || nearbyName === null || nearbyHref === null ? null : (
          <CentreShelf
            id="centre-nearby"
            heading={
              <>
                {t('centre.nearby')}{' '}
                {nearbyName.locale === locale ? (
                  nearbyName.text
                ) : (
                  <span lang={nearbyName.locale} dir={directionOf(nearbyName.locale)}>
                    {nearbyName.text}
                  </span>
                )}
              </>
            }
            more={{
              href: nearbyHref,
              text: t('centre.nearbyAll', { count: nearby?.page.total ?? 0 }),
            }}
            label={t('centre.nearbyLabel')}
            centres={others}
            locale={locale}
            t={t}
          />
        )}
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(centre)}
        trail={[
          { name: trail.shellHome, path: localizedPath(trail.nameLocale, '') },
          { name: t('title'), path: globalPaths.home(trail.nameLocale) },
          { name: t('sections.centres'), path: globalPaths.centres(trail.nameLocale) },
          { name: trail.name, path: globalPaths.centre(trail.nameLocale, centre.slug) },
        ]}
      />
    </article>
  );
}

/**
 * The opening band of one of a Centre's own pages: its title, which names the
 * Centre and so is resolved by direction rather than by the interface, a lede,
 * and the way back to the Centre.
 */
export function CentreSubpageHero({
  title,
  lede,
  back,
}: {
  readonly title: string;
  readonly lede: string;
  readonly back: { readonly href: string; readonly text: string };
}) {
  return (
    <PageHero
      title={<span dir="auto">{title}</span>}
      lede={lede}
      actions={
        <ActionLink href={back.href} tone="secondary">
          <span dir="auto">{back.text}</span>
        </ActionLink>
      }
    />
  );
}

/* ===========================================================================
 * /global/centres/{slug}/contact
 * ========================================================================= */

/**
 * A Centre's public directory contacts, DISPLAY ONLY: the contacts the Centre
 * has published, its address and where it is — nothing else, and no control
 * that sends anything. Writing to the organisation is the general contact page.
 */
export async function CentreContactPage({
  locale,
  centre,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await centreTrail(locale, centre);
  const title = t('contact.title', { centre: trail.name });
  const back = globalPaths.centre(locale, centre.slug);

  return (
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          ...trail.base,
          { href: back, text: trail.name },
          { text: t('centre.contacts') },
        ]}
      />
      <CentreSubpageHero
        title={title}
        lede={t('contact.notice')}
        back={{ href: back, text: t('centreNews.back', { centre: trail.name }) }}
      />
      <DirectoryBody>
        <div className="grid grid-cols-1 gap-4 *:min-w-0 md:grid-cols-2">
          <FactCard id="contact-details" heading={t('centre.contacts')}>
            {centre.contacts.length === 0 ? (
              <EmptyState>{t('contact.empty')}</EmptyState>
            ) : (
              <ContactList contacts={centre.contacts} t={t} columns={1} />
            )}
          </FactCard>
          <FactCard id="contact-where" heading={t('centre.facts')}>
            {centre.isVirtual ? (
              <p className="text-sm text-foreground-muted">{t('centre.virtualBody')}</p>
            ) : null}
            <LocationFacts centre={centre} locale={locale} t={t} />
          </FactCard>
        </div>
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t('contact.privacy')}{' '}
          <TextLink href={localizedPath(locale, '/contact')}>
            {t('contact.general')}
          </TextLink>
        </p>
      </DirectoryBody>
    </>
  );
}
