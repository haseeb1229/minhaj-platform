import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import { VideoDetailPage, videoMetadataInput } from '@/components/media/watch';
import { PersonalControls } from '@/components/personal-island/personal-controls';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/watch/videos/{slug}` — THE canonical address of one Video
 * (ROUTE_MAP.md §2.1).
 *
 * PUBLISHED ONLY, and the predicate is in the query: a draft or archived Video
 * is a 404 here. A FORMER slug never reaches this page — the request proxy
 * answers it with a single 301 through Media's own slug history
 * (DOMAIN_MODEL.md §19.7).
 *
 * THE ONE PUBLIC ROUTE THAT MAY FRAME A PROVIDER, and only after the visitor
 * asks: its Content-Security-Policy is the only public one whose `frame-src`
 * names the two privacy-enhanced provider hosts (`next.config.ts`).
 */
export const dynamic = 'force-dynamic';

interface DetailParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: DetailParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().video(slug);
  // A 404 carries no canonical and no alternates (ROUTE_MAP.md §9.2).
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({ locale, ...videoMetadataInput(locale, record) });
}

export default async function VideoPage({ params }: DetailParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().video(slug);
  if (record === null) notFound();
  return (
    <>
      <VideoDetailPage locale={locale} record={record} />
      <PersonalControls
        locale={locale}
        target={{ kind: 'video', id: record.id }}
        framed
      />
    </>
  );
}
