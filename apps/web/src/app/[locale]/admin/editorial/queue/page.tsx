import { z } from 'zod';
import { editorialKindSchema } from '@minhaj/contracts/editorial';
import { requireLocale } from '@/config/route-locale';
import { ContentDirectory } from '../content';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const locale = await requireLocale(params);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(10000000)
    .catch(0)
    .parse((await searchParams).offset);
  // ONE queue across every aggregate the shared workflow governs: the records
  // awaiting an independent review, each list bounded and paged on its own.
  return (
    <>
      {editorialKindSchema.options.map((kind) => (
        <ContentDirectory key={kind} locale={locale} kind={kind} offset={offset} queue />
      ))}
    </>
  );
}
