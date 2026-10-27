import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import {
  ActionLink,
  Breadcrumbs,
  CardGrid,
  Container,
  LinkCard,
  PageHero,
  SectionHeader,
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
 * and cost a render per visit. The front door is therefore organised by WHAT A
 * READER IS LOOKING FOR — books, research, periodicals, and what is available —
 * rather than by showing records, which would make it a data-driven route.
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

type SectionKey =
  | 'books'
  | 'resources'
  | 'articles'
  | 'research'
  | 'research-papers'
  | 'publications'
  | 'encyclopedias'
  | 'magazines'
  | 'authors'
  | 'topics'
  | 'languages'
  | 'downloads'
  | 'sale-points';

/**
 * The surfaces this landing page offers, grouped, and the ONE ordering of them.
 *
 * `articles` carries its own path because it is not a Library registry route —
 * it is Editorial's, and giving it a Library registry entry would be Library
 * claiming a resource it does not own.
 *
 * The contributor, topic and language browses sit with Books because that is
 * what they are: three ways into the same published Works.
 */
const GROUPS: readonly {
  readonly key: 'books' | 'scholarly' | 'periodicals' | 'access';
  readonly columns: 2 | 3 | 4;
  readonly sections: readonly { readonly key: SectionKey; readonly path: string }[];
}[] = [
  {
    key: 'books',
    columns: 4,
    sections: [
      { key: 'books', path: '/library/books' },
      { key: 'authors', path: '/library/authors' },
      { key: 'topics', path: '/library/topics' },
      { key: 'languages', path: '/library/languages' },
    ],
  },
  {
    key: 'scholarly',
    columns: 4,
    sections: [
      { key: 'research', path: '/library/research' },
      { key: 'research-papers', path: '/library/research-papers' },
      { key: 'publications', path: '/library/publications' },
      { key: 'encyclopedias', path: '/library/encyclopedias' },
    ],
  },
  {
    key: 'periodicals',
    columns: 2,
    sections: [
      { key: 'magazines', path: '/library/magazines' },
      { key: 'articles', path: '/library/articles' },
    ],
  },
  {
    key: 'access',
    columns: 3,
    sections: [
      { key: 'resources', path: '/library/resources' },
      { key: 'downloads', path: '/library/downloads' },
      { key: 'sale-points', path: '/library/sale-points' },
    ],
  },
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
    <>
      <Container>
        <div className="py-4">
          <Breadcrumbs
            label={shell('nav.breadcrumbs')}
            trail={[
              { href: `/${locale}`, text: shell('nav.home') },
              { text: t('title') },
            ]}
          />
        </div>
      </Container>

      <PageHero
        tone="ink"
        title={t('title')}
        lede={t('description')}
        actions={
          <>
            <ActionLink href={`/${locale}/library/books`} onInk>
              {t('landing.browseBooks')}
            </ActionLink>
            <ActionLink href={`/${locale}/library/resources`} tone="secondary" onInk>
              {t('landing.allResources')}
            </ActionLink>
          </>
        }
      >
        {/*
         * SAID ON THE PAGE, not only in a document. Titles and descriptions are
         * this platform's descriptive metadata; a translated EDITION is domain
         * data recorded against a Work. Conflating them is the mistake
         * DOMAIN_MODEL.md §10.1 exists to correct, and a reader has no way to
         * know that unless the page says so.
         */}
        <p className="max-w-[var(--measure-prose)] border-s-2 border-[color:var(--color-ink-border)] ps-3 text-sm text-[color:var(--color-ink-muted)]">
          {t('metadataNotice')}
        </p>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-page)]">
          {GROUPS.map((group) => {
            const id = `library-${group.key}`;
            return (
              <section
                key={group.key}
                aria-labelledby={id}
                className="flex flex-col gap-5"
              >
                <SectionHeader
                  id={id}
                  heading={t(`landing.groups.${group.key}.heading`)}
                  intro={t(`landing.groups.${group.key}.intro`)}
                />
                <CardGrid columns={group.columns}>
                  {group.sections.map((section) => (
                    <LinkCard
                      key={section.key}
                      href={`/${locale}${section.path}`}
                      title={t(`section.${section.key}`)}
                      description={t(`sectionBody.${section.key}`)}
                    />
                  ))}
                </CardGrid>
              </section>
            );
          })}
        </div>
      </Container>
    </>
  );
}
