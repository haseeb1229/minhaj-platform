import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { TopicResearchKind } from '@minhaj/contracts/library';

import { ResearchHub } from '@/components/topic-hub/research';
import {
  LIBRARY_RECORD_SCOPES,
  type ResearchQuery,
} from '@/components/topic-hub/research-view';
import { Breadcrumbs, Container } from '@/components/ui';
import { sectionTitle } from './scholarly-presentation';

/**
 * `/library/research` and `/library/research-papers` — EVERY PUBLIC RECORD OF
 * ONE RESEARCH KIND IN THE LIBRARY (ROUTE_MAP.md §3.6; Library Part 3): the
 * shared research listing (`@/components/topic-hub/research`) over the whole
 * Library — figures, the two kinds as tabs between the two listings (each
 * counted under the view's other filters), filters with counts (Topic,
 * content language, author, decade, full text here), active-filter chips,
 * three orders, the decade timeline and numbered pages — read with
 * `scope: 'library'`, exactly as the Quran and Hadith hubs read their Topic.
 *
 * THE INTERFACE LOCALE DOES NOT FILTER CONTENT: `/ur/library/research` lists
 * research in every content language (ROUTE_MAP.md §1.5). Signed out, always:
 * nothing here can reach Identity or a cookie.
 */
export async function LibraryResearchPage({
  locale,
  kind,
  query,
}: {
  readonly locale: Locale;
  readonly kind: TopicResearchKind;
  readonly query: ResearchQuery;
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const title = sectionTitle(t, kind);
  const link = (path: string, text: string) => ({
    href: localizedPath(locale, path),
    text,
  });
  const words = (key: 'stat' | 'listIntro' | 'emptyTitle' | 'empty' | 'noResults') =>
    `records.${kind}.${key}` as const;

  return (
    <ResearchHub
      domain={{
        key: 'library',
        locale,
        topicId: null,
        title,
        frame: (children) => (
          <Container>
            <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
              <Breadcrumbs
                label={shell('nav.breadcrumbs')}
                trail={[
                  { href: localizedPath(locale, ''), text: shell('nav.home') },
                  { href: localizedPath(locale, '/library'), text: t('title') },
                  { text: title },
                ]}
              />
              {children}
            </div>
          </Container>
        ),
        previous: t('previous'),
        next: t('next'),
      }}
      scope={LIBRARY_RECORD_SCOPES[kind]}
      query={query}
      copy={{
        eyebrow: t('title'),
        lede: t(`sectionBody.${kind === 'research' ? 'research' : 'research-papers'}`),
        notice: t('scholarly.listingNotice'),
        stat: (count) => t(words('stat'), { count }),
        listIntro: t(words('listIntro')),
        emptyTitle: t(words('emptyTitle')),
        empty: t(words('empty')),
        noResults: t(words('noResults')),
        about: t('records.researchAbout'),
        emptyAction: link('/library/resources', t('records.toResources')),
      }}
      actions={[
        link('/library/topics', t('section.topics')),
        link('/library/languages', t('section.languages')),
      ]}
      onward={[
        link('/quran/research', t('records.quranResearch')),
        link('/hadith/research', t('records.hadithResearch')),
        link('/library', t('booksPage.libraryHome')),
      ]}
    />
  );
}
