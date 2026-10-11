import { z } from 'zod';
import { requireLocale } from '@/config/route-locale';
import { ContentDirectory } from '../content';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ offset?: string; state?: string }>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  return (
    <ContentDirectory
      locale={locale}
      kind="collection"
      offset={z.coerce.number().int().min(0).max(10000000).catch(0).parse(query.offset)}
      state={query.state || null}
    />
  );
}
