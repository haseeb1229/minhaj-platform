import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { CentreDetailPage } from '@/components/global/centre';
import { centreWords, placeLocales } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/centres/{centreSlug}` — one public Centre: its genuine
 * facts, contacts and latest centre-scoped News. A former slug answers a single
 * 301 from the request proxy. Hidden when it, or any place it is in, is not
 * public.
 */
export const dynamic = 'force-dynamic';

interface CentreParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: CentreParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await globalReadRuntime().centre(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  const words = centreWords(record, locale);
  return contentMetadata({
    locale,
    title: words?.name ?? record.slug,
    ...(words?.description == null
      ? {}
      : { description: words.description.slice(0, 160) }),
    contentLocales: placeLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) => globalPaths.centre(alternate, record.slug),
  });
}

export default async function CentreRoute({ params }: CentreParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await globalReadRuntime().centre(slug);
  if (record === null) notFound();
  return <CentreDetailPage locale={locale} centre={record} />;
}
