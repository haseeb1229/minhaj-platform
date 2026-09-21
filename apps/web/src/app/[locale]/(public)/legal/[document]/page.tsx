import {
  readPage,
  publishedPageMetadata,
  PublicContent,
} from '@/components/editorial/public-content';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Breadcrumbs, Container, Prose } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { LEGAL_DOCUMENTS, isLegalDocument, requireRoute } from '@/shell/registry';

/**
 * The reserved legal surfaces (ROUTE_MAP.md §3.10).
 *
 * FOUR ROUTES, NO LEGAL TEXT. Privacy, terms, cookie and accessibility
 * statements are legal instruments with legal consequences for a real
 * organisation operating across several jurisdictions. Drafting them is not an
 * engineering task, and an approximate privacy policy is worse than an absent
 * one because people rely on it. They are Minhaj-owned content, published
 * through the Phase-6 `Page` workflow (OPEN_DECISIONS.md §2.3).
 *
 * So each route renders its title and an explicit "not yet published" state,
 * and nothing that could be read as a policy — no summary, no "we may collect",
 * no placeholder clause, not even an example.
 *
 * Reserving them now is what lets the footer link honestly to the compliance
 * surfaces every authenticated platform must eventually carry, instead of
 * carrying four dead links until Phase 6.
 */

export const dynamic = 'force-dynamic';
export const dynamicParams = false;

export function generateStaticParams(): { document: string }[] {
  return LEGAL_DOCUMENTS.map((document) => ({ document }));
}

interface LegalParams {
  readonly params: Promise<{ readonly locale: string; readonly document: string }>;
}

export async function generateMetadata({ params }: LegalParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { document } = await params;
  if (!isLegalDocument(document)) notFound();

  const t = await getTranslations({ locale, namespace: 'shell' });

  const published = await publishedPageMetadata(locale, `/legal/${document}`);
  if (published) return published;

  return shellMetadata({
    locale,
    route: requireRoute(`legal.${document}`),
    title: t(`legal.${document}` as 'legal.privacy'),
  });
}

export default async function LegalDocumentPage({ params }: LegalParams) {
  const locale = await requireLocale(params);
  const { document } = await params;
  if (!isLegalDocument(document)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });
  const title = t(`legal.${document}` as 'legal.privacy');

  const published = await readPage(`/legal/${document}`);
  if (published)
    return (
      <PublicContent
        record={published}
        locale={locale}
        path={`/legal/${document}`}
        kind="WebPage"
      />
    );

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={t('nav.breadcrumbs')}
          trail={[{ href: `/${locale}`, text: t('nav.home') }, { text: title }]}
        />

        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        </Prose>

        <PublicationStatus locale={locale} />
      </div>
    </Container>
  );
}
