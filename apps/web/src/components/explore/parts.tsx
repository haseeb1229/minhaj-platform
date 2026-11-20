import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { PublicPageSummary } from '@minhaj/contracts/editorial';

import { CardGrid, Icon, LinkCard, SectionHeader } from '@/components/ui';
import {
  EXPLORE_SECTIONS,
  exploreHrefOf,
  exploreSlugsOf,
  type ExploreSection,
} from '@/shell/explore';
import { pathFor, requireRoute, SHELL_ROUTES } from '@/shell/registry';

import { ExploreCard } from './cards';
import {
  channelsOf,
  explorePath,
  neighboursOf,
  onwardOf,
  publicationTally,
  sectionItems,
  type ExploreItem,
  type PublishedAddresses,
} from './explore-view';

/**
 * THE EXPLORE FAMILY'S SHARED PARTS (Explore, R2) — the section index, a
 * section's pages, the open ways onward, the official channels, and what
 * comes next in a section. PRESENTATION ONLY: every part is handed what the
 * page already read (the published Page addresses, or `null` when they could
 * not be read) and reads nothing itself.
 *
 * HONEST BY CONSTRUCTION. A status is said in words, never colour alone; a
 * page is "Published" only when its Page is; when the published Pages could
 * not be read no status and no count is claimed at all. Every link leads to a
 * route that answers: an Explore address from the allowlist, an owner's
 * delivered page, a delivered registry route, or — leaving the site, and said
 * so — one of the official channels the footer already lists. LOGICAL
 * PROPERTIES ONLY, so the same markup is right in English, Urdu and Arabic.
 */

export type ExploreTranslator = Awaited<ReturnType<typeof getTranslations<'explore'>>>;
type ShellTranslator = Awaited<ReturnType<typeof getTranslations<'shell'>>>;

/** A whole number in the interface language's digits. */
export function numberIn(locale: Locale): (value: number) => string {
  const format = new Intl.NumberFormat(locale);
  return (value) => format.format(value);
}

/** A section's title. */
export function sectionTitle(shell: ShellTranslator, section: ExploreSection): string {
  return shell(`explore.${section}.title` as 'explore.about.title');
}

/** A page's title. */
export function pageTitle(
  shell: ShellTranslator,
  section: ExploreSection,
  slug: string,
): string {
  return shell(`explore.${section}.pages.${slug}` as 'explore.about.pages.vision');
}

/** What a page will hold, in one sentence. */
export function pageWhat(
  t: ExploreTranslator,
  section: ExploreSection,
  slug: string,
): string {
  return t(`what.${section}.${slug}` as 'what.about.vision');
}

/** The status of an item, in words, or nothing when it is not known. */
export function statusOf(t: ExploreTranslator, item: ExploreItem): string | null {
  switch (item.state) {
    case 'published':
      return t('status.published');
    case 'elsewhere':
      return t('status.elsewhere');
    case 'awaiting':
      return item.kind === 'page' ? t('status.awaiting') : t('status.notOpen');
    default:
      return null;
  }
}

/** "3 of 8 published", or nothing when unknown or when the section has no pages. */
function tallyLine(
  t: ExploreTranslator,
  locale: Locale,
  items: readonly ExploreItem[],
): string | null {
  const tally = publicationTally(items);
  if (tally === null || tally.total === 0) return null;
  const number = numberIn(locale);
  return t('sectionTally', {
    published: number(tally.published),
    total: number(tally.total),
  });
}

/** A status in words, marked by an icon only for a published page. */
function StatusText({
  published,
  text,
}: {
  readonly published: boolean;
  readonly text: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-caption ${
        published ? 'font-semibold text-success' : 'text-foreground-muted'
      }`}
    >
      {published ? <Icon name="check" size={16} /> : null}
      {text}
    </span>
  );
}

/**
 * THE INDEX OF EVERY SECTION on `/explore` — one panel per section under a
 * real heading, its summary, how much of it is published, and every page it
 * reserves with that page's status. Built from the allowlists the routes
 * validate against, so a link here and a 404 there cannot disagree.
 */
export async function SectionIndex({
  locale,
  published,
}: {
  readonly locale: Locale;
  readonly published: PublishedAddresses;
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  return (
    <ul className="grid list-none grid-cols-1 gap-6 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
      {EXPLORE_SECTIONS.map((section) => {
        const items = sectionItems(section, published);
        const tally = tallyLine(t, locale, items);
        return (
          <li
            key={section}
            className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel sm:p-6"
          >
            <h3 className="text-heading font-semibold text-balance wrap-anywhere">
              <a
                href={localizedPath(locale, explorePath(section))}
                className="text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
              >
                {sectionTitle(shell, section)}
              </a>
            </h3>
            <p className="text-sm text-foreground-muted">
              {shell(`explore.${section}.summary` as 'explore.about.summary')}
            </p>
            {tally === null ? null : (
              <p className="text-caption font-semibold text-accent">{tally}</p>
            )}
            {items.length === 0 ? (
              <LandingOnly t={t} section={section} published={published} />
            ) : (
              <ul className="flex list-none flex-col border-t border-border p-0">
                {items.map((item) => {
                  const status = statusOf(t, item);
                  return (
                    <li
                      key={item.slug}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 border-b border-border py-1 last:border-b-0"
                    >
                      <a
                        href={exploreHrefOf(locale, section, item.slug)}
                        className="inline-flex min-h-10 min-w-0 items-center text-sm wrap-anywhere text-action underline-offset-4 hover:underline"
                      >
                        {pageTitle(shell, section, item.slug)}
                      </a>
                      {status === null ? null : (
                        <StatusText
                          published={item.state === 'published'}
                          text={status}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A landing-only section in the index (Leadership, Community): what its own
 * Page will hold, and whether that Page is published.
 */
function LandingOnly({
  t,
  section,
  published,
}: {
  readonly t: ExploreTranslator;
  readonly section: ExploreSection;
  readonly published: PublishedAddresses;
}) {
  const own = published === null ? null : published.has(explorePath(section));
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-sm">{t(`what.${section}` as 'what.community')}</p>
      {own === null ? null : (
        <StatusText
          published={own}
          text={own ? t('status.published') : t('status.awaiting')}
        />
      )}
    </div>
  );
}

/**
 * A SECTION'S PAGES on its landing: the published ones picture-led, with any
 * item an owner delivered elsewhere beside them; then every page still to be
 * published, each a card saying so and what it will hold.
 */
export async function SectionPages({
  locale,
  section,
  published,
  pages,
}: {
  readonly locale: Locale;
  readonly section: ExploreSection;
  readonly published: PublishedAddresses;
  /** The published Explore Pages, for their pictures, titles and excerpts. */
  readonly pages: readonly PublicPageSummary[];
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const items = sectionItems(section, published);
  const live = items.flatMap(
    (item): { item: ExploreItem; page: PublicPageSummary | null }[] => {
      if (item.state === 'elsewhere') return [{ item, page: null }];
      const page = pages.find(
        (entry) => entry.routeBinding === explorePath(section, item.slug),
      );
      return item.state === 'published' && page !== undefined ? [{ item, page }] : [];
    },
  );
  const waiting = items.filter(
    (item) => !live.some((entry) => entry.item.slug === item.slug),
  );

  return (
    <>
      {live.length === 0 ? null : (
        <section aria-labelledby="explore-published" className="flex flex-col gap-5">
          <SectionHeader id="explore-published" heading={t('section.published')} />
          <CardGrid label={t('section.published')}>
            {live.map(({ item, page }, index) =>
              page === null ? (
                <LinkCard
                  key={item.slug}
                  href={exploreHrefOf(locale, section, item.slug)}
                  eyebrow={t('status.elsewhere')}
                  title={pageTitle(shell, section, item.slug)}
                  description={pageWhat(t, section, item.slug)}
                />
              ) : (
                <ExploreCard
                  key={item.slug}
                  locale={locale}
                  page={page}
                  priority={index === 0}
                />
              ),
            )}
          </CardGrid>
        </section>
      )}

      {waiting.length === 0 ? null : (
        <section aria-labelledby="explore-awaiting" className="flex flex-col gap-5">
          <SectionHeader
            id="explore-awaiting"
            heading={published === null ? t('section.everyPage') : t('section.awaiting')}
            {...(published === null ? {} : { intro: t('section.awaitingIntro') })}
          />
          <CardGrid
            label={published === null ? t('section.everyPage') : t('section.awaiting')}
          >
            {waiting.map((item) => {
              const status = statusOf(t, item);
              return (
                <LinkCard
                  key={item.slug}
                  href={exploreHrefOf(locale, section, item.slug)}
                  {...(status === null ? {} : { eyebrow: status })}
                  title={pageTitle(shell, section, item.slug)}
                  description={pageWhat(t, section, item.slug)}
                />
              );
            })}
          </CardGrid>
        </section>
      )}
    </>
  );
}

/** The section a route key's path sits under, when it is not that section itself. */
function areaOf(shell: ShellTranslator, path: string): string | undefined {
  const first = `/${path.split('/')[1] ?? ''}`;
  if (first === path) return undefined;
  const area = SHELL_ROUTES.find(
    (route) => 'path' in route && route.path === first && route.key !== 'home',
  );
  return area === undefined ? undefined : shell(area.label as 'nav.home');
}

/**
 * WHERE TO FIND THIS NOW — the open parts of the platform that already serve
 * a reader of this section or page, each a delivered route.
 */
export async function OnwardLinks({
  locale,
  section,
  slug,
}: {
  readonly locale: Locale;
  readonly section: ExploreSection;
  readonly slug?: string;
}) {
  const keys = onwardOf(section, slug);
  if (keys.length === 0) return null;
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  return (
    <section aria-labelledby="explore-onward" className="flex min-w-0 flex-col gap-5">
      <SectionHeader
        id="explore-onward"
        heading={t('onward.heading')}
        intro={t('onward.intro')}
      />
      <CardGrid label={t('onward.heading')} columns={keys.length >= 4 ? 4 : 3}>
        {keys.map((key) => {
          const route = requireRoute(key);
          const area = areaOf(shell, route.path);
          return (
            <LinkCard
              key={key}
              href={pathFor(locale, route)}
              title={shell(route.label as 'nav.home')}
              {...(area === undefined ? {} : { eyebrow: area })}
            />
          );
        })}
      </CardGrid>
    </section>
  );
}

/**
 * THE ORGANISATION'S OFFICIAL CHANNELS this section or page names — plain
 * outbound links from the footer's evidenced list, never fetched, embedded or
 * tracked, and said to leave the site.
 */
export async function OfficialChannels({
  locale,
  section,
  slug,
}: {
  readonly locale: Locale;
  readonly section: ExploreSection;
  readonly slug?: string;
}) {
  const channels = channelsOf(section, slug);
  if (channels.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'explore' });
  return (
    <section
      aria-labelledby="explore-channels"
      className="flex max-w-3xl min-w-0 flex-col gap-3 rounded-panel bg-surface-sunken p-5 sm:p-6"
    >
      <h2 id="explore-channels" className="text-subheading font-semibold text-balance">
        {t('channels.heading')}
      </h2>
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('channels.intro')}
      </p>
      <ul className="flex list-none flex-wrap gap-3 p-0">
        {channels.map((channel) => (
          <li key={channel.id}>
            <a
              href={channel.href}
              rel="external noopener noreferrer"
              lang="en"
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-4 text-sm font-semibold text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface"
            >
              {channel.name}
              <Icon
                name="external"
                size={16}
                className="shrink-0 text-foreground-muted"
              />
            </a>
          </li>
        ))}
      </ul>
      <p className="text-caption text-foreground-muted">{t('channels.note')}</p>
    </section>
  );
}

/**
 * WHAT COMES NEXT IN A SECTION — every page of it with its status, the
 * current one marked, then the previous and next page in the section's own
 * order.
 */
export async function MoreInSection({
  locale,
  section,
  slug,
  published,
  back = true,
}: {
  readonly locale: Locale;
  readonly section: ExploreSection;
  readonly slug: string;
  readonly published: PublishedAddresses;
  /** Whether to lead back to the section — not where the page already does. */
  readonly back?: boolean;
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const name = sectionTitle(shell, section);
  const items = sectionItems(section, published);
  const { previous, next } = neighboursOf(section, slug);

  return (
    <div className="flex min-w-0 flex-col gap-8 border-t border-border pt-[var(--space-page)]">
      <section aria-labelledby="explore-more" className="flex min-w-0 flex-col gap-4">
        <SectionHeader
          id="explore-more"
          heading={t('more.heading', { section: name })}
          {...(back
            ? {
                action: {
                  href: localizedPath(locale, explorePath(section)),
                  text: t('back', { section: name }),
                },
              }
            : {})}
        />
        <ul className="grid list-none grid-cols-1 gap-x-8 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const status = statusOf(t, item);
            const current = item.slug === slug;
            return (
              <li
                key={item.slug}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 border-b border-border py-1"
              >
                {current ? (
                  <span
                    aria-current="page"
                    className="inline-flex min-h-10 min-w-0 items-center text-sm font-semibold wrap-anywhere"
                  >
                    {pageTitle(shell, section, item.slug)}
                  </span>
                ) : (
                  <a
                    href={exploreHrefOf(locale, section, item.slug)}
                    className="inline-flex min-h-10 min-w-0 items-center text-sm wrap-anywhere text-action underline-offset-4 hover:underline"
                  >
                    {pageTitle(shell, section, item.slug)}
                  </a>
                )}
                {status === null ? null : (
                  <StatusText published={item.state === 'published'} text={status} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {previous === null && next === null ? null : (
        <nav
          aria-label={t('more.label', { section: name })}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {previous === null ? (
            <span className="hidden sm:block" />
          ) : (
            <Neighbour
              href={exploreHrefOf(locale, section, previous)}
              direction="previous"
              label={t('more.previous')}
              title={pageTitle(shell, section, previous)}
            />
          )}
          {next === null ? null : (
            <Neighbour
              href={exploreHrefOf(locale, section, next)}
              direction="next"
              label={t('more.next')}
              title={pageTitle(shell, section, next)}
            />
          )}
        </nav>
      )}
    </div>
  );
}

function Neighbour({
  href,
  direction,
  label,
  title,
}: {
  readonly href: string;
  readonly direction: 'previous' | 'next';
  readonly label: string;
  readonly title: string;
}) {
  return (
    <a
      href={href}
      className={`flex min-h-11 min-w-0 flex-col gap-1 rounded-panel border border-border bg-surface-raised p-4 no-underline transition-colors duration-[var(--duration-fast)] hover:border-border-strong active:bg-surface-sunken ${
        direction === 'next' ? 'sm:col-start-2 sm:text-end' : ''
      }`}
    >
      <span className="text-caption font-semibold text-accent">
        {direction === 'previous' ? (
          <Icon
            name="arrow-start"
            size={16}
            className="me-1 inline-block align-[-0.15em]"
          />
        ) : null}
        {label}
        {direction === 'next' ? (
          <Icon
            name="arrow-end"
            size={16}
            className="ms-1 inline-block align-[-0.15em]"
          />
        ) : null}
        <span className="sr-only">: </span>
      </span>
      <span className="font-semibold wrap-anywhere text-foreground">{title}</span>
    </a>
  );
}

/** The other Explore sections, each with its summary — the way across. */
export async function OtherSections({
  locale,
  current,
}: {
  readonly locale: Locale;
  readonly current: ExploreSection;
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  return (
    <nav aria-labelledby="explore-others" className="flex min-w-0 flex-col gap-5">
      <SectionHeader
        id="explore-others"
        heading={t('others')}
        action={{ href: localizedPath(locale, '/explore'), text: t('allSections') }}
      />
      <CardGrid>
        {EXPLORE_SECTIONS.filter((section) => section !== current).map((section) => (
          <LinkCard
            key={section}
            href={localizedPath(locale, explorePath(section))}
            title={sectionTitle(shell, section)}
            description={shell(`explore.${section}.summary` as 'explore.about.summary')}
            {...(exploreSlugsOf(section).length === 0
              ? {}
              : {
                  meta: (
                    <span className="text-caption text-foreground-muted">
                      {t('pageCount', { count: exploreSlugsOf(section).length })}
                    </span>
                  ),
                })}
          />
        ))}
      </CardGrid>
    </nav>
  );
}

/** Home / Explore / … — the trail every Explore page starts with. */
export async function exploreTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    explore: { href: localizedPath(locale, '/explore'), text: shell('explore.title') },
  };
}
