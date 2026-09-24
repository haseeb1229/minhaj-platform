import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import { listenMetadataInput, TrackDetailPage } from '@/components/media/listen';
import { audioTrackPath } from '@/components/media/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/listen/lectures/{slug}` — THE canonical address of one AudioTrack
 * (ROUTE_MAP.md §2.1, §3.7).
 *
 * PUBLISHED ONLY, and the predicate is in the query: a draft or archived track
 * is a 404 here. A FORMER slug never reaches this page — the request proxy
 * answers it with a single 301 through Media's own slug history
 * (DOMAIN_MODEL.md §19.7).
 *
 * THE PLAYER'S BYTES come from `/assets/media/audio/…` on this origin, which the
 * base Content-Security-Policy already permits (`default-src 'self'`): no media
 * host is allowed and no policy is widened for audio.
 */
export const dynamic = 'force-dynamic';

interface DetailParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: DetailParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().audioTrack(slug);
  // A 404 carries no canonical and no alternates (ROUTE_MAP.md §9.2).
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({
    locale,
    ...listenMetadataInput(locale, record, (alternate) =>
      audioTrackPath(alternate, record.slug),
    ),
  });
}

export default async function TrackPage({ params }: DetailParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().audioTrack(slug);
  if (record === null) notFound();
  return <TrackDetailPage locale={locale} record={record} />;
}
