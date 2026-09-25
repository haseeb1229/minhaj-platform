import { z } from 'zod';
import { notFound } from 'next/navigation';
import { requireLocale } from '@/config/route-locale';
import { ContentEditor } from '../../content';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ revisionOffset?: string; referenceQuery?: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  if (id !== 'new' && !z.uuid().safeParse(id).success) notFound();
  return (
    <ContentEditor
      locale={locale}
      kind="press-release"
      id={id}
      referenceQuery={z
        .string()
        .max(100)
        .catch('')
        .parse((await searchParams).referenceQuery ?? '')}
      revisionOffset={z.coerce
        .number()
        .int()
        .min(0)
        .max(10000000)
        .catch(0)
        .parse((await searchParams).revisionOffset)}
    />
  );
}
