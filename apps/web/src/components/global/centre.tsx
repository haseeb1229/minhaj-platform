import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import {
  EVENT_PAGE,
  EVENT_PREVIEW,
  NEWS_PAGE,
  type EventPage,
  type EventWhen,
  type NewsPage,
} from '@minhaj/contracts/editorial';
import {
  dialablePhone,
  globalPaths,
  type CentreContact,
  type PublicCentre,
  type PublicPlace,
} from '@minhaj/contracts/global';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { EventGrid, WhenLinks } from '@/components/editorial/events';
import { NewsGrid } from '@/components/editorial/news';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  DetailRow,
  EmptyState,
  PageHero,
  Panel,
  Prose,
  SectionHeader,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { DirectoryBody, DirectoryCrumbs, RecordHeader } from './directory';
import {
  centreWords,
  placeLocales,
  placeName,
  readOffsetOf,
  withQuery,
} from './presentation';

/**
 * One Centre (ROUTE_MAP.md §3.9) — Phase 16.
 *
 *   `/global/centres/{slug}`           its genuine facts and latest local News
 *   `/global/centres/{slug}/news`      its News, a page at a time
 *   `/global/centres/{slug}/events`    its Events, upcoming or past (Phase 14)
 *   `/global/centres/{slug}/contact`   its public directory contacts — display only
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
 * coordinates are shown as numbers, never plotted.
 *
 * THE CONTACT PAGE SENDS NOTHING. It lists public contact details; writing to
 * the organisation is the general `/contact` page's Editorial correspondence.
 */

/** How many of a Centre's News items its page previews. */
const NEWS_PREVIEW = 3;

type GlobalTranslator = Awaited<ReturnType<typeof getTranslations<'global'>>>;
type Query = Record<string, string | string[] | undefined>;

async function centreTrail(locale: Locale, centre: PublicCentre) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'global' });
  const words = centreWords(centre, locale);
  return {
    label: shell('nav.breadcrumbs'),
    shellHome: shell('nav.home'),
    base: [
      { href: `/${locale}`, text: shell('nav.home') },
      { href: globalPaths.home(locale), text: t('title') },
      { href: globalPaths.centres(locale), text: t('sections.centres') },
    ],
    name: words?.name ?? centre.slug,
    nameLocale: words?.locale ?? centre.primaryLocale,
  };
}

/** The Centre's News, or `null` when Editorial's read failed — never a crash. */
async function centreNews(
  centreId: string,
  offset: number,
  limit: number,
): Promise<NewsPage | null> {
  try {
    return await editorialReadRuntime().centreNews(centreId, offset, limit);
  } catch {
    // The Centre is still true without its News: the page says the News is
    // unavailable instead of failing. A public content route reaches no logger
    // (it would pull the full server environment into an anonymous page), so
    // Editorial's own read path is where such a failure is observed.
    return null;
  }
}

/** The Centre's Events, or `null` when Editorial's read failed — never a crash. */
async function centreEvents(
  centreId: string,
  when: EventWhen,
  offset: number,
  limit: number,
): Promise<EventPage | null> {
  try {
    return await editorialReadRuntime().centreEvents(centreId, when, offset, limit);
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
        className="font-medium break-all text-[color:var(--color-action)] underline underline-offset-2"
      >
        <span dir="ltr">{contact.value}</span>{' '}
        <span className="text-[color:var(--color-foreground-muted)]">
          {t('contact.external')}
        </span>
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
      className="font-medium break-all text-[color:var(--color-action)] underline underline-offset-2"
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
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] border-t-4 border-t-[color:var(--color-accent-rule)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
    >
      <h2 id={id} className="text-subheading font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** A link that names where it goes, at the foot of a section. */
function MoreLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <p>
      <a
        href={href}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-action)] underline-offset-4 hover:underline active:text-[color:var(--color-action-hover)]"
      >
        {children}
        <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
          →
        </span>
      </a>
    </p>
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
  const [news, events] = await Promise.all([
    centreNews(centre.id, 0, NEWS_PREVIEW),
    centreEvents(centre.id, 'upcoming', 0, EVENT_PREVIEW),
  ]);

  return (
    <article>
      <DirectoryCrumbs
        label={trail.label}
        trail={[...trail.base, { text: trail.name }]}
      />
      <RecordHeader
        eyebrow={t('centre.eyebrow')}
        name={trail.name}
        nameLocale={trail.nameLocale}
      >
        {centre.isVirtual ? (
          <p className="text-[color:var(--color-foreground-muted)]">
            <span className="font-semibold text-[color:var(--color-foreground)]">
              {t('centre.virtual')}
            </span>{' '}
            — {t('centre.virtualBody')}
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
                    href={globalPaths.region(
                      locale,
                      centre.country.slug,
                      centre.region.slug,
                    )}
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
                    dir={direction}
                  >
                    {words.address}
                  </address>
                </DetailRow>
              )}
              {centre.coordinates === null ? null : (
                <DetailRow term={t('centre.coordinates')}>
                  <span dir="ltr">
                    {t('centre.latitude')} {centre.coordinates.latitude},{' '}
                    {t('centre.longitude')} {centre.coordinates.longitude}
                  </span>
                </DetailRow>
              )}
            </dl>
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
            <SectionHeader id="centre-served" heading={t('centre.served')} />
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {centre.servedCities.map((city) => {
                const name = placeName(city, locale);
                return (
                  <li key={city.id} className="min-w-0">
                    <a
                      href={globalPaths.city(locale, centre.country.slug, city.slug)}
                      lang={name.locale}
                      dir={directionOf(name.locale)}
                      className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] px-4 text-sm wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-surface)] active:bg-[color:var(--color-accent-rule)]"
                    >
                      {name.text}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-5" aria-labelledby="centre-news">
          <SectionHeader id="centre-news" heading={t('centre.news')} />
          {news === null ? (
            <Alert tone="info">{t('centre.newsUnavailable')}</Alert>
          ) : news.items.length === 0 ? (
            <EmptyState>{t('centre.newsEmpty')}</EmptyState>
          ) : (
            <>
              <NewsGrid
                locale={locale}
                items={news.items}
                label={t('centre.news')}
                showType={false}
                headingLevel="h3"
              />
              <MoreLink href={globalPaths.centreNews(locale, centre.slug)}>
                {t('centre.allNews')}
              </MoreLink>
            </>
          )}
        </section>

        <section className="flex flex-col gap-5" aria-labelledby="centre-events">
          <SectionHeader id="centre-events" heading={t('centre.events')} />
          {events === null ? (
            <Alert tone="info">{t('centre.eventsUnavailable')}</Alert>
          ) : events.items.length === 0 ? (
            <EmptyState>{t('centre.eventsEmpty')}</EmptyState>
          ) : (
            <EventGrid
              locale={locale}
              items={events.items}
              when="upcoming"
              label={t('centre.events')}
              headingLevel="h3"
            />
          )}
          <MoreLink href={globalPaths.centreEvents(locale, centre.slug)}>
            {t('centre.allEvents')}
          </MoreLink>
        </section>
      </DirectoryBody>

      <BreadcrumbData
        contentLocales={placeLocales(centre)}
        trail={[
          { name: trail.shellHome, path: `/${trail.nameLocale}` },
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
function CentreSubpageHero({
  eyebrow,
  title,
  lede,
  back,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly back: { readonly href: string; readonly text: string };
}) {
  return (
    <PageHero
      eyebrow={eyebrow}
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
 * /global/centres/{slug}/news
 * ========================================================================= */

export async function CentreNewsPage({
  locale,
  centre,
  query,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const news = await getTranslations({ locale, namespace: 'news' });
  const trail = await centreTrail(locale, centre);
  const offset = readOffsetOf(query, 'offset');
  const page = await centreNews(centre.id, offset, NEWS_PAGE);
  const path = globalPaths.centreNews(locale, centre.slug);
  const title = t('centreNews.title', { centre: trail.name });

  return (
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          ...trail.base,
          { href: globalPaths.centre(locale, centre.slug), text: trail.name },
          { text: t('centre.news') },
        ]}
      />
      <CentreSubpageHero
        eyebrow={t('centre.eyebrow')}
        title={title}
        lede={t('centreNews.intro')}
        back={{
          href: globalPaths.centre(locale, centre.slug),
          text: t('centreNews.back', { centre: trail.name }),
        }}
      />
      <DirectoryBody>
        <div className="flex flex-col gap-6">
          {page === null ? (
            <Alert tone="info">{t('centre.newsUnavailable')}</Alert>
          ) : page.items.length === 0 ? (
            <EmptyState>{offset > 0 ? t('pageEmpty') : t('centre.newsEmpty')}</EmptyState>
          ) : (
            <NewsGrid locale={locale} items={page.items} label={title} showType={false} />
          )}
          {page === null ? null : (
            <Pagination
              label={title}
              previous={
                offset > 0
                  ? withQuery(path, { offset: Math.max(0, offset - NEWS_PAGE) })
                  : null
              }
              next={page.more ? withQuery(path, { offset: offset + NEWS_PAGE }) : null}
              previousLabel={news('previous')}
              nextLabel={news('next')}
            />
          )}
        </div>
      </DirectoryBody>
    </>
  );
}

/* ===========================================================================
 * /global/centres/{slug}/events
 * ========================================================================= */

/**
 * A Centre's Events — Local Events (INFORMATION_ARCHITECTURE.md §3.9) —
 * upcoming by default, `?when=past` for those held, a page at a time. Global
 * resolves the Centre; Editorial lists the published Events naming it. Not
 * public when the Centre is not, whatever its Events' own state.
 */
export async function CentreEventsPage({
  locale,
  centre,
  query,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const events = await getTranslations({ locale, namespace: 'events' });
  const trail = await centreTrail(locale, centre);
  const when: EventWhen = query['when'] === 'past' ? 'past' : 'upcoming';
  const offset = readOffsetOf(query, 'offset');
  const page = await centreEvents(centre.id, when, offset, EVENT_PAGE);
  const path = globalPaths.centreEvents(locale, centre.slug);
  const title = t('centreEvents.title', { centre: trail.name });
  const at = (target: EventWhen, to: number) =>
    withQuery(path, { when: target === 'past' ? 'past' : null, offset: to });

  return (
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          ...trail.base,
          { href: globalPaths.centre(locale, centre.slug), text: trail.name },
          { text: t('centre.events') },
        ]}
      />
      <CentreSubpageHero
        eyebrow={t('centre.eyebrow')}
        title={title}
        lede={t('centreEvents.intro')}
        back={{
          href: globalPaths.centre(locale, centre.slug),
          text: t('centreNews.back', { centre: trail.name }),
        }}
      />
      <DirectoryBody>
        <div className="flex flex-col gap-6">
          <WhenLinks current={when} path={(target) => at(target, 0)} t={events} />
          {page === null ? (
            <Alert tone="info">{t('centre.eventsUnavailable')}</Alert>
          ) : page.items.length === 0 ? (
            <EmptyState>
              {offset > 0 ? t('pageEmpty') : events(`centreNone.${when}`)}
            </EmptyState>
          ) : (
            <EventGrid locale={locale} items={page.items} when={when} label={title} />
          )}
          {page === null ? null : (
            <Pagination
              label={title}
              previous={offset > 0 ? at(when, Math.max(0, offset - EVENT_PAGE)) : null}
              next={page.more ? at(when, offset + EVENT_PAGE) : null}
              previousLabel={events('previous')}
              nextLabel={events('next')}
            />
          )}
        </div>
      </DirectoryBody>
    </>
  );
}

/* ===========================================================================
 * /global/centres/{slug}/contact
 * ========================================================================= */

export async function CentreContactPage({
  locale,
  centre,
}: {
  readonly locale: Locale;
  readonly centre: PublicCentre;
}) {
  const t = await getTranslations({ locale, namespace: 'global' });
  const trail = await centreTrail(locale, centre);
  const words = centreWords(centre, locale);
  const title = t('contact.title', { centre: trail.name });

  return (
    <>
      <DirectoryCrumbs
        label={trail.label}
        trail={[
          ...trail.base,
          { href: globalPaths.centre(locale, centre.slug), text: trail.name },
          { text: t('centre.contacts') },
        ]}
      />
      <CentreSubpageHero
        eyebrow={t('centre.eyebrow')}
        title={title}
        lede={t('contact.notice')}
        back={{
          href: globalPaths.centre(locale, centre.slug),
          text: t('centreNews.back', { centre: trail.name }),
        }}
      />
      <DirectoryBody>
        <div className="flex flex-col gap-6">
          {centre.contacts.length === 0 ? (
            <EmptyState>{t('contact.empty')}</EmptyState>
          ) : (
            <Panel as="div">
              <ContactList contacts={centre.contacts} t={t} />
            </Panel>
          )}
          {words?.address == null ? null : (
            <FactCard id="contact-address" heading={t('centre.address')}>
              <address
                className="whitespace-pre-line not-italic wrap-anywhere"
                lang={words.locale}
                dir={directionOf(words.locale)}
              >
                {words.address}
              </address>
            </FactCard>
          )}
          <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
            <TextLink href={`/${locale}/contact`}>{t('contact.general')}</TextLink>
          </p>
        </div>
      </DirectoryBody>
    </>
  );
}
