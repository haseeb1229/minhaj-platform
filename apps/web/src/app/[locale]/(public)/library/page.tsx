import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import {
  Breadcrumbs,
  Container,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library` — the Library landing page (ROUTE_MAP.md §5).
 *
 * IT LISTS WHAT EXISTS AND NOTHING ELSE. Phase 9 delivered research, research
 * papers, publications, magazines and encyclopedias, so they are listed. ROUTE_MAP.md
 * §5 also gives the Library area collections, which belong to Phase 15; they do not
 * appear here, not even as a greyed-out heading or a "coming soon" line, because
 * "a deferred capability is never linked as dead navigation" (§5.2).
 *
 * THE ONE ENTRY THIS PAGE DOES NOT OWN is Articles. `/library/articles` is
 * Editorial's content at a Library address, delivered by Phase 6; this page links
 * to it and knows nothing else about it. Library does not absorb Editorial's
 * tables, its workflow or its read model (§10, and the Phase-6 regression
 * contract).
 *
 * STATIC-ELIGIBLE AND SESSION-FREE. There is no data read here at all: the page is
 * navigation over a set of routes that is code. `force-dynamic` would buy nothing
 * and cost a render per visit.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library'),
    title: t('title'),
    description: t('description'),
  });
}

/**
 * The surfaces this landing page offers, and the ONE ordering of them.
 *
 * `articles` carries its own path because it is not a Library registry route —
 * it is Editorial's, and giving it a Library registry entry would be Library
 * claiming a resource it does not own.
 */
const SECTIONS: readonly {
  readonly key: string;
  readonly path: string;
}[] = [
  { key: 'books', path: '/library/books' },
  { key: 'resources', path: '/library/resources' },
  { key: 'articles', path: '/library/articles' },
  { key: 'research', path: '/library/research' },
  { key: 'research-papers', path: '/library/research-papers' },
  { key: 'publications', path: '/library/publications' },
  { key: 'encyclopedias', path: '/library/encyclopedias' },
  { key: 'magazines', path: '/library/magazines' },
  { key: 'authors', path: '/library/authors' },
  { key: 'topics', path: '/library/topics' },
  { key: 'languages', path: '/library/languages' },
  { key: 'downloads', path: '/library/downloads' },
  { key: 'sale-points', path: '/library/sale-points' },
];

export default async function LibraryLandingPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[{ href: `/${locale}`, text: shell('nav.home') }, { text: t('title') }]}
        />

        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('description')}</p>
          {/*
           * SAID ON THE PAGE, not only in a document. Titles and descriptions are
           * this platform's descriptive metadata; a translated EDITION is domain
           * data recorded against a Work. Conflating them is the mistake
           * DOMAIN_MODEL.md §10.1 exists to correct, and a reader has no way to
           * know that unless the page says so.
           */}
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('metadataNotice')}
          </p>
        </Prose>

        <ul className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <Panel key={section.key} as="li">
              <div className="flex flex-col gap-2">
                <SectionHeading>
                  <TextLink href={`/${locale}${section.path}`}>
                    {t(`section.${section.key}` as 'section.books')}
                  </TextLink>
                </SectionHeading>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t(`sectionBody.${section.key}` as 'sectionBody.books')}
                </p>
              </div>
            </Panel>
          ))}
        </ul>
      </div>
    </Container>
  );
}
