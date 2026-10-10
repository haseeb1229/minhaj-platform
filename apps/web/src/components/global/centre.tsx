import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { NEWS_PAGE, type NewsPage } from '@minhaj/contracts/editorial';
import {
  dialablePhone,
  globalPaths,
  type CentreContact,
  type PublicCentre,
  type PublicPlace,
} from '@minhaj/contracts/global';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { NewsGrid } from '@/components/editorial/news';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Prose,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
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
 *   `/global/centres/{slug}/contact`   its public directory contacts — display only
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. The Centre is Global's public read; its
 * News is Editorial's own bounded read by the Centre's identifier. Neither
 * context reads the other's tables, and a failure in Editorial's read degrades
 * the News section in words rather than taking the Centre page down.
 *
 * ONLY GENUINE FACTS. An address, coordinates, a description and contacts are
 * shown when the organisation supplied them and are simply absent otherwise:
 * no map, logo, photograph, opening hours or official status is invented, and
 * coordinates are shown as numbers, never plotted. No Events link exists: Events
 * are Phase 14's.
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
}: {
  readonly contacts: readonly CentreContact[];
  readonly t: GlobalTranslator;
}) {
  return (
    <dl className="grid gap-x-8 sm:grid-cols-2">
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
  const news = await centreNews(centre.id, 0, NEWS_PREVIEW);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs label={trail.label} trail={[...trail.base, { text: trail.name }]} />
        <Prose>
          <h1
            className="text-3xl font-semibold tracking-tight wrap-anywhere"
            lang={trail.nameLocale}
            dir={direction}
          >
            {trail.name}
          </h1>
          {centre.isVirtual ? (
            <p>
              <span className="font-semibold">{t('centre.virtual')}</span> —{' '}
              {t('centre.virtualBody')}
            </p>
          ) : null}
          {words?.description == null
            ? null
            : paragraphsOf(words.description).map((paragraph, index) => (
                <p key={index} lang={words.locale} dir={direction}>
                  {paragraph}
                </p>
              ))}
        </Prose>

        <section className="flex flex-col gap-3" aria-labelledby="centre-facts">
          <h2 id="centre-facts" className="text-xl font-semibold">
            {t('centre.facts')}
          </h2>
          <dl className="grid gap-x-8 sm:grid-cols-2">
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
        </section>

        {centre.servedCities.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="centre-served">
            <h2 id="centre-served" className="text-xl font-semibold">
              {t('centre.served')}
            </h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {centre.servedCities.map((city) => (
                <li key={city.id}>
                  <PlaceLink
                    place={city}
                    href={globalPaths.city(locale, centre.country.slug, city.slug)}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="centre-contacts">
          <h2 id="centre-contacts" className="text-xl font-semibold">
            {t('centre.contacts')}
          </h2>
          {centre.contacts.length === 0 ? (
            <EmptyState>{t('contact.empty')}</EmptyState>
          ) : (
            <ContactList contacts={centre.contacts} t={t} />
          )}
          <p>
            <TextLink href={globalPaths.centreContact(locale, centre.slug)}>
              {t('centre.contactPage')}
            </TextLink>
          </p>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="centre-news">
          <h2 id="centre-news" className="text-xl font-semibold">
            {t('centre.news')}
          </h2>
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
              <p>
                <TextLink href={globalPaths.centreNews(locale, centre.slug)}>
                  {t('centre.allNews')}
                </TextLink>
              </p>
            </>
          )}
        </section>

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
    </Container>
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
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[
            ...trail.base,
            { href: globalPaths.centre(locale, centre.slug), text: trail.name },
            { text: t('centre.news') },
          ]}
        />
        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere" dir="auto">
            {title}
          </h1>
          <p>{t('centreNews.intro')}</p>
        </Prose>
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
        <p>
          <TextLink href={globalPaths.centre(locale, centre.slug)}>
            {t('centreNews.back', { centre: trail.name })}
          </TextLink>
        </p>
      </div>
    </Container>
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
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[
            ...trail.base,
            { href: globalPaths.centre(locale, centre.slug), text: trail.name },
            { text: t('centre.contacts') },
          ]}
        />
        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight wrap-anywhere" dir="auto">
            {title}
          </h1>
          <p>{t('contact.notice')}</p>
        </Prose>
        {centre.contacts.length === 0 ? (
          <EmptyState>{t('contact.empty')}</EmptyState>
        ) : (
          <ContactList contacts={centre.contacts} t={t} />
        )}
        {words?.address == null ? null : (
          <section className="flex flex-col gap-2" aria-labelledby="contact-address">
            <h2 id="contact-address" className="text-xl font-semibold">
              {t('centre.address')}
            </h2>
            <address
              className="whitespace-pre-line not-italic wrap-anywhere"
              lang={words.locale}
              dir={directionOf(words.locale)}
            >
              {words.address}
            </address>
          </section>
        )}
        <p>
          <TextLink href={`/${locale}/contact`}>{t('contact.general')}</TextLink>
        </p>
      </div>
    </Container>
  );
}
