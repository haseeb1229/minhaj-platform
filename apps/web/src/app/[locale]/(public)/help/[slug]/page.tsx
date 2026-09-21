import { notFound } from 'next/navigation';
import { requireLocale } from '@/config/route-locale';
import {
  readPage,
  publishedPageMetadata,
  PublicContent,
} from '@/components/editorial/public-content';
export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ locale: string; slug: string }>;
}
export async function generateMetadata({ params }: Props) {
  const locale = await requireLocale(params),
    { slug } = await params;
  return (
    (await publishedPageMetadata(locale, 'help-article', slug)) ?? {
      robots: { index: false, follow: false },
    }
  );
}
export default async function HelpArticle({ params }: Props) {
  const locale = await requireLocale(params),
    { slug } = await params;
  const record = await readPage('help-article', slug);
  if (!record) notFound();
  return (
    <PublicContent
      record={record}
      locale={locale}
      path={'/help/' + encodeURIComponent(record.slug)}
      kind="WebPage"
    />
  );
}
