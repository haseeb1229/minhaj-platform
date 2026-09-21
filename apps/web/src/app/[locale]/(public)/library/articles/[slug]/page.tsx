import { notFound } from 'next/navigation';
import { requireLocale } from '@/config/route-locale';
import {
  readArticle,
  editorialMetadata,
  PublicContent,
} from '@/components/editorial/public-content';
export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ locale: string; slug: string }>;
}
export async function generateMetadata({ params }: Props) {
  const locale = await requireLocale(params),
    { slug } = await params;
  const record = await readArticle(slug);
  return record
    ? editorialMetadata(
        record,
        locale,
        '/library/articles/' + encodeURIComponent(record.slug),
      )
    : { robots: { index: false, follow: false } };
}
export default async function ArticlePage({ params }: Props) {
  const locale = await requireLocale(params),
    { slug } = await params;
  const record = await readArticle(slug);
  if (!record) notFound();
  return (
    <PublicContent
      record={record}
      locale={locale}
      path={'/library/articles/' + encodeURIComponent(record.slug)}
      kind="Article"
    />
  );
}
