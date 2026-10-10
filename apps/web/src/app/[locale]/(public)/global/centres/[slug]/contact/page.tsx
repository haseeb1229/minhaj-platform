import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { CentreContactPage } from '@/components/global/centre';
import { centreWords, placeLocales } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/centres/{centreSlug}/contact` — the Centre's public
 * directory contacts, DISPLAY ONLY. It has no form, sends no mail and creates
 * no message; the general `/contact` page remains Editorial correspondence.
 */
export const dynamic = 'force-dynamic';

interface CentreContactParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({
  params,
}: CentreContactParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await globalReadRuntime().centre(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'global' });
  return contentMetadata({
    locale,
    title: t('contact.title', { centre: centreWords(record, locale)?.name ?? slug }),
    contentLocales: placeLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) => globalPaths.centreContact(alternate, record.slug),
  });
}

export default async function CentreContactRoute({ params }: CentreContactParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await globalReadRuntime().centre(slug);
  if (record === null) notFound();
  return <CentreContactPage locale={locale} centre={record} />;
}
