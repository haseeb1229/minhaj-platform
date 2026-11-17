import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  EVENT_GEOGRAPHY_CENTRES,
  EVENT_LISTING_PAGE,
  EVENT_PREVIEW,
  eventGalleryPathOf,
  eventPathOf,
  eventTiming,
  type EventListingFacets,
  type EventOccurrence,
  type EventSummary,
  type EventWhen,
  type PublicEvent,
} from '@minhaj/contracts/editorial';
import {
  globalPaths,
  labelFor,
  type PublicCentreSummary,
  type PublicPlace,
} from '@minhaj/contracts/global';
import type { PublicGallery } from '@minhaj/contracts/media';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import { mediaReadRuntime } from '@/composition/media-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import {
  eventStructuredData,
  leadingOccurrence,
  monthOfLocal,
  occurrenceWords,
  type EventPeriod,
} from '@/components/editorial/event-presentation';
import { EventReaderTime } from '@/components/editorial/event-reader-time';
import {
  eventsFiltered,
  eventsHref,
  eventsListingHref,
  eventsPlaced,
  eventsReadQuery,
  eventsWhenHref,
  type EventView,
} from '@/components/editorial/event-view';
import { monthName, newsTrail, yearText } from '@/components/editorial/news';
import { translationFor } from '@/components/editorial/presentation';
import { placeName } from '@/components/global/presentation';
import {
  CARD_RAISED,
  CARD_SURFACE,
  CARD_TITLE_LINK,
  ListingIntro,
  RecordSection,
} from '@/components/editorial/frame';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { BreadcrumbData } from '@/components/media/parts';
import { GalleryCardGrid } from '@/components/media/photos';
import { ShareVideo } from '@/components/media/share';
import { caseless, pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  CountedSelect,
  ExploreFilters,
  ExploreHero,
} from '@/components/topic-hub/parts';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  LinkTabs,
  Panel,
  Pager,
  Prose,
  SectionHeader,
  Select,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * The public Event surfaces — `/events`, an Event, its gallery view and the
 * topic hub's Events (ROUTE_MAP.md §3.9). Phase 14; `/events` and an Event's
 * page rebuilt in News & Events Part 2.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through the
 * public composition roots of Editorial, Global, Media, People and Taxonomy —
 * no session, no identity service, no cookie — so a signed-in visitor and an
 * anonymous one receive the same page (ARCHITECTURE.md §8.1). The two client
 * islands (the reader's own time, Share) only add to the page after it has
 * hydrated and send nothing anywhere.
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. An Event names its Centre and Galleries by
 * identifier. What a visitor sees of a Centre is what Global says is public
 * NOW, and of a Gallery what Media says is listed now; a withdrawn Centre or
 * Gallery is simply not shown, and the Event stays Editorial's and stays
 * published. A failed Global or Media read degrades that part in words and
 * never takes the Event down or reveals anything unpublished.
 *
 * NOTHING INVENTED. No image, venue, organiser, price, booking, registration,
 * livestream or map: an Event says when it happens, where — only through a
 * public Centre — and what it is about. No third-party map is embedded; the
 * Centre's own page is where its place is shown.
 *
 * TIME IS THE SERVER'S. Upcoming, ongoing and past are decided by the server's
 * clock on each request (the pages are dynamic), never a visitor's. Times are
 * written as the editor stated them, in the Event's own zone and named with
 * it; the reader's own time is added beside them only in the browser.
 */

type EventsTranslator = Awaited<ReturnType<typeof getTranslations<'events'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

/** Reads one published Event once per request, for metadata and body alike. */
export const readEvent = cache((slug: string) => editorialReadRuntime().event(slug));

async function eventsTrail(locale: Locale) {
  const [shell, t, news] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'events' }),
    newsTrail(locale),
  ]);
  return {
    label: shell('nav.breadcrumbs'),
    homeText: shell('nav.home'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    news: news.news,
    events: { href: localizedPath(locale, '/events'), text: t('title') },
  };
}

/**
 * The public Centres among these identifiers, or `null` when Global could not
 * be asked — so a card or a page can tell "not public" from "not known now".
 * Global answers at most 200 identifiers a call, so a longer list is asked in
 * turns.
 */
async function centresFor(
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, PublicCentreSummary> | null> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  try {
    const found: PublicCentreSummary[] = [];
    for (let start = 0; start < wanted.length; start += 200)
      found.push(
        ...(await globalReadRuntime().centreSummaries(wanted.slice(start, start + 200))),
      );
    return new Map(found.map((centre) => [centre.id.toLowerCase(), centre]));
  } catch {
    // A public content route reaches no logger (it would pull the full server
    // environment into an anonymous page); Global's read path observes it.
    return null;
  }
}

/** The listed Galleries of an Event, or `null` when Media could not be asked. */
async function galleriesFor(
  ids: readonly string[],
): Promise<readonly PublicGallery[] | null> {
  if (ids.length === 0) return [];
  try {
    return await mediaReadRuntime().publicGalleries(ids);
  } catch {
    return null;
  }
}

/**
 * Which of these Galleries Media lists now, asked in bounded turns (Media
 * answers at most 50 a call) — or `null` when Media could not be asked.
 */
async function listedGalleryIds(
  ids: readonly string[],
): Promise<ReadonlySet<string> | null> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Set();
  try {
    const found: PublicGallery[] = [];
    for (let start = 0; start < wanted.length; start += 50)
      found.push(
        ...(await mediaReadRuntime().publicGalleries(wanted.slice(start, start + 50))),
      );
    return new Set(found.map((gallery) => gallery.id.toLowerCase()));
  } catch {
    return null;
  }
}

/** A place's name, marked with the language it is actually in. */
function PlaceName({
  place,
  locale,
}: {
  readonly place: PublicPlace;
  readonly locale: Locale;
}) {
  const name = placeName(place, locale);
  return (
    <span lang={name.locale} dir={directionOf(name.locale)}>
      {name.text}
    </span>
  );
}

/** Where a public Centre is, in words: its City or Region, then its Country. */
function CentreLocality({
  centre,
  locale,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
}) {
  const parts = [centre.city ?? centre.region, centre.country].filter(
    (part): part is PublicPlace => part !== null,
  );
  const separator = locale === 'en' ? ', ' : '، ';
  return (
    <>
      {parts.map((part, index) => (
        <span key={part.id}>
          {index === 0 ? null : separator}
          <PlaceName place={part} locale={locale} />
        </span>
      ))}
    </>
  );
}

/** A Centre's name, in its own language. */
function centreWords(centre: PublicCentreSummary, locale: Locale) {
  const words = labelFor(centre, locale);
  const language = words?.locale ?? centre.primaryLocale;
  return { text: words?.name ?? centre.slug, locale: language };
}

/** A Centre's name as a link to its page. */
function CentreName({
  centre,
  locale,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
}) {
  const words = centreWords(centre, locale);
  return (
    <TextLink href={globalPaths.centre(locale, centre.slug)}>
      <span lang={words.locale} dir={directionOf(words.locale)}>
        {words.text}
      </span>
    </TextLink>
  );
}

/** "Happening now", in words and never by colour alone. */
function NowLabel({ t }: { readonly t: EventsTranslator }) {
  return (
    <span className="inline-flex w-fit rounded-control border border-action px-2 py-0.5 text-xs font-semibold text-action">
      {t('now')}
    </span>
  );
}

/**
 * A calendar leaf: the month, the day and the weekday of an occurrence's
 * INTENDED LOCAL start, read straight from the wall-clock time the editor
 * stated (as `occurrenceWords` does), so it never shifts by a zone.
 *
 * DECORATIVE AND HIDDEN FROM ASSISTIVE TECHNOLOGY: the occurrence's `<time>`
 * beside it already says the same thing in full, and a screen reader hearing
 * "Jun 14 Sat" before every title would be noise.
 */
function DateLeaf({
  local,
  locale,
  size = 'card',
}: {
  readonly local: string;
  readonly locale: Locale;
  readonly size?: 'card' | 'row';
}) {
  const wall = new Date(`${local}:00.000Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(wall);
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-control border border-accent-rule bg-accent-surface text-center ${
        size === 'card' ? 'w-16 py-2' : 'w-14 py-1.5'
      }`}
    >
      <span className="text-caption font-semibold text-accent uppercase">
        {part({ month: 'short' })}
      </span>
      <span
        className={`leading-none font-semibold tabular-nums ${
          size === 'card' ? 'text-2xl' : 'text-xl'
        }`}
      >
        {part({ day: 'numeric' })}
      </span>
      <span className="text-caption text-foreground-muted">
        {part({ weekday: 'short' })}
      </span>
    </span>
  );
}

/** One occurrence in the reader's own zone, added in the browser only. */
function ReaderTime({
  occurrence,
  zone,
  locale,
  t,
}: {
  readonly occurrence: EventOccurrence;
  readonly zone: string;
  readonly locale: Locale;
  readonly t: EventsTranslator;
}) {
  return (
    <EventReaderTime
      startsAt={occurrence.startsAt.toISOString()}
      endsAt={occurrence.endsAt === null ? null : occurrence.endsAt.toISOString()}
      zone={zone}
      locale={locale}
      label={t('readerTime', { time: '{time}' })}
    />
  );
}

/* ===========================================================================
 * Cards
 * ========================================================================= */

/**
 * What a page of cards needs from other owners, asked ONCE for the whole page:
 * the Topics' names (Taxonomy), the public Centres (Global) and which of the
 * Events' Galleries are listed (Media). `null` for an owner that could not be
 * asked.
 */
interface CardContext {
  readonly t: EventsTranslator;
  readonly names: Names;
  readonly centres: ReadonlyMap<string, PublicCentreSummary> | null;
  readonly listed: ReadonlySet<string> | null;
  readonly now: Date;
}

async function cardContext(
  locale: Locale,
  items: readonly EventSummary[],
): Promise<CardContext> {
  const [t, names, centres, listed] = await Promise.all([
    getTranslations({ locale, namespace: 'events' }),
    referenceNames({ personIds: [], topicIds: items.flatMap((i) => i.topicIds) }, locale),
    centresFor(items.map((item) => item.centreId)),
    listedGalleryIds(items.flatMap((item) => item.galleryIds)),
  ]);
  return { t, names, centres, listed, now: new Date() };
}

/**
 * ONE CARD, DATE FIRST. A calendar leaf for the occurrence that matters for
 * this view — the next one ahead, or the last one held, within a chosen period
 * when there is one — then the title in its own language and direction, that
 * occurrence in its intended local time and zone (and, in the browser, the
 * reader's own), how many other dates it has, where it is held when its Centre
 * is public, its own summary, its topics, and its photographs while Media
 * lists any. No picture.
 *
 * The title is the card's one stretched link; the Centre, the photographs and
 * the topics sit above it as links of their own.
 */
function EventCard({
  locale,
  item,
  when,
  period,
  context,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly item: EventSummary;
  readonly when: EventWhen;
  readonly period: EventPeriod | null;
  readonly context: CardContext;
  readonly headingLevel: 'h2' | 'h3' | 'h4';
}) {
  const { t, names, now } = context;
  const translation = translationFor(item, locale);
  const direction = directionOf(translation.languageCode);
  const Heading = headingLevel;
  const occurrences = item.schedule.occurrences;
  const lead = leadingOccurrence(occurrences, when, now, period);
  const words =
    lead === undefined ? null : occurrenceWords(lead, item.schedule.timezone, locale);
  const ongoing = eventTiming(occurrences, now) === 'ongoing';
  const centre =
    item.centreId === null
      ? null
      : (context.centres?.get(item.centreId.toLowerCase()) ?? null);
  const photographs =
    context.listed !== null &&
    item.galleryIds.some((id) => context.listed?.has(id.toLowerCase()) === true);
  const topics = item.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  return (
    <li className={CARD_SURFACE}>
      <div className="flex min-w-0 flex-1 gap-4">
        {lead === undefined ? null : (
          <DateLeaf local={lead.startsLocal} locale={locale} />
        )}
        <article className="flex min-w-0 flex-1 flex-col gap-2.5">
          {ongoing ? <NowLabel t={t} /> : null}
          <Heading
            className="text-subheading leading-snug font-semibold text-balance wrap-anywhere"
            lang={translation.languageCode}
            dir={direction}
          >
            <a
              href={localizedPath(locale, eventPathOf(item.slug))}
              className={CARD_TITLE_LINK}
            >
              {translation.title}
            </a>
          </Heading>
          {words === null || lead === undefined ? null : (
            <p className="flex flex-col gap-0.5 text-sm">
              <time dateTime={words.start} className="font-medium">
                {words.text}
              </time>
              <span className="text-foreground-muted">{words.zoneName}</span>
              <ReaderTime
                occurrence={lead}
                zone={item.schedule.timezone}
                locale={locale}
                t={t}
              />
            </p>
          )}
          {occurrences.length > 1 ? (
            <p className="text-sm text-foreground-muted">
              {t('moreDates', { count: occurrences.length - 1 })}
            </p>
          ) : null}
          {centre === null ? null : (
            <p className={`${CARD_RAISED} text-sm wrap-anywhere`}>
              <CentreName centre={centre} locale={locale} />
              {centre.isVirtual ? (
                <> — {t('virtual')}</>
              ) : (
                <>
                  {' — '}
                  <CentreLocality centre={centre} locale={locale} />
                </>
              )}
            </p>
          )}
          {translation.excerpt === '' ? null : (
            <p
              className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
              lang={translation.languageCode}
              dir={direction}
            >
              {translation.excerpt}
            </p>
          )}
          {photographs ? (
            <p className={`${CARD_RAISED} text-sm`}>
              <TextLink href={localizedPath(locale, eventGalleryPathOf(item.slug))}>
                {t('cardPhotographs')}
              </TextLink>
            </p>
          ) : null}
          {topics.length === 0 ? null : (
            <div className={`${CARD_RAISED} mt-auto pt-1`}>
              <TopicChips
                label={t('topics')}
                topics={topics.map((topic) => ({
                  href: localizedPath(
                    locale,
                    `/topics/${encodeURIComponent(topic.slug)}`,
                  ),
                  text: topic.name,
                }))}
              />
            </div>
          )}
        </article>
      </div>
    </li>
  );
}

/** A list of cards over a context already resolved for the page. */
function EventList({
  locale,
  items,
  when,
  period,
  context,
  label,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly items: readonly EventSummary[];
  readonly when: EventWhen;
  readonly period: EventPeriod | null;
  readonly context: CardContext;
  readonly label: string;
  readonly headingLevel: 'h2' | 'h3' | 'h4';
}) {
  return (
    <ul
      className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2"
      aria-label={label}
    >
      {items.map((item) => (
        <EventCard
          key={item.slug}
          locale={locale}
          item={item}
          when={when}
          period={period}
          context={context}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  );
}

/**
 * A grid of cards with their topic names, Centres and Galleries resolved once
 * — three owner calls per page, never one per card. Also composed by the home
 * page, a Centre page, the topic hub and an Event's related events.
 */
export async function EventGrid({
  locale,
  items,
  when,
  label,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly items: readonly EventSummary[];
  readonly when: EventWhen;
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const context = await cardContext(locale, items);
  return (
    <>
      {context.centres === null ? (
        <Alert tone="info">{context.t('centresUnavailable')}</Alert>
      ) : null}
      <EventList
        locale={locale}
        items={items}
        when={when}
        period={null}
        context={context}
        label={label}
        headingLevel={headingLevel}
      />
    </>
  );
}

/** Upcoming and past, as two views of a Centre's Local Events. */
export function WhenLinks({
  current,
  path,
  t,
}: {
  readonly current: EventWhen | null;
  readonly path: (when: EventWhen) => string;
  readonly t: EventsTranslator;
}) {
  return (
    <nav aria-label={t('whenLabel')}>
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {(['upcoming', 'past'] as const).map((when) => (
          <li key={when}>
            <FilterLink href={path(when)} current={when === current}>
              {t(`when.${when}`)}
            </FilterLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ===========================================================================
 * /events
 * ========================================================================= */

type Geography =
  | { readonly status: 'all' }
  | { readonly status: 'invalid' | 'too-broad' | 'unavailable' }
  | {
      readonly status: 'narrowed';
      readonly centreIds: readonly string[];
      readonly centre: PublicCentreSummary | null;
    };

/**
 * The listing's geography, resolved by GLOBAL at Layer 4 into the identifiers
 * of public Centres physically there — the Event's own Centre is then matched
 * against them by Editorial. A filter that names nothing public is invalid; one
 * that resolves to more Centres than a page may carry is refused rather than
 * truncated; a Global failure is reported. None of them widens the result.
 */
async function geographyOf(view: EventView): Promise<Geography> {
  if (view.invalid) return { status: 'invalid' };
  if (view.country === null && view.centre === null) return { status: 'all' };
  try {
    const read = globalReadRuntime();
    let ids: readonly string[] | null = null;
    if (view.country !== null) {
      const scope = await read.scope({
        country: view.country,
        region: null,
        city: view.city,
        offset: 0,
      });
      if (scope === null || scope.countryId === null) return { status: 'invalid' };
      ids = await read.physicalCentreIds(
        { countryId: scope.countryId, cityId: scope.cityId },
        EVENT_GEOGRAPHY_CENTRES,
      );
      if (ids === null) return { status: 'too-broad' };
    }
    let centre: PublicCentreSummary | null = null;
    if (view.centre !== null) {
      centre = await read.centre(view.centre);
      if (centre === null) return { status: 'invalid' };
      const only = centre.id.toLowerCase();
      ids = ids === null ? [centre.id] : ids.filter((id) => id.toLowerCase() === only);
    }
    return { status: 'narrowed', centreIds: ids ?? [], centre };
  } catch {
    return { status: 'unavailable' };
  }
}

interface PlaceOption {
  readonly place: PublicPlace;
  /** `null` when the page could not count it. */
  readonly events: number | null;
}

/**
 * The place filter's choices. Global lists the public Countries (and the
 * chosen Country's Cities); Editorial's Centre facet says how many Events of
 * the view each Centre holds, and Global which of those Centres are public,
 * physical, and where — so a Country or City is offered with its count when
 * it holds some, and the chosen one is always offered. When the facet names
 * more Centres than one Global read answers, or Global cannot be asked, the
 * places are offered uncounted, never counted from a subset.
 */
async function placeChoices(
  view: EventView,
  facets: EventListingFacets | null,
): Promise<{
  readonly countries: readonly PlaceOption[] | null;
  readonly cities: readonly PlaceOption[];
  readonly countryChosen: PublicPlace | null;
}> {
  const read = globalReadRuntime();
  const [countries, centres] = await Promise.all([
    read.countryChoices().catch(() => null),
    facets === null || facets.centres.hasMore
      ? Promise.resolve(null)
      : centresFor(facets.centres.items.map((entry) => entry.id)),
  ]);
  if (countries === null) return { countries: null, cities: [], countryChosen: null };
  const chosen =
    view.country === null
      ? null
      : (countries.find((entry) => entry.slug === view.country) ?? null);
  const cities = chosen === null ? [] : await read.cityChoices(chosen.id).catch(() => []);
  const byCountry = new Map<string, number>();
  const byCity = new Map<string, number>();
  if (centres !== null && facets !== null)
    for (const entry of facets.centres.items) {
      const centre = centres.get(entry.id.toLowerCase());
      if (centre === undefined || centre.isVirtual) continue;
      const country = centre.country.id.toLowerCase();
      byCountry.set(country, (byCountry.get(country) ?? 0) + entry.events);
      if (centre.city !== null) {
        const city = centre.city.id.toLowerCase();
        byCity.set(city, (byCity.get(city) ?? 0) + entry.events);
      }
    }
  const counted = centres !== null;
  const options = (
    places: readonly PublicPlace[],
    counts: ReadonlyMap<string, number>,
    current: string | null,
  ): PlaceOption[] =>
    places.flatMap((place): PlaceOption[] => {
      const events = counts.get(place.id.toLowerCase()) ?? 0;
      if (!counted) return [{ place, events: null }];
      return events > 0 || place.slug === current ? [{ place, events }] : [];
    });
  return {
    countries: options(countries, byCountry, view.country),
    cities: options(cities, byCity, view.city),
    countryChosen: chosen,
  };
}

/** A month heading's words: "June 2027", in the interface language. */
function monthHeading(year: number, month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * A page's Events grouped by the calendar month of the occurrence each card
 * leads with, in the page's own order — the listing read like a calendar.
 */
function byMonth(
  items: readonly EventSummary[],
  when: EventWhen,
  now: Date,
  period: EventPeriod | null,
) {
  const groups: {
    readonly key: string;
    readonly year: number;
    readonly month: number;
    readonly items: EventSummary[];
  }[] = [];
  for (const item of items) {
    const lead = leadingOccurrence(item.schedule.occurrences, when, now, period);
    if (lead === undefined) continue;
    const { year, month } = monthOfLocal(lead.startsLocal);
    const key = `${String(year)}-${String(month).padStart(2, '0')}`;
    const group = groups.find((entry) => entry.key === key);
    if (group === undefined) groups.push({ key, year, month, items: [item] });
    else group.items.push(item);
  }
  return groups;
}

/**
 * `/events` — upcoming Events by default, soonest first, with any happening now
 * at the front; `?when=past` for those that have ended, latest first. Counted
 * tabs; a GET form of counted filters (Topic, year, month once a year is
 * chosen, Country, City); chips that each remove one filter; the range; the
 * page's Events grouped by month; numbered pages; and honest empty, refused,
 * no-results and past-the-end states (`./event-view` for the addresses).
 */
export async function EventsPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: EventView;
}) {
  const [t, hub, tw, nt, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'events' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'news' }),
    eventsTrail(locale),
  ]);
  const reads = editorialReadRuntime();
  const geography = await geographyOf(view);
  const listable = geography.status === 'all' || geography.status === 'narrowed';
  const read = eventsReadQuery(
    view,
    geography.status === 'narrowed' ? geography.centreIds : null,
  );
  const [page, facets, inventory] = await Promise.all([
    listable ? reads.eventListing(read) : Promise.resolve(null),
    listable ? reads.eventListingFacets(read) : Promise.resolve(null),
    reads.hasPublishedEvents(),
  ]);
  const [places, names] = await Promise.all([
    placeChoices(view, facets),
    referenceNames(
      {
        personIds: [],
        topicIds: [
          ...(facets?.topics.items.map((facet) => facet.id) ?? []),
          ...(view.topic === null ? [] : [view.topic]),
        ],
      },
      locale,
    ),
  ]);
  const topics = caseless(names.topics);
  const now = new Date();
  const period: EventPeriod | null =
    view.year === null ? null : { year: view.year, month: view.month };

  const title = t('title');
  const listId = 'events-results';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const href = (change: Partial<Omit<EventView, 'invalid'>>) =>
    eventsHref(locale, view, change);
  const option = (name: string, count: number) => hub('common.option', { name, count });
  const filtered = eventsFiltered(view);
  // Clearing the filters keeps the view: upcoming or past is not a narrowing.
  const base = eventsListingHref(locale, { when: view.when });
  const total = page?.total ?? 0;
  const range =
    page === null ? null : pageRange(view.page, page.items.length, EVENT_LISTING_PAGE);

  const topicOptions = (facets?.topics.items ?? []).flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [{ value: facet.id.toLowerCase(), name: topic.name, count: facet.events }];
  });
  const chosenTopic =
    view.topic === null ? null : (topics.get(view.topic.toLowerCase()) ?? null);
  const placeText = (entry: PlaceOption) => {
    const name = placeName(entry.place, locale).text;
    return entry.events === null ? name : option(name, entry.events);
  };
  const chosenCity =
    view.city === null
      ? null
      : (places.cities.find((entry) => entry.place.slug === view.city)?.place ?? null);
  const centreChosen = geography.status === 'narrowed' ? geography.centre : null;

  const chip = (key: string, text: string, removeHref: string) => ({
    key,
    text,
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });
  const active = view.invalid
    ? []
    : [
        ...(view.topic === null
          ? []
          : [
              chip(
                'topic',
                chosenTopic?.name ?? tw('unknownTopic'),
                href({ topic: null }),
              ),
            ]),
        ...(view.year === null
          ? []
          : [
              chip(
                'year',
                yearText(view.year, locale),
                href({ year: null, month: null }),
              ),
            ]),
        ...(view.year === null || view.month === null
          ? []
          : [chip('month', monthName(view.month, locale), href({ month: null }))]),
        ...(view.country === null
          ? []
          : [
              chip(
                'country',
                places.countryChosen === null
                  ? view.country
                  : placeName(places.countryChosen, locale).text,
                href({ country: null, city: null }),
              ),
            ]),
        ...(view.city === null
          ? []
          : [
              chip(
                'city',
                chosenCity === null ? view.city : placeName(chosenCity, locale).text,
                href({ city: null }),
              ),
            ]),
        ...(view.centre === null
          ? []
          : [
              chip(
                'centre',
                t('heldAt', {
                  centre:
                    centreChosen === null
                      ? view.centre
                      : centreWords(centreChosen, locale).text,
                }),
                href({ centre: null }),
              ),
            ]),
      ];

  const countryCount = new Set(
    (places.countries ?? []).filter((entry) => (entry.events ?? 0) > 0),
  ).size;
  const stats =
    facets === null
      ? []
      : [
          {
            value: number(facets.when.upcoming),
            label: t('listing.stats.upcoming', { count: facets.when.upcoming }),
          },
          {
            value: number(facets.when.past),
            label: t('listing.stats.past', { count: facets.when.past }),
          },
          ...(countryCount === 0
            ? []
            : [
                {
                  value: number(countryCount),
                  label: t('listing.stats.countries', { count: countryCount }),
                },
              ]),
        ];

  const context = page === null ? null : await cardContext(locale, page.items);
  const groups = page === null ? [] : byMonth(page.items, view.when, now, period);
  const heading = t(`when.${view.when}`);

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.news, { text: title }]}
        />
        <ExploreHero
          eyebrow={trail.news.text}
          title={title}
          lede={t('description')}
          stats={stats}
          actions={[
            {
              href: pathFor(locale, requireRoute('find-a-centre')),
              text: t('findCentre'),
            },
            {
              href: pathFor(locale, requireRoute('media.galleries')),
              text: t('galleries'),
            },
          ]}
        />

        <LinkTabs
          label={t('whenLabel')}
          tabs={(['upcoming', 'past'] as const).map((when) => ({
            href: eventsWhenHref(locale, view, when),
            text: t(`when.${when}`),
            current: !view.invalid && when === view.when,
            ...(facets === null ? {} : { count: number(facets.when[when]) }),
          }))}
        />

        {!inventory ? (
          <EmptyState
            icon="calendar"
            title={t('listing.emptyTitle')}
            action={{ href: trail.news.href, text: nt('listing.backToNews') }}
          >
            {t('empty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-5">
            <SectionHeader id={listId} heading={heading} intro={t('listing.intro')} />

            <ExploreFilters
              action={localizedPath(locale, '/events')}
              label={t('filters.label')}
              hidden={[
                ...(view.when === 'past' ? [{ name: 'when', value: 'past' }] : []),
                ...(view.centre === null || view.invalid
                  ? []
                  : [{ name: 'centre', value: view.centre }]),
              ]}
              submit={t('filters.submit')}
              reset={
                filtered || view.invalid
                  ? { href: base, text: hub('common.reset') }
                  : null
              }
            >
              {topicOptions.length > 0 || view.topic !== null ? (
                <CountedSelect
                  id="events-topic"
                  label={tw('filterTopic')}
                  name="topic"
                  value={view.topic ?? ''}
                  any={tw('anyTopic')}
                  options={topicOptions}
                  optionText={option}
                />
              ) : null}
              {(facets?.years.length ?? 0) > 1 || view.year !== null ? (
                <CountedSelect
                  id="events-year"
                  label={nt('listing.filterYear')}
                  name="year"
                  value={view.year === null ? '' : String(view.year)}
                  any={nt('listing.anyYear')}
                  options={(facets?.years ?? []).map((entry) => ({
                    value: String(entry.year),
                    name: yearText(entry.year, locale),
                    count: entry.events,
                  }))}
                  optionText={option}
                />
              ) : null}
              {view.year === null ||
              ((facets?.months.length ?? 0) < 2 && view.month === null) ? null : (
                <CountedSelect
                  id="events-month"
                  label={nt('listing.filterMonth')}
                  name="month"
                  value={view.month === null ? '' : String(view.month)}
                  any={nt('listing.anyMonth')}
                  options={(facets?.months ?? []).map((entry) => ({
                    value: String(entry.month),
                    name: monthName(entry.month, locale),
                    count: entry.events,
                  }))}
                  optionText={option}
                />
              )}
              <Field
                id="events-country"
                label={t('filters.country')}
                {...(places.countries === null ? { help: t('filters.unavailable') } : {})}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="country"
                    defaultValue={view.country ?? ''}
                    disabled={places.countries === null || places.countries.length === 0}
                  >
                    <option value="">{t('filters.anyCountry')}</option>
                    {(places.countries ?? []).map((entry) => (
                      <option
                        key={entry.place.id}
                        value={entry.place.slug}
                        lang={placeName(entry.place, locale).locale}
                      >
                        {placeText(entry)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                id="events-city"
                label={t('filters.city')}
                help={t(
                  places.countryChosen === null
                    ? 'filters.chooseCountry'
                    : 'filters.cityHelp',
                )}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="city"
                    defaultValue={view.city ?? ''}
                    disabled={places.countryChosen === null || places.cities.length === 0}
                  >
                    <option value="">{t('filters.anyCity')}</option>
                    {places.cities.map((entry) => (
                      <option
                        key={entry.place.id}
                        value={entry.place.slug}
                        lang={placeName(entry.place, locale).locale}
                      >
                        {placeText(entry)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {chosenTopic === null ? null : (
              <p className="text-sm">
                <TextLink
                  href={localizedPath(
                    locale,
                    `/topics/${encodeURIComponent(chosenTopic.slug)}`,
                  )}
                >
                  {tw('topicHub')}
                </TextLink>
              </p>
            )}

            {geography.status === 'invalid' ? (
              <Alert tone="warning">{t('filters.invalid')}</Alert>
            ) : geography.status === 'too-broad' ? (
              <Alert tone="warning">{t('filters.tooBroad')}</Alert>
            ) : geography.status === 'unavailable' ? (
              <Alert tone="info">{t('filters.geographyUnavailable')}</Alert>
            ) : page === null || context === null ? null : page.items.length === 0 ? (
              view.page > 1 && total > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
                >
                  {t('listing.pastEnd', { page: view.page })}
                </EmptyState>
              ) : eventsPlaced(view) && view.topic === null && view.year === null ? (
                <EmptyState action={{ href: base, text: hub('common.reset') }}>
                  {t(`noMatch.${view.when}`)}
                </EmptyState>
              ) : filtered ? (
                <EmptyState
                  title={nt('listing.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('listing.noResults')}
                </EmptyState>
              ) : (
                <EmptyState
                  {...(view.when === 'upcoming' && (facets?.when.past ?? 0) > 0
                    ? {
                        action: {
                          href: eventsWhenHref(locale, view, 'past'),
                          text: t('when.past'),
                        },
                      }
                    : {})}
                >
                  {t(`none.${view.when}`)}
                </EmptyState>
              )
            ) : (
              <>
                {range === null ? null : (
                  <RangeSummary>
                    {t('listing.summary', {
                      from: number(range.from),
                      to: number(range.to),
                      total,
                    })}
                  </RangeSummary>
                )}
                {context.centres === null ? (
                  <Alert tone="info">{t('centresUnavailable')}</Alert>
                ) : null}
                <p className="text-sm text-foreground-muted">{t('localTimeNote')}</p>
                <div className="flex min-w-0 flex-col gap-8">
                  {groups.map((group) => {
                    const words = monthHeading(group.year, group.month, locale);
                    return (
                      <section
                        key={group.key}
                        aria-labelledby={`events-month-${group.key}`}
                        className="flex min-w-0 flex-col gap-3"
                      >
                        <h3
                          id={`events-month-${group.key}`}
                          className="flex flex-wrap items-baseline gap-x-3 border-b border-border pb-2 text-subheading font-semibold"
                        >
                          <span>{words}</span>
                          <span className="text-sm font-normal text-foreground-muted">
                            {t('listing.monthCount', { count: group.items.length })}
                          </span>
                        </h3>
                        <EventList
                          locale={locale}
                          items={group.items}
                          when={view.when}
                          period={period}
                          context={context}
                          label={words}
                          headingLevel="h4"
                        />
                      </section>
                    );
                  })}
                </div>
                <Pager
                  label={t('listing.pages')}
                  previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                  next={page.hasMore ? href({ page: view.page + 1 }) : null}
                  previousLabel={t('previous')}
                  nextLabel={t('next')}
                  pages={{
                    current: view.page,
                    total: pageCount(total, EVENT_LISTING_PAGE),
                    href: (target) => href({ page: target }),
                    label: (target) => hub('common.pageLabel', { page: target }),
                    format: number,
                  }}
                />
              </>
            )}
          </section>
        )}

        <ClosingNote
          text={t('listing.about')}
          links={[
            {
              href: pathFor(locale, requireRoute('global.centres')),
              text: t('listing.centres'),
            },
          ]}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /events/{slug}
 * ========================================================================= */

/** The locales the Event genuinely exists in — never widened by a fallback. */
export function eventLocales(record: PublicEvent): Locale[] {
  return record.translations.map((row) => row.languageCode);
}

/**
 * The Event's onward reading: more Events on its first Topic — upcoming ones
 * first, else the most recently held — or, with no Topic, the next upcoming
 * Events; never itself, at most three.
 */
async function relatedEvents(record: PublicEvent): Promise<{
  readonly topicId: string | null;
  readonly when: EventWhen;
  readonly items: readonly EventSummary[];
}> {
  const reads = editorialReadRuntime();
  const others = (items: readonly EventSummary[]) =>
    items.filter((item) => item.slug !== record.slug).slice(0, 3);
  const [topicId] = record.topicIds;
  if (topicId !== undefined) {
    const { when, page } = await reads.eventsOnTopic(topicId);
    const items = others(page.items);
    if (items.length > 0) return { topicId, when, items };
  }
  const page = await reads.eventListing({ when: 'upcoming', limit: EVENT_PREVIEW });
  return { topicId: null, when: 'upcoming', items: others(page.items) };
}

/**
 * An Event's page, WHEN AND WHERE FIRST: the header says what it is and
 * whether it is ahead, happening or held, with Share; directly beneath it,
 * side by side on a wide screen, every occurrence (in the browser, also in the
 * reader's own time) with the calendar file while one is still ahead, and the
 * public Centre it is held at; then the Event's own text at a reading measure,
 * its photographs, its speakers and topics, and more Events.
 */
export async function EventDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PublicEvent;
}) {
  const [t, editorial, watch, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'events' }),
    getTranslations({ locale, namespace: 'editorial' }),
    getTranslations({ locale, namespace: 'watch' }),
    eventsTrail(locale),
  ]);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
  const [names, languages, centres, galleries, related] = await Promise.all([
    referenceNames(
      {
        personIds: record.contributors.map((c) => c.personId),
        topicIds: record.topicIds,
      },
      locale,
    ),
    translation.languageCode === locale
      ? Promise.resolve(new Map<string, ContentLanguage>())
      : contentLanguages(),
    centresFor([record.centreId]),
    galleriesFor(record.galleryIds),
    relatedEvents(record),
  ]);
  const centre =
    record.centreId === null
      ? null
      : (centres?.get(record.centreId.toLowerCase()) ?? null);
  const centreLabel = centre === null ? null : labelFor(centre, locale);
  const now = new Date();
  const timing = eventTiming(record.schedule.occurrences, now);
  const credits = record.contributors.flatMap((credit) => {
    const person = names.people.get(credit.personId);
    return person === undefined ? [] : [{ person, role: credit.role }];
  });
  const topics = record.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const contentLocales = eventLocales(record);
  const structured = eventStructuredData(record, locale, centre);
  const address = localizedPath(locale, eventPathOf(record.slug));
  const relatedTopic =
    related.topicId === null ? null : (names.topics.get(related.topicId) ?? null);
  const relatedHeading =
    relatedTopic !== null
      ? t('detail.moreOnTopic', { topic: relatedTopic.name })
      : related.topicId === null
        ? t('detail.moreUpcoming')
        : t('detail.moreEvents');

  return (
    <Container>
      <article className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.news, trail.events, { text: translation.title }]}
        />

        <header className="flex max-w-3xl flex-col gap-4 border-b border-border pb-8">
          <p className="text-caption flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
              {t('type')}
            </span>
            {timing === 'ongoing' ? (
              <NowLabel t={t} />
            ) : (
              <span className="text-foreground-muted">{t(`status.${timing}`)}</span>
            )}
          </p>
          {translation.languageCode === locale ? null : (
            <Alert tone="info">
              {t('fallback', {
                language:
                  languages.get(translation.languageCode)?.name ??
                  translation.languageCode,
              })}
            </Alert>
          )}
          <div
            className="flex flex-col gap-4"
            lang={translation.languageCode}
            dir={direction}
          >
            <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
              {translation.title}
            </h1>
            {translation.excerpt === '' ? null : (
              <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
                {translation.excerpt}
              </p>
            )}
          </div>
          <ShareVideo
            url={absoluteUrl(address)}
            title={translation.title}
            labels={{
              share: watch('share.action'),
              copied: watch('share.copied'),
              failed: watch('share.failed'),
            }}
          />
        </header>

        <div className={`grid gap-6 ${record.centreId === null ? '' : 'md:grid-cols-2'}`}>
          <Panel as="div">
            <RecordSection id="event-when" heading={t('whenHeading')}>
              <ol className="flex list-none flex-col gap-4 p-0">
                {record.schedule.occurrences.map((occurrence) => {
                  const words = occurrenceWords(
                    occurrence,
                    record.schedule.timezone,
                    locale,
                  );
                  const over =
                    (occurrence.endsAt ?? occurrence.startsAt).getTime() < now.getTime();
                  return (
                    <li key={words.start} className="flex min-w-0 items-start gap-3">
                      <DateLeaf
                        local={occurrence.startsLocal}
                        locale={locale}
                        size="row"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <time dateTime={words.start} className="font-medium">
                          {words.text}
                        </time>
                        <span className="text-sm text-foreground-muted">
                          {words.zoneName}
                          {over ? <> — {t('held')}</> : null}
                        </span>
                        {over ? null : (
                          <ReaderTime
                            occurrence={occurrence}
                            zone={record.schedule.timezone}
                            locale={locale}
                            t={t}
                          />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="text-sm text-foreground-muted">{t('localTimeNote')}</p>
              {timing === 'past' ? null : (
                <p>
                  <ActionLink
                    href={localizedPath(locale, `${eventPathOf(record.slug)}/calendar`)}
                    tone="secondary"
                  >
                    {t('addToCalendar')}
                  </ActionLink>
                </p>
              )}
            </RecordSection>
          </Panel>

          {record.centreId === null ? null : (
            <Panel as="div">
              <RecordSection id="event-where" heading={t('whereHeading')}>
                {centres === null ? (
                  <Alert tone="info">{t('centresUnavailable')}</Alert>
                ) : centre === null ? (
                  <p className="text-sm">{t('centreWithdrawn')}</p>
                ) : (
                  <dl className="flex flex-col">
                    <DetailRow term={t('centre')}>
                      <CentreName centre={centre} locale={locale} />
                    </DetailRow>
                    {centre.isVirtual ? (
                      <DetailRow term={t('place')}>{t('virtual')}</DetailRow>
                    ) : (
                      <DetailRow term={t('place')}>
                        <CentreLocality centre={centre} locale={locale} />
                      </DetailRow>
                    )}
                    {centre.isVirtual || centreLabel?.address == null ? null : (
                      <DetailRow term={t('address')}>
                        <address
                          className="whitespace-pre-line not-italic wrap-anywhere"
                          lang={centreLabel.locale}
                          dir={directionOf(centreLabel.locale)}
                        >
                          {centreLabel.address}
                        </address>
                      </DetailRow>
                    )}
                  </dl>
                )}
              </RecordSection>
            </Panel>
          )}
        </div>

        <Prose>
          <div
            className="editorial-prose"
            lang={translation.languageCode}
            dir={direction}
            dangerouslySetInnerHTML={{ __html: translation.html }}
          />
        </Prose>

        {record.galleryIds.length === 0 ? null : (
          <RecordSection id="event-photographs" heading={t('photographs')}>
            {galleries === null ? (
              <Alert tone="info">{t('galleriesUnavailable')}</Alert>
            ) : galleries.length === 0 ? (
              <p className="text-sm">{t('galleriesWithdrawn')}</p>
            ) : (
              <p>
                <ActionLink
                  href={localizedPath(locale, eventGalleryPathOf(record.slug))}
                  tone="secondary"
                >
                  {t('viewPhotographs', { count: galleries.length })}
                </ActionLink>
              </p>
            )}
          </RecordSection>
        )}

        {credits.length === 0 && topics.length === 0 ? null : (
          <RecordSection id="event-facts" heading={t('facts')}>
            {credits.length === 0 ? null : (
              <dl className="flex flex-col">
                <DetailRow term={t('contributors')}>
                  <ul className="flex flex-col gap-1">
                    {credits.map(({ person, role }) => (
                      <li key={`${person.slug}:${role}`} dir="auto">
                        <TextLink
                          href={localizedPath(
                            locale,
                            `/people/${encodeURIComponent(person.slug)}`,
                          )}
                        >
                          {person.name}
                        </TextLink>{' '}
                        — {editorial(role as 'speaker')}
                      </li>
                    ))}
                  </ul>
                </DetailRow>
              </dl>
            )}
            {topics.length === 0 ? null : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-foreground-muted">{t('topics')}</p>
                <TopicChips
                  label={t('topics')}
                  topics={topics.map((topic) => ({
                    href: localizedPath(
                      locale,
                      `/topics/${encodeURIComponent(topic.slug)}`,
                    ),
                    text: topic.name,
                  }))}
                />
              </div>
            )}
          </RecordSection>
        )}

        {related.items.length === 0 ? null : (
          <section aria-labelledby="event-related" className="flex flex-col gap-5">
            <SectionHeader
              id="event-related"
              heading={relatedHeading}
              action={{
                href:
                  relatedTopic === null || related.topicId === null
                    ? localizedPath(locale, '/events')
                    : eventsListingHref(locale, {
                        when: related.when,
                        topic: related.topicId.toLowerCase(),
                      }),
                text:
                  relatedTopic === null
                    ? t('all')
                    : t('detail.allOnTopic', { topic: relatedTopic.name }),
              }}
            />
            <EventGrid
              locale={locale}
              items={related.items}
              when={related.when}
              label={relatedHeading}
              headingLevel="h3"
            />
          </section>
        )}

        {related.items.length > 0 && relatedTopic === null ? null : (
          <p>
            <ActionLink href={localizedPath(locale, '/events')} tone="secondary">
              {t('all')}
            </ActionLink>
          </p>
        )}

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            { name: trail.homeText, path: localizedPath(translation.languageCode, '') },
            {
              name: trail.news.text,
              path: localizedPath(translation.languageCode, '/news'),
            },
            {
              name: t('title'),
              path: localizedPath(translation.languageCode, '/events'),
            },
            {
              name: translation.title,
              path: localizedPath(translation.languageCode, eventPathOf(record.slug)),
            },
          ]}
        />
        {structured !== null && isContentIndexable({ contentLocales }) ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeStructuredData(structured) }}
          />
        ) : null}
      </article>
    </Container>
  );
}

/* ===========================================================================
 * /events/{slug}/gallery
 * ========================================================================= */

/**
 * An Event's photographs — a NAVIGATIONAL VIEW over the Media Galleries the
 * Event associates, never a second Gallery. Each Gallery keeps its one
 * canonical page at `/media/galleries/{slug}`, linked from its card; this page
 * is `noindex` and claims no canonical of its own over them. A Gallery Media no
 * longer lists is simply absent; with none left, the page says so.
 */
export async function EventGalleryPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PublicEvent;
}) {
  const t = await getTranslations({ locale, namespace: 'events' });
  const trail = await eventsTrail(locale);
  const translation = translationFor(record, locale);
  const galleries = await galleriesFor(record.galleryIds);
  const eventHref = localizedPath(locale, eventPathOf(record.slug));
  const title = t('galleryTitle');

  return (
    <>
      <ListingIntro
        trailLabel={trail.label}
        trail={[
          trail.home,
          trail.news,
          trail.events,
          { href: eventHref, text: translation.title },
          { text: title },
        ]}
        eyebrow={t('type')}
        title={title}
        lede={
          <span
            lang={translation.languageCode}
            dir={directionOf(translation.languageCode)}
          >
            {translation.title}
          </span>
        }
      />
      <Container>
        <div className="flex flex-col gap-6 py-[var(--space-page)]">
          <p className="max-w-[var(--measure-prose)] text-foreground-muted">
            {t('galleryIntro')}
          </p>
          {galleries === null ? (
            <Alert tone="info">{t('galleriesUnavailable')}</Alert>
          ) : galleries.length === 0 ? (
            <EmptyState>{t('galleriesWithdrawn')}</EmptyState>
          ) : (
            <GalleryCardGrid locale={locale} galleries={galleries} label={title} />
          )}
          <p>
            <ActionLink href={eventHref} tone="secondary">
              {t('backToEvent')}
            </ActionLink>
          </p>
        </div>
      </Container>
    </>
  );
}

/* ===========================================================================
 * The topic hub's Events section
 * ========================================================================= */

/**
 * PHASE 14 — the upcoming Events on a topic, soonest first, or the most recent
 * past ones when none is ahead, from Editorial's own public read and never from
 * the search index; nothing at all when the topic has no Event.
 */
export async function EventTopicSection({
  locale,
  topicId,
  heading,
  headingId,
}: {
  readonly locale: Locale;
  readonly topicId: string;
  readonly heading: string;
  readonly headingId: string;
}) {
  const { when, page } = await editorialReadRuntime().eventsOnTopic(topicId);
  if (page.items.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'events' });
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader id={headingId} heading={heading} intro={t(`when.${when}`)} />
      <EventGrid
        locale={locale}
        items={page.items}
        when={when}
        label={heading}
        headingLevel="h3"
      />
    </section>
  );
}
