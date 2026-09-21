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
import { EXPLORE_SECTIONS, exploreSlugsOf, type ExploreSection } from '@/shell/explore';
import { requireRoute } from '@/shell/registry';

/**
 * An Explore SECTION shell (ROUTE_MAP.md §3.2).
 *
 * THE ALLOWLIST IS THE ROUTE. `dynamicParams = false` means Next answers any
 * segment `generateStaticParams` did not produce with a 404 before this
 * component runs at all — and the component validates the segment anyway,
 * because a routing configuration is a convenience and the render tree is the
 * authority (the same rule the locale segment follows,
 * SECURITY_BASELINE.md §9.1).
 *
 * WHAT IT SHOWS. Its own title, the pages it reserves, and an explicit
 * publication-status state. It shows no organisational content, because none
 * has been published: vision, mission, history, governance and the rest enter
 * the system as `Page` records through the Phase-6 workflow
 * (OPEN_DECISIONS.md §6.1).
 */

export const dynamic = 'force-dynamic';
export const dynamicParams = false;

export function generateStaticParams(): { section: ExploreSection }[] {
  return EXPLORE_SECTIONS.map((section) => ({ section }));
}

interface SectionParams {
  readonly params: Promise<{ readonly locale: string; readonly section: string }>;
}

/** Narrows the section segment, or renders 404. */
function requireSection(value: string): ExploreSection {
  if (!(EXPLORE_SECTIONS as readonly string[]).includes(value)) notFound();
  return value as ExploreSection;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const section = requireSection((await params).section);
  const t = await getTranslations({ locale, namespace: 'shell' });

  const published = await publishedPageMetadata(locale, `/explore/${section}`);
  if (published) return published;

  return shellMetadata({
    locale,
    route: requireRoute(`explore.${section}`),
    title: t(`explore.${section}.title` as 'explore.about.title'),
  });
}

export default async function ExploreSectionPage({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const section = requireSection((await params).section);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });
  const slugs = exploreSlugsOf(section);
  const title = t(`explore.${section}.title` as 'explore.about.title');

  const published = await readPage(`/explore/${section}`);
  if (published)
    return (
      <PublicContent
        record={published}
        locale={locale}
        path={`/explore/${section}`}
        kind="WebPage"
      />
    );

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={t('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: t('nav.home') },
            { href: `/${locale}/explore`, text: t('explore.title') },
            { text: title },
          ]}
        />

        <Prose>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t(`explore.${section}.summary` as 'explore.about.summary')}
          </p>
        </Prose>

        {slugs.length === 0 ? null : (
          <nav aria-label={title}>
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {slugs.map((slug) => (
                <li key={slug}>
                  <a
                    href={`/${locale}/explore/${section}/${slug}`}
                    className="underline underline-offset-2"
                  >
                    {t(
                      `explore.${section}.pages.${slug}` as 'explore.about.pages.vision',
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <PublicationStatus locale={locale} />
      </div>
    </Container>
  );
}
