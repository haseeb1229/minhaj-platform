import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { SeriesKind } from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import {
  GroupDirectoryPage,
  GroupPage,
  groupMetadataInput,
} from '@/components/media/groups';
import {
  groupPageCanonicalRedirect,
  groupsCanonicalRedirect,
  readGroupPage,
  readGroupsView,
} from '@/components/media/groups-view';
import { seriesPath, seriesSegment } from '@/components/media/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata, shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * The shared behaviour of `/watch/series` and `/watch/programs` — ONE route
 * implementation per page kind, parameterised by the Series `kind`.
 *
 * A SERIES HAS EXACTLY ONE CANONICAL FAMILY. A programme is reachable only at
 * `/watch/programs/{slug}` and a series only at `/watch/series/{slug}`; the
 * read service returns `null` for the other family, so the page 404s — and the
 * request proxy has already answered the wrong family, or a former slug, with a
 * single 301 to the current address (ROUTE_MAP.md §9.7).
 *
 * WATCH PART 2: the listing is the kind's directory (`?q, language, speaker,
 * topic, sort, page`) and a Series' page lists its episodes 24 a page
 * (`?page`); one address per view, and anything else is one redirect.
 */

export interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export interface DetailParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export function seriesListingRoute(kind: SeriesKind) {
  const section = seriesSegment(kind) as 'series' | 'programs';
  return {
    async generateMetadata({ params }: ListingParams): Promise<Metadata> {
      const locale = await requireLocale(params);
      const t = await getTranslations({ locale, namespace: 'watch' });
      return shellMetadata({
        locale,
        route: requireRoute(`watch.${section}`),
        title: t(`sections.${section}`),
        description: t(`sectionBody.${section}`),
      });
    },
    async Page({ params, searchParams }: ListingParams) {
      const locale = await requireLocale(params);
      const query = await searchParams;
      const canonical = groupsCanonicalRedirect(kind, locale, query);
      if (canonical !== null) redirect(canonical);
      return (
        <GroupDirectoryPage locale={locale} kind={kind} view={readGroupsView(query)} />
      );
    },
  };
}

export function seriesDetailRoute(kind: SeriesKind) {
  return {
    async generateMetadata({ params }: DetailParams): Promise<Metadata> {
      const locale = await requireLocale(params);
      const { slug } = await params;
      const record = await mediaReadRuntime().series(kind, slug);
      if (record === null) return { robots: { index: false, follow: false } };
      return contentMetadata({
        locale,
        ...groupMetadataInput(locale, record, (alternate) =>
          seriesPath(alternate, record.kind, record.slug),
        ),
      });
    },
    async Page({ params, searchParams }: DetailParams) {
      const locale = await requireLocale(params);
      const { slug } = await params;
      const record = await mediaReadRuntime().series(kind, slug);
      if (record === null) notFound();
      const query = await searchParams;
      const canonical = groupPageCanonicalRedirect(
        seriesPath(locale, record.kind, record.slug),
        query,
      );
      if (canonical !== null) redirect(canonical);
      return <GroupPage locale={locale} record={record} page={readGroupPage(query)} />;
    },
  };
}
