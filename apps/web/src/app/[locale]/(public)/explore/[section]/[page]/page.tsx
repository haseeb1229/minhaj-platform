import { localizedPath } from '@minhaj/contracts';
import type { PublicPageSummary } from '@minhaj/contracts/editorial';
import {
  readPage,
  publishedPageMetadata,
  PublicContent,
} from '@/components/editorial/public-content';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { AwaitingPage, TextLink } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import {
  EXPLORE_PAGES,
  EXPLORE_SECTIONS,
  ownerPathOf,
  type SectionWithPages,
} from '@/shell/explore';
import { requireRoute } from '@/shell/registry';
import {
  exploreItemKind,
  explorePath,
  type PublishedAddresses,
} from '@/components/explore/explore-view';
import {
  exploreTrail,
  MoreInSection,
  OfficialChannels,
  OnwardLinks,
  pageTitle,
  pageWhat,
  sectionTitle,
} from '@/components/explore/parts';

/**
 * An Explore PAGE (ROUTE_MAP.md §3.2).
 *
 * THE ONE ROUTE MOST AT RISK OF BECOMING A CATCH-ALL, and the allowlist is what
 * stops it. Only the pairs `generateStaticParams` emits exist; `dynamicParams`
 * is off, so everything else is a 404 at the routing layer; and the component
 * re-validates both segments regardless.
 *
 * A SECTION WITH NO RESERVED PAGES HAS NO PAGES AT ALL. `leadership` and
 * `community` are landing shells, so `/explore/community/anything` produces no
 * static parameter, matches nothing, and is a 404 — which is the behaviour the
 * route map asks for, achieved by the data rather than by a guard.
 *
 * WHAT IT RENDERS (Explore, R2). A published Page bound to the address, in the
 * section's trail with Share, followed by the rest of its section — every page
 * with its status, and the previous and next page. Otherwise the page that
 * awaits it: what will appear here, the publication-status notice (or, for a
 * Shaykh-ul-Islam listing or the feeds page, which no Page can fill, why they
 * are not open), the open parts of the platform that serve its reader now,
 * the official channels where the page is about them, and the rest of the
 * section. Reserving a route authorises no publication on it: nothing here
 * states an organisational fact.
 */

export const dynamic = 'force-dynamic';
export const dynamicParams = false;

export function generateStaticParams(): { section: string; page: string }[] {
  return Object.entries(EXPLORE_PAGES).flatMap(([section, pages]) =>
    pages.map((page) => ({ section, page })),
  );
}

interface PageParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly section: string;
    readonly page: string;
  }>;
}

/**
 * Narrows both segments together, or renders 404.
 *
 * TOGETHER, deliberately: `education` is a reserved page of `our-work` AND of
 * `shaykh-ul-islam`, so validating a slug without its section would accept
 * `/explore/about/education`, a URL that belongs to neither.
 */
function requirePage(section: string, page: string): SectionWithPages {
  if (!(EXPLORE_SECTIONS as readonly string[]).includes(section)) notFound();
  if (!(section in EXPLORE_PAGES)) notFound();

  const owner = section as SectionWithPages;
  if (!(EXPLORE_PAGES[owner] as readonly string[]).includes(page)) notFound();

  return owner;
}

/** The published Explore Pages, or `null` when they cannot be read (no claim either way). */
async function readExplorePages(): Promise<readonly PublicPageSummary[] | null> {
  try {
    return await editorialReadRuntime().explorePages();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { section, page } = await params;
  const owner = requirePage(section, page);
  // Redirected by the page below; nothing here is a canonical URL.
  if (ownerPathOf(owner, page) !== null)
    return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'shell' });
  const explore = await getTranslations({ locale, namespace: 'explore' });

  // Only a Page address can carry a published Page.
  if (exploreItemKind(owner, page) === 'page') {
    const published = await publishedPageMetadata(locale, explorePath(owner, page));
    if (published) return published;
  }

  return shellMetadata({
    locale,
    route: requireRoute(`explore.${owner}.${page}`),
    title: t(`explore.${owner}.pages.${page}` as 'explore.about.pages.vision'),
    description: explore(`what.${owner}.${page}` as 'what.about.vision'),
  });
}

export default async function ExplorePagePage({ params }: PageParams) {
  const locale = await requireLocale(params);
  const { section, page } = await params;
  const owner = requirePage(section, page);
  // The owner delivered the real page: one permanent redirect to it.
  const delivered = ownerPathOf(owner, page);
  if (delivered !== null) permanentRedirect(localizedPath(locale, `${delivered}`));
  setRequestLocale(locale);

  const kind = exploreItemKind(owner, page);
  const [shell, t, record, pages, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'explore' }),
    kind === 'page' ? readPage(explorePath(owner, page)) : Promise.resolve(null),
    readExplorePages(),
    exploreTrail(locale),
  ]);
  const published: PublishedAddresses =
    pages === null ? null : new Set(pages.map((entry) => entry.routeBinding));
  const name = sectionTitle(shell, owner);
  const title = pageTitle(shell, owner, page);
  const more = (back: boolean) => (
    <MoreInSection
      locale={locale}
      section={owner}
      slug={page}
      published={published}
      back={back}
    />
  );

  if (record)
    return (
      <PublicContent
        record={record}
        locale={locale}
        path={explorePath(owner, page)}
        kind="WebPage"
        trail={[
          { path: '/explore', text: trail.explore.text },
          { path: explorePath(owner), text: name },
        ]}
        share
      >
        {more(true)}
      </PublicContent>
    );

  return (
    <AwaitingPage
      crumbs={{
        label: trail.label,
        trail: [
          trail.home,
          trail.explore,
          { href: localizedPath(locale, explorePath(owner)), text: name },
          { text: title },
        ],
      }}
      status={kind === 'page' ? t('status.awaiting') : t('status.notOpen')}
      title={title}
      lede={pageWhat(t, owner, page)}
      notice={
        kind === 'page' ? (
          <PublicationStatus locale={locale} />
        ) : kind === 'listing' ? (
          {
            id: 'explore-listing-notice',
            title: t('listing.noticeTitle'),
            children: (
              <p className="max-w-[var(--measure-prose)]">
                {page === 'collections'
                  ? t('listing.noticeCollections')
                  : t('listing.notice')}
              </p>
            ),
          }
        ) : (
          {
            id: 'explore-feed-notice',
            title: t('feed.noticeTitle'),
            children: <p className="max-w-[var(--measure-prose)]">{t('feed.notice')}</p>,
          }
        )
      }
      back={
        <TextLink href={localizedPath(locale, explorePath(owner))}>
          {t('back', { section: name })}
        </TextLink>
      }
    >
      <OnwardLinks locale={locale} section={owner} slug={page} />
      <OfficialChannels locale={locale} section={owner} slug={page} />
      {more(false)}
    </AwaitingPage>
  );
}
