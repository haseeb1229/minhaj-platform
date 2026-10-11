import 'server-only';

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  EVENT_GEOGRAPHY_CENTRES,
  EVENT_PAGE,
  eventGalleryPathOf,
  eventPathOf,
  eventTiming,
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
  eventsPath,
  leadingOccurrence,
  occurrenceWords,
  readEventQuery,
  type EventQuery,
} from '@/components/editorial/event-presentation';
import { translationFor } from '@/components/editorial/presentation';
import { placeName } from '@/components/global/presentation';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import { GalleryCardGrid } from '@/components/media/photos';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  Prose,
  Select,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';

/**
 * The public Event surfaces — `/events`, an Event, its gallery view and the
 * topic hub's Events (ROUTE_MAP.md §3.9). Phase 14.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through the
 * public composition roots of Editorial, Global, Media, People and Taxonomy —
 * no session, no identity service, no cookie — so a signed-in visitor and an
 * anonymous one receive the same page (ARCHITECTURE.md §8.1).
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
 * public Centre — and what it is about.
 *
 * TIME IS THE SERVER'S. Upcoming, ongoing and past are decided by the server's
 * clock on each request (the pages are dynamic), never a visitor's.
 */

type EventsTranslator = Awaited<ReturnType<typeof getTranslations<'events'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;
type Query = Record<string, string | string[] | undefined>;

/** Reads one published Event once per request, for metadata and body alike. */
export const readEvent = cache((slug: string) => editorialReadRuntime().event(slug));

async function eventsTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'events' });
  return {
    label: shell('nav.breadcrumbs'),
    homeText: shell('nav.home'),
    home: { href: `/${locale}`, text: shell('nav.home') },
    events: { href: `/${locale}/events`, text: t('title') },
  };
}

/**
 * The public Centres among these identifiers, or `null` when Global could not
 * be asked — so a card or a page can tell "not public" from "not known now".
 */
async function centresFor(
  ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, PublicCentreSummary> | null> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  try {
    const found = await globalReadRuntime().centreSummaries(wanted);
    return new Map(found.map((centre) => [centre.id, centre]));
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

function namesFor(items: readonly EventSummary[], locale: Locale): Promise<Names> {
  return referenceNames(
    { personIds: [], topicIds: items.flatMap((i) => i.topicIds) },
    locale,
  );
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

/** A Centre's name as a link to its page. */
function CentreName({
  centre,
  locale,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
}) {
  const words = labelFor(centre, locale);
  return (
    <TextLink href={globalPaths.centre(locale, centre.slug)}>
      <span
        lang={words?.locale ?? centre.primaryLocale}
        dir={directionOf(words?.locale ?? centre.primaryLocale)}
      >
        {words?.name ?? centre.slug}
      </span>
    </TextLink>
  );
}

/** "Happening now", in words and never by colour alone. */
function NowLabel({ t }: { readonly t: EventsTranslator }) {
  return (
    <span className="rounded-[var(--radius-control)] border border-[color:var(--color-action)] px-2 py-0.5 text-xs font-semibold text-[color:var(--color-action)]">
      {t('now')}
    </span>
  );
}

/* ===========================================================================
 * Cards
 * ========================================================================= */

/**
 * ONE CARD. The title in its own language and direction; the occurrence that
 * matters for this view — the next one ahead, or the last one held — in its
 * intended local time and zone; how many other dates it has; where it is held
 * when its Centre is public; its own summary and its topics. No picture.
 */
function EventCard({
  locale,
  item,
  when,
  now,
  centre,
  names,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly item: EventSummary;
  readonly when: EventWhen;
  readonly now: Date;
  readonly centre: PublicCentreSummary | null;
  readonly names: Names;
  readonly t: EventsTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const translation = translationFor(item, locale);
  const direction = directionOf(translation.languageCode);
  const Heading = headingLevel;
  const occurrences = item.schedule.occurrences;
  const lead = leadingOccurrence(occurrences, when, now);
  const words =
    lead === undefined ? null : occurrenceWords(lead, item.schedule.timezone, locale);
  const ongoing = eventTiming(occurrences, now) === 'ongoing';
  const topics = item.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  return (
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-3">
        {words === null ? null : (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {ongoing ? <NowLabel t={t} /> : null}
            <time dateTime={words.start} className="font-medium">
              {words.text}
            </time>
            <span className="text-[color:var(--color-foreground-muted)]">
              {words.zoneName}
            </span>
          </p>
        )}
        <Heading
          className="text-lg leading-snug font-semibold break-words"
          lang={translation.languageCode}
          dir={direction}
        >
          <TextLink href={`/${locale}${eventPathOf(item.slug)}`}>
            {translation.title}
          </TextLink>
        </Heading>
        {occurrences.length > 1 ? (
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('moreDates', { count: occurrences.length - 1 })}
          </p>
        ) : null}
        {centre === null ? null : (
          <p className="text-sm break-words">
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
            className="line-clamp-3 text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={translation.languageCode}
            dir={direction}
          >
            {translation.excerpt}
          </p>
        )}
        {topics.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label={t('topics')}>
            {topics.map((topic) => (
              <li key={topic.slug}>
                <a
                  href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                  className="inline-flex min-h-8 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-2 text-xs"
                >
                  {topic.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </Panel>
  );
}

/**
 * A grid of cards with their topic names and Centres resolved once — two
 * owner calls per page, never one per card. Also composed by a Centre page and
 * the topic hub.
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
  const t = await getTranslations({ locale, namespace: 'events' });
  const [names, centres] = await Promise.all([
    namesFor(items, locale),
    centresFor(items.map((item) => item.centreId)),
  ]);
  const now = new Date();
  return (
    <>
      {centres === null ? <Alert tone="info">{t('centresUnavailable')}</Alert> : null}
      <ul className="grid gap-4 sm:grid-cols-2" aria-label={label}>
        {items.map((item) => (
          <EventCard
            key={item.slug}
            locale={locale}
            item={item}
            when={when}
            now={now}
            centre={item.centreId === null ? null : (centres?.get(item.centreId) ?? null)}
            names={names}
            t={t}
            headingLevel={headingLevel}
          />
        ))}
      </ul>
    </>
  );
}

/** Upcoming and past, as two views of the same listing. */
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
      <ul className="flex flex-wrap gap-2">
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
async function geographyOf(query: EventQuery): Promise<Geography> {
  if (query.invalid) return { status: 'invalid' };
  if (query.country === null && query.centre === null) return { status: 'all' };
  try {
    const read = globalReadRuntime();
    let ids: readonly string[] | null = null;
    if (query.country !== null) {
      const scope = await read.scope({
        country: query.country,
        region: null,
        city: query.city,
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
    if (query.centre !== null) {
      centre = await read.centre(query.centre);
      if (centre === null) return { status: 'invalid' };
      const only = centre.id;
      ids = ids === null ? [only] : ids.filter((id) => id === only);
    }
    return { status: 'narrowed', centreIds: ids ?? [], centre };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * `/events` — upcoming Events by default, soonest first, with any happening now
 * at the front; `?when=past` for those that have ended, latest first; and
 * `?country=`, `?city=` and `?centre=` narrowing by where they are held. Every
 * query is canonical to `/events` and none is a sitemap entry.
 */
export async function EventsPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'events' });
  const trail = await eventsTrail(locale);
  const filter = readEventQuery(query);
  const read = globalReadRuntime();
  const [geography, countries, inventory] = await Promise.all([
    geographyOf(filter),
    read.countryChoices().catch(() => null),
    editorialReadRuntime().hasPublishedEvents(),
  ]);
  const country =
    filter.country === null || countries === null
      ? null
      : (countries.find((entry) => entry.slug === filter.country) ?? null);
  const cities =
    country === null ? [] : await read.cityChoices(country.id).catch(() => []);
  const page =
    geography.status === 'all' || geography.status === 'narrowed'
      ? await editorialReadRuntime().events({
          when: filter.when,
          offset: filter.offset,
          centreIds: geography.status === 'narrowed' ? geography.centreIds : null,
        })
      : null;
  const narrowed = filter.country !== null || filter.centre !== null;
  const title = t('title');
  const path = (offset: number) => eventsPath(locale, filter, offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('description')}</p>
        </Prose>
        <WhenLinks
          current={filter.invalid ? null : filter.when}
          path={(when) => eventsPath(locale, { ...filter, when })}
          t={t}
        />

        <Panel>
          <form
            method="get"
            action={`/${locale}/events`}
            className="flex flex-col gap-4"
            aria-label={t('filters.label')}
          >
            {filter.when === 'past' ? (
              <input type="hidden" name="when" value="past" />
            ) : null}
            {filter.centre !== null ? (
              <input type="hidden" name="centre" value={filter.centre} />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="events-country"
                label={t('filters.country')}
                {...(countries === null ? { help: t('filters.unavailable') } : {})}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="country"
                    defaultValue={filter.country ?? ''}
                    disabled={countries === null || countries.length === 0}
                  >
                    <option value="">{t('filters.anyCountry')}</option>
                    {(countries ?? []).map((entry) => {
                      const name = placeName(entry, locale);
                      return (
                        <option key={entry.id} value={entry.slug} lang={name.locale}>
                          {name.text}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
              <Field
                id="events-city"
                label={t('filters.city')}
                help={t(country === null ? 'filters.chooseCountry' : 'filters.cityHelp')}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="city"
                    defaultValue={filter.city ?? ''}
                    disabled={country === null || cities.length === 0}
                  >
                    <option value="">{t('filters.anyCity')}</option>
                    {cities.map((entry) => {
                      const name = placeName(entry, locale);
                      return (
                        <option key={entry.id} value={entry.slug} lang={name.locale}>
                          {name.text}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit">{t('filters.submit')}</Button>
              <TextLink
                href={eventsPath(locale, {
                  ...filter,
                  country: null,
                  city: null,
                  centre: null,
                })}
              >
                {t('filters.reset')}
              </TextLink>
            </div>
          </form>
          {geography.status === 'narrowed' && geography.centre !== null ? (
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>{t('filters.atCentre')}</span>
              <CentreName centre={geography.centre} locale={locale} />
              <TextLink href={eventsPath(locale, { ...filter, centre: null })}>
                {t('filters.clearCentre')}
              </TextLink>
            </p>
          ) : null}
        </Panel>

        <section className="flex flex-col gap-4" aria-labelledby="events-results">
          <h2 id="events-results" className="text-xl font-semibold">
            {t(`when.${filter.when}`)}
          </h2>
          {geography.status === 'invalid' ? (
            <Alert tone="warning">{t('filters.invalid')}</Alert>
          ) : geography.status === 'too-broad' ? (
            <Alert tone="warning">{t('filters.tooBroad')}</Alert>
          ) : geography.status === 'unavailable' ? (
            <Alert tone="info">{t('filters.geographyUnavailable')}</Alert>
          ) : page === null || page.items.length === 0 ? (
            <EmptyState>
              {!inventory ? (
                t('empty')
              ) : filter.offset > 0 ? (
                <span className="flex flex-col gap-2">
                  <span>{t('pageEmpty')}</span>
                  <TextLink href={path(0)}>{t('firstPage')}</TextLink>
                </span>
              ) : narrowed ? (
                t(`noMatch.${filter.when}`)
              ) : (
                t(`none.${filter.when}`)
              )}
            </EmptyState>
          ) : (
            <EventGrid
              locale={locale}
              items={page.items}
              when={filter.when}
              label={t(`when.${filter.when}`)}
              headingLevel="h3"
            />
          )}
          {page === null ? null : (
            <Pagination
              label={title}
              previous={
                filter.offset > 0 ? path(Math.max(0, filter.offset - EVENT_PAGE)) : null
              }
              next={page.more ? path(filter.offset + EVENT_PAGE) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
            />
          )}
        </section>
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

export async function EventDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PublicEvent;
}) {
  const t = await getTranslations({ locale, namespace: 'events' });
  const editorial = await getTranslations({ locale, namespace: 'editorial' });
  const trail = await eventsTrail(locale);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
  const [names, languages, centres, galleries] = await Promise.all([
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
  ]);
  const centre =
    record.centreId === null ? null : (centres?.get(record.centreId) ?? null);
  const centreWords = centre === null ? null : labelFor(centre, locale);
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

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.events, { text: translation.title }]}
        />

        <Prose>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-semibold tracking-wide text-[color:var(--color-action)] uppercase">
              {t('type')}
            </span>
            {timing === 'ongoing' ? (
              <NowLabel t={t} />
            ) : (
              <span className="text-sm text-[color:var(--color-foreground-muted)]">
                {t(`status.${timing}`)}
              </span>
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
            <h1 className="text-3xl leading-tight font-semibold tracking-tight break-words">
              {translation.title}
            </h1>
            {translation.excerpt === '' ? null : (
              <p className="text-lg text-[color:var(--color-foreground-muted)]">
                {translation.excerpt}
              </p>
            )}
          </div>
        </Prose>

        <section className="flex flex-col gap-3" aria-labelledby="event-when">
          <h2 id="event-when" className="text-xl font-semibold">
            {t('whenHeading')}
          </h2>
          <ol className="flex flex-col gap-2">
            {record.schedule.occurrences.map((occurrence) => {
              const words = occurrenceWords(occurrence, record.schedule.timezone, locale);
              const over =
                (occurrence.endsAt ?? occurrence.startsAt).getTime() < now.getTime();
              return (
                <li
                  key={words.start}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <time dateTime={words.start} className="font-medium">
                    {words.text}
                  </time>
                  <span className="text-sm text-[color:var(--color-foreground-muted)]">
                    {words.zoneName}
                  </span>
                  {over ? (
                    <span className="text-sm text-[color:var(--color-foreground-muted)]">
                      — {t('held')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('localTimeNote')}
          </p>
        </section>

        {record.centreId === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="event-where">
            <h2 id="event-where" className="text-xl font-semibold">
              {t('whereHeading')}
            </h2>
            {centres === null ? (
              <Alert tone="info">{t('centresUnavailable')}</Alert>
            ) : centre === null ? (
              <p className="text-sm">{t('centreWithdrawn')}</p>
            ) : (
              <dl className="grid gap-x-8 sm:grid-cols-2">
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
                {centre.isVirtual || centreWords?.address == null ? null : (
                  <DetailRow term={t('address')}>
                    <address
                      className="whitespace-pre-line not-italic wrap-anywhere"
                      lang={centreWords.locale}
                      dir={directionOf(centreWords.locale)}
                    >
                      {centreWords.address}
                    </address>
                  </DetailRow>
                )}
              </dl>
            )}
          </section>
        )}

        <Prose>
          <div
            className="editorial-prose"
            lang={translation.languageCode}
            dir={direction}
            dangerouslySetInnerHTML={{ __html: translation.html }}
          />
        </Prose>

        {record.galleryIds.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="event-photographs">
            <h2 id="event-photographs" className="text-xl font-semibold">
              {t('photographs')}
            </h2>
            {galleries === null ? (
              <Alert tone="info">{t('galleriesUnavailable')}</Alert>
            ) : galleries.length === 0 ? (
              <p className="text-sm">{t('galleriesWithdrawn')}</p>
            ) : (
              <p>
                <TextLink href={`/${locale}${eventGalleryPathOf(record.slug)}`}>
                  {t('viewPhotographs', { count: galleries.length })}
                </TextLink>
              </p>
            )}
          </section>
        )}

        {credits.length === 0 && topics.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="event-facts">
            <h2 id="event-facts" className="text-lg font-semibold">
              {t('facts')}
            </h2>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              {credits.length === 0 ? null : (
                <DetailRow term={t('contributors')}>
                  <ul className="flex flex-col gap-1">
                    {credits.map(({ person, role }) => (
                      <li key={`${person.slug}:${role}`} dir="auto">
                        <TextLink
                          href={`/${locale}/people/${encodeURIComponent(person.slug)}`}
                        >
                          {person.name}
                        </TextLink>{' '}
                        — {editorial(role as 'speaker')}
                      </li>
                    ))}
                  </ul>
                </DetailRow>
              )}
              {topics.length === 0 ? null : (
                <DetailRow term={t('topics')}>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {topics.map((topic) => (
                      <li key={topic.slug}>
                        <TextLink
                          href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                        >
                          {topic.name}
                        </TextLink>
                      </li>
                    ))}
                  </ul>
                </DetailRow>
              )}
            </dl>
          </section>
        )}

        <p>
          <TextLink href={`/${locale}/events`}>{t('all')}</TextLink>
        </p>

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            { name: trail.homeText, path: `/${translation.languageCode}` },
            { name: t('title'), path: `/${translation.languageCode}/events` },
            {
              name: translation.title,
              path: `/${translation.languageCode}${eventPathOf(record.slug)}`,
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
  const eventHref = `/${locale}${eventPathOf(record.slug)}`;
  const title = t('galleryTitle');

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[
            trail.home,
            trail.events,
            { href: eventHref, text: translation.title },
            { text: title },
          ]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p lang={translation.languageCode} dir={directionOf(translation.languageCode)}>
            {translation.title}
          </p>
          <p>{t('galleryIntro')}</p>
        </Prose>
        {galleries === null ? (
          <Alert tone="info">{t('galleriesUnavailable')}</Alert>
        ) : galleries.length === 0 ? (
          <EmptyState>{t('galleriesWithdrawn')}</EmptyState>
        ) : (
          <GalleryCardGrid locale={locale} galleries={galleries} label={title} />
        )}
        <p>
          <TextLink href={eventHref}>{t('backToEvent')}</TextLink>
        </p>
      </div>
    </Container>
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
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t(`when.${when}`)}
      </p>
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
