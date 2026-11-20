import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import {
  GLOBAL_PAGE,
  globalPaths,
  type PublicCentrePage,
  type PublicCentreSummary,
  type PublicCountryEntry,
  type PublicPlace,
} from '@minhaj/contracts/global';

import { RangeSummary } from '@/components/library/browse-parts';
import { ShareVideo } from '@/components/media/share';
import { pageCount, pageRange } from '@/components/topic-hub/address';
import {
  Breadcrumbs,
  CardGrid,
  Container,
  EmptyState,
  Icon,
  LinkCard,
  LinkTabs,
  Pager,
  SectionHeader,
  Stat,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { absoluteUrl } from '@/config/origin';
import { centreWords, placeName } from './presentation';
import { groupByWorldRegion } from './world-region';

/**
 * THE GLOBAL NETWORK'S SHARED FRAME (ROUTE_MAP.md §3.9; R2) — what every
 * directory page and every Centre page is built from, so a trail, a record's
 * opening, a Centre card, a page of results and a tile of places read the same
 * everywhere. PRESENTATION ONLY: nothing here reads Global or Editorial; each
 * page resolves its reads and passes plain values.
 *
 * NOTHING IS INVENTED. A figure is shown only where it is the published
 * records' own count; an empty directory says so; no map, flag wall, logo or
 * photograph stands in for data. A name carries the language it is genuinely
 * in (WCAG 3.1.2). LOGICAL PROPERTIES ONLY, so the same markup is right in
 * English, Urdu and Arabic; every link is a 44-pixel target.
 */

export type GlobalTranslator = Awaited<ReturnType<typeof getTranslations<'global'>>>;
export type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;

/** A whole number in the interface language's digits. */
export function numberIn(locale: Locale): (value: number) => string {
  const format = new Intl.NumberFormat(locale);
  return (value) => format.format(value);
}

/** Home / Global Network / … — the trail every directory page starts with. */
export async function globalTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'global' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    global: { href: globalPaths.home(locale), text: t('title') },
    countries: { href: globalPaths.countries(locale), text: t('sections.countries') },
    centres: { href: globalPaths.centres(locale), text: t('sections.centres') },
    shellHome: shell('nav.home'),
  };
}

/** The slim breadcrumb row above a directory page's opening band. */
export function DirectoryCrumbs({
  label,
  trail,
}: {
  readonly label: string;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
}) {
  return (
    <Container>
      <div className="pt-6">
        <Breadcrumbs label={label} trail={trail} />
      </div>
    </Container>
  );
}

/** A figure the records genuinely support: a count, its caption, where they are listed. */
export interface Figure {
  readonly value: string;
  readonly label: string;
  readonly href?: string;
}

/** A row of figures, or nothing when there is none to state. */
export function Figures({ figures }: { readonly figures: readonly Figure[] }) {
  if (figures.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4 pt-2">
      {figures.map((figure) => (
        <Stat
          key={figure.label}
          value={figure.value}
          label={figure.label}
          {...(figure.href === undefined ? {} : { href: figure.href })}
        />
      ))}
    </div>
  );
}

/**
 * The opening band of ONE record — a Country, a Region, a City or a Centre.
 *
 * Unlike `PageHero`, the `h1` carries the language and direction the record's
 * name is genuinely in, so an English place name on an Arabic page is marked
 * English (WCAG 3.1.2) without flipping the page around it. Its figures, its
 * actions and Share follow.
 */
export function RecordHeader({
  kind,
  where,
  name,
  nameLocale,
  figures = [],
  actions,
  children,
}: {
  /** What the record is ("Country", "Centre"), said after its name. */
  readonly kind: string;
  /** Where it sits in the world, when the page knows ("Europe & Central Asia"). */
  readonly where?: ReactNode;
  readonly name: string;
  readonly nameLocale: Locale;
  readonly figures?: readonly Figure[];
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="border-b border-border">
      <Container>
        <div className="flex max-w-3xl min-w-0 flex-col gap-3 py-[var(--space-section)]">
          <h1
            className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
            lang={nameLocale}
            dir={directionOf(nameLocale)}
          >
            {name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-foreground-muted">
            <Icon name="map-pin" size={16} className="text-accent" />
            <span>{kind}</span>
            {where === undefined ? null : (
              <>
                <span aria-hidden="true" className="text-border-strong">
                  ·
                </span>
                <span className="min-w-0 wrap-anywhere">{where}</span>
              </>
            )}
          </p>
          {children}
          <Figures figures={figures} />
          {actions === undefined ? null : (
            <div className="flex flex-wrap items-center gap-3 pt-1">{actions}</div>
          )}
        </div>
      </Container>
    </div>
  );
}

/** Share a directory page: the device's share sheet or the address copied. */
export async function ShareRecord({
  locale,
  path,
  title,
}: {
  readonly locale: Locale;
  readonly path: string;
  readonly title: string;
}) {
  const watch = await getTranslations({ locale, namespace: 'watch' });
  return (
    <ShareVideo
      url={absoluteUrl(path)}
      title={title}
      labels={{
        share: watch('share.action'),
        copied: watch('share.copied'),
        failed: watch('share.failed'),
      }}
    />
  );
}

/** A directory page's body, in the system's section rhythm. */
export function DirectoryBody({ children }: { readonly children: ReactNode }) {
  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-[var(--space-section)] py-[var(--space-section)]">
        {children}
      </div>
    </Container>
  );
}

/** A name in the language it is genuinely in. */
export function PlaceName({
  record,
  locale,
}: {
  readonly record: PublicPlace;
  readonly locale: Locale;
}) {
  const name = placeName(record, locale);
  return (
    <span lang={name.locale} dir={directionOf(name.locale)}>
      {name.text}
    </span>
  );
}

/** A directory section: its header (the `h2` it is labelled by) and its body. */
export function Section({
  id,
  heading,
  intro,
  action,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro?: string;
  readonly action?: { readonly href: string; readonly text: string };
  readonly children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby={id}>
      <SectionHeader
        id={id}
        heading={heading}
        {...(intro === undefined ? {} : { intro })}
        {...(action === undefined ? {} : { action })}
      />
      {children}
    </section>
  );
}

export type GlobalSection = 'finder' | 'countries' | 'centres' | 'pakistan';

/**
 * The Global sections as counted route tabs: the World Network, Find a Centre,
 * Countries and Centres with how many the directory holds, and the Pakistan
 * structure. Each tab is a page; the current one is marked `aria-current`.
 */
export function GlobalTabs({
  locale,
  current,
  countries,
  centres,
  t,
}: {
  readonly locale: Locale;
  readonly current: GlobalSection;
  readonly countries: number;
  readonly centres: number;
  readonly t: GlobalTranslator;
}) {
  const number = numberIn(locale);
  return (
    <LinkTabs
      label={t('sectionsLabel')}
      tabs={[
        { href: globalPaths.home(locale), text: t('sections.home'), current: false },
        {
          href: globalPaths.finder(locale),
          text: t('sections.finder'),
          current: current === 'finder',
        },
        {
          href: globalPaths.countries(locale),
          text: t('sections.countries'),
          current: current === 'countries',
          count: number(countries),
        },
        {
          href: globalPaths.centres(locale),
          text: t('sections.centres'),
          current: current === 'centres',
          count: number(centres),
        },
        {
          href: globalPaths.pakistan(locale),
          text: t('sections.pakistan'),
          current: current === 'pakistan',
        },
      ]}
    />
  );
}

/** Where a Centre is, in words: its City, its Region and its Country — or virtual. */
function Locality({
  centre,
  locale,
  t,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  const parts = [centre.city, centre.region, centre.country].filter(
    (part): part is PublicPlace => part !== null,
  );
  return (
    <p className="text-caption text-foreground-muted">
      {centre.isVirtual ? (
        <span className="font-semibold text-accent">{t('card.virtual')} · </span>
      ) : null}
      {parts.map((part, index) => (
        <span key={part.id}>
          {index > 0 ? ', ' : null}
          <PlaceName record={part} locale={locale} />
        </span>
      ))}
    </p>
  );
}

/**
 * One Centre as a whole-card link: its name, its own description where it has
 * one, and where it is — nothing it does not have.
 */
export function CentreCard({
  centre,
  locale,
  t,
}: {
  readonly centre: PublicCentreSummary;
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  const words = centreWords(centre, locale);
  const wordsLocale = words?.locale ?? centre.primaryLocale;
  return (
    <LinkCard
      href={globalPaths.centre(locale, centre.slug)}
      title={words?.name ?? centre.slug}
      {...(words?.description == null ? {} : { description: words.description })}
      lang={wordsLocale}
      dir={directionOf(wordsLocale)}
      meta={<Locality centre={centre} locale={locale} t={t} />}
    />
  );
}

/**
 * A page of Centres in the listing's standard: "Showing n–m of N", the cards
 * (grouped under their Country where `grouped`), numbered pages, and the two
 * honest states — a page past the end leads to the first; a view nothing
 * matches says `empty` and offers `emptyAction`.
 */
export function CentreResults({
  locale,
  page,
  current,
  href,
  label,
  empty,
  emptyAction,
  grouped = false,
  t,
  hub,
}: {
  readonly locale: Locale;
  readonly page: PublicCentrePage;
  /** The 1-based page shown. */
  readonly current: number;
  readonly href: (page: number) => string;
  /** The list's (and the pages') accessible name. */
  readonly label: string;
  readonly empty: string;
  readonly emptyAction?: { readonly href: string; readonly text: string };
  readonly grouped?: boolean;
  readonly t: GlobalTranslator;
  readonly hub: HubTranslator;
}) {
  const number = numberIn(locale);
  const range = pageRange(current, page.items.length, GLOBAL_PAGE);
  if (page.items.length === 0)
    return current > 1 && page.total > 0 ? (
      <EmptyState
        title={hub('common.pastEndTitle')}
        action={{ href: href(1), text: hub('common.firstPage') }}
      >
        {t('pageEmpty')}
      </EmptyState>
    ) : (
      <EmptyState
        icon="map-pin"
        {...(emptyAction === undefined ? {} : { action: emptyAction })}
      >
        {empty}
      </EmptyState>
    );

  const groups: {
    readonly country: PublicPlace;
    readonly items: PublicCentreSummary[];
  }[] = [];
  if (grouped)
    for (const centre of page.items) {
      const group = groups.find((entry) => entry.country.id === centre.country.id);
      if (group === undefined) groups.push({ country: centre.country, items: [centre] });
      else group.items.push(centre);
    }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {range === null ? null : (
        <RangeSummary>
          {t('results.centres', {
            from: number(range.from),
            to: number(range.to),
            total: page.total,
          })}
        </RangeSummary>
      )}
      {grouped ? (
        <div className="flex flex-col gap-8">
          {groups.map((group) => {
            const name = placeName(group.country, locale);
            return (
              <section
                key={group.country.id}
                aria-labelledby={`centres-in-${group.country.id}`}
                className="flex min-w-0 flex-col gap-3"
              >
                <h3
                  id={`centres-in-${group.country.id}`}
                  lang={name.locale}
                  dir={directionOf(name.locale)}
                  className="text-subheading font-semibold wrap-anywhere"
                >
                  <a
                    href={globalPaths.country(locale, group.country.slug)}
                    className="inline-flex min-h-11 items-center text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
                  >
                    {name.text}
                  </a>
                </h3>
                <CardGrid label={name.text}>
                  {group.items.map((centre) => (
                    <CentreCard key={centre.id} centre={centre} locale={locale} t={t} />
                  ))}
                </CardGrid>
              </section>
            );
          })}
        </div>
      ) : (
        <CardGrid label={label}>
          {page.items.map((centre) => (
            <CentreCard key={centre.id} centre={centre} locale={locale} t={t} />
          ))}
        </CardGrid>
      )}
      <Pager
        label={t('results.pages', { list: label })}
        previous={current > 1 ? href(current - 1) : null}
        next={page.hasMore ? href(current + 1) : null}
        previousLabel={t('previous')}
        nextLabel={t('next')}
        pages={{
          current,
          total: pageCount(page.total, GLOBAL_PAGE),
          href,
          label: (target) => hub('common.pageLabel', { page: target }),
          format: number,
        }}
      />
    </div>
  );
}

/** A few Centres under a heading, with the way to all of them. */
export function CentreShelf({
  id,
  heading,
  more,
  label,
  centres,
  locale,
  t,
}: {
  readonly id: string;
  readonly heading: ReactNode;
  readonly more: { readonly href: string; readonly text: string };
  readonly label: string;
  readonly centres: readonly PublicCentreSummary[];
  readonly locale: Locale;
  readonly t: GlobalTranslator;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby={id}>
      <SectionHeader id={id} heading={heading} action={more} />
      <CardGrid label={label} columns={2}>
        {centres.map((entry) => (
          <CentreCard key={entry.id} centre={entry} locale={locale} t={t} />
        ))}
      </CardGrid>
    </section>
  );
}

/**
 * Places as tiles — each a bordered 44-pixel target with its name and, where
 * the page could count them exactly, how many Centres it holds — or an honest
 * empty state. `list` is the compact column a Pakistan region card holds.
 */
export function PlaceTiles({
  places,
  href,
  label,
  empty,
  locale,
  counts = null,
  countText,
  variant = 'tiles',
}: {
  readonly places: readonly PublicPlace[];
  readonly href: (place: PublicPlace) => string;
  readonly label: string;
  readonly empty: string;
  readonly locale: Locale;
  /** Centres per place identifier; `null` when the page could not count exactly. */
  readonly counts?: ReadonlyMap<string, number> | null;
  /** "3 centres", in the interface language. */
  readonly countText?: (count: number) => string;
  readonly variant?: 'tiles' | 'list';
}) {
  if (places.length === 0) return <EmptyState>{empty}</EmptyState>;
  const count = (place: PublicPlace) => {
    const value = counts?.get(place.id);
    return value === undefined || value === 0 || countText === undefined ? null : (
      <span className="shrink-0 text-caption font-normal text-foreground-muted tabular-nums">
        {countText(value)}
      </span>
    );
  };

  return variant === 'list' ? (
    <ul aria-label={label} className="flex list-none flex-col p-0">
      {places.map((place) => (
        <li key={place.id} className="flex min-w-0 items-center justify-between gap-3">
          <a
            href={href(place)}
            className="inline-flex min-h-11 min-w-0 items-center text-sm font-medium wrap-anywhere text-action underline-offset-4 hover:underline active:text-action-hover"
          >
            <PlaceName record={place} locale={locale} />
          </a>
          {count(place)}
        </li>
      ))}
    </ul>
  ) : (
    <ul
      aria-label={label}
      className="grid list-none grid-cols-1 gap-2 p-0 *:min-w-0 min-[30rem]:grid-cols-2 lg:grid-cols-4"
    >
      {places.map((place) => (
        <li key={place.id}>
          <a
            href={href(place)}
            className="flex min-h-11 items-center justify-between gap-3 rounded-control border border-border bg-surface-raised px-4 py-2 text-sm font-medium wrap-anywhere text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface active:bg-accent-rule"
          >
            <span className="flex min-w-0 flex-col">
              <PlaceName record={place} locale={locale} />
              {count(place)}
            </span>
            <Icon name="chevron-end" size={16} className="shrink-0 text-accent" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Countries grouped by world region (R2): one block per region — its name and
 * how many Countries it holds — then the Countries as tiles, each with its
 * Centres counted. The regions and the counts are the published records'.
 */
export function CountriesByRegion({
  countries,
  locale,
  t,
  headingLevel = 'h3',
}: {
  readonly countries: readonly PublicCountryEntry[];
  readonly locale: Locale;
  readonly t: GlobalTranslator;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const counts = new Map(countries.map((country) => [country.id, country.centres]));
  return (
    <div className="flex flex-col gap-8">
      {groupByWorldRegion(countries).map(({ region, countries: members }) => {
        const id = `world-region-${region}`;
        return (
          <section key={region} aria-labelledby={id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Heading id={id} className="text-subheading font-semibold text-balance">
                {t(`regions.${region}`)}
              </Heading>
              <span className="text-sm text-foreground-muted tabular-nums">
                {t('regionCount', { count: members.length })}
              </span>
            </div>
            <PlaceTiles
              places={members}
              href={(country) => globalPaths.country(locale, country.slug)}
              label={t(`regions.${region}`)}
              empty={t('countriesEmpty')}
              locale={locale}
              counts={counts}
              countText={(count) => t('count.centres', { count })}
            />
          </section>
        );
      })}
    </div>
  );
}

/** A link that names where it goes, at the foot of a section. */
export function MoreLink({
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
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action underline-offset-4 hover:underline active:text-action-hover"
      >
        {children}
        <Icon name="arrow-end" size={16} />
      </a>
    </p>
  );
}
