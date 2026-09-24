import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { SeriesKind } from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import { seriesPath, seriesSegment } from '@/components/media/presentation';
import {
  groupMetadataInput,
  SeriesDetailPage,
  SeriesListingPage,
} from '@/components/media/watch';
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
      return <SeriesListingPage locale={locale} kind={kind} query={await searchParams} />;
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
      return (
        <SeriesDetailPage locale={locale} record={record} query={await searchParams} />
      );
    },
  };
}
