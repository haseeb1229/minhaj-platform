import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Breadcrumbs, Container, Prose } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { EXPLORE_PAGES, EXPLORE_SECTIONS, type SectionWithPages } from '@/shell/explore';
import { requireRoute } from '@/shell/registry';

/**
 * A reserved Explore PAGE (ROUTE_MAP.md §3.2).
 *
 * THE ONE ROUTE MOST AT RISK OF BECOMING A CATCH-ALL, and the allowlist is what
 * stops it. Only the pairs `generateStaticParams` emits exist; `dynamicParams`
 * is off, so everything else is a 404 at the routing layer; and the component
 * re-validates both segments regardless.
 *
 * A SECTION WITH NO RESERVED PAGES HAS NO PAGES AT ALL. `leadership` and
 * `community` are landing shells, so `/explore/community/anything` produces no
 * static parameter, matches nothing, and is a 404 — which is the behaviour the
 * route map asks for, achieved by the data rather than by a guard.
 *
 * It renders a title and a publication-status state. Nothing else: this is a
 * reserved route, and reserving a route authorises no publication on it.
 */

export const dynamicParams = false;

export function generateStaticParams(): { section: string; page: string }[] {
  return Object.entries(EXPLORE_PAGES).flatMap(([section, pages]) =>
    pages.map((page) => ({ section, page })),
  );
}

interface PageParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly section: string;
    readonly page: string;
  }>;
}

/**
 * Narrows both segments together, or renders 404.
 *
 * TOGETHER, deliberately: `education` is a reserved page of `our-work` AND of
 * `shaykh-ul-islam`, so validating a slug without its section would accept
 * `/explore/about/education`, a URL that belongs to neither.
 */
function requirePage(section: string, page: string): SectionWithPages {
  if (!(EXPLORE_SECTIONS as readonly string[]).includes(section)) notFound();
  if (!(section in EXPLORE_PAGES)) notFound();

  const owner = section as SectionWithPages;
  if (!(EXPLORE_PAGES[owner] as readonly string[]).includes(page)) notFound();

  return owner;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { section, page } = await params;
  const owner = requirePage(section, page);
  const t = await getTranslations({ locale, namespace: 'shell' });

  return shellMetadata({
    locale,
    route: requireRoute(`explore.${owner}.${page}`),
    title: t(`explore.${owner}.pages.${page}` as 'explore.about.pages.vision'),
  });
}

export default async function ExplorePagePage({ params }: PageParams) {
  const locale = await requireLocale(params);
  const { section, page } = await params;
  const owner = requirePage(section, page);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });

  const sectionTitle = t(`explore.${owner}.title` as 'explore.about.title');
  const title = t(`explore.${owner}.pages.${page}` as 'explore.about.pages.vision');

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={t('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: t('nav.home') },
            { href: `/${locale}/explore`, text: t('explore.title') },
            { href: `/${locale}/explore/${owner}`, text: sectionTitle },
            { text: title },
          ]}
        />

        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        </Prose>

        <PublicationStatus locale={locale} />
      </div>
    </Container>
  );
}
