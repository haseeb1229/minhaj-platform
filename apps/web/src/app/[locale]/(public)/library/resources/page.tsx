import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { translationFor } from '@/components/editorial/public-content';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { labelFor, workPath } from '@/components/library/presentation';
import { listingHref, sectionTitle } from '@/components/library/scholarly';
import {
  scholarlyLabel,
  scholarlyListPath,
} from '@/components/library/scholarly-presentation';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/resources` — every resource type the Library area ACTUALLY
 * delivers (ROUTE_MAP.md §5).
 *
 * SEVEN TYPES, BECAUSE SEVEN EXIST. Works (Phase 8), Articles (Phase 6, at a
 * Library address), and Phase 9's research, research papers, publications,
 * encyclopedias and magazines. Collections are Phase 15's and are absent rather
 * than listed as an empty section, because a heading for a capability that does
 * not exist advertises something untrue. A DELIVERED type with nothing published
 * yet says so in its own section — that is an honest state, not a promise.
 *
 * THIS IS THE LAYER-4 COMPOSITION THE ARCHITECTURE NAMES, and it is worth being
 * precise about why it is allowed. Library does NOT depend on Editorial: it has no
 * import of an Editorial service, no query against an Editorial table and no
 * knowledge that Articles exist. This PAGE — Layer 4, application composition —
 * calls each owner's public read interface and renders the two lists side by side
 * (ARCHITECTURE.md §3.1.1, and this phase's §10: "Do NOT depend on Editorial to
 * display Articles. Layer 4 composes `/library/articles`").
 *
 * TWO SEPARATE LISTS RATHER THAN ONE MERGED FEED, deliberately. Merging them would
 * need one ordering across two contexts' records, which means one context's
 * timestamp standing in for the other's — and a "recency" that is really "whichever
 * context wrote more recently". Each list is bounded, ordered by its own owner, and
 * links to its own canonical address.
 */
export const dynamic = 'force-dynamic';

/** A deliberately short preview of each type. The full listings are one click away. */
const PREVIEW = 10;

/** Phase 9's types, in the Library's information-architecture order. */
const SCHOLARLY = [
  'research',
  'research-paper',
  'publication',
  'encyclopedia',
  'magazine',
] as const;

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.resources'),
    title: t('section.resources'),
    description: t('sectionBody.resources'),
  });
}

export default async function ResourcesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);

  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const [works, articles, ...scholarly] = await Promise.all([
    libraryReadRuntime().works({ offset: 0 }),
    editorialReadRuntime().articles(0),
    ...SCHOLARLY.map((kind) => libraryReadRuntime().scholarlyList(kind, {})),
  ]);

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/library`, text: t('title') },
            { text: t('section.resources') },
          ]}
        />

        <Prose>
          <PageHeading>{t('section.resources')}</PageHeading>
          <p>{t('sectionBody.resources')}</p>
        </Prose>

        <section className="flex flex-col gap-4">
          <SectionHeading>{t('section.books')}</SectionHeading>

          {works.items.length === 0 ? (
            <EmptyState>{t('empty')}</EmptyState>
          ) : (
            <ul aria-label={t('section.books')} className="flex flex-col gap-3">
              {works.items.slice(0, PREVIEW).map((record) => {
                const label = labelFor(record, locale);
                return (
                  <Panel key={record.id} as="li">
                    <p lang={label.locale} dir={directionOf(label.locale)}>
                      <TextLink href={workPath(locale, record.slug)}>
                        {label.title}
                      </TextLink>
                    </p>
                  </Panel>
                );
              })}
            </ul>
          )}

          <p className="text-sm">
            <TextLink href={`/${locale}/library/books`}>{t('allBooks')}</TextLink>
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <SectionHeading>{t('section.articles')}</SectionHeading>

          {articles.length === 0 ? (
            <EmptyState>{t('emptyArticles')}</EmptyState>
          ) : (
            <ul aria-label={t('section.articles')} className="flex flex-col gap-3">
              {articles.slice(0, PREVIEW).map((record) => {
                // EDITORIAL'S OWN RESOLUTION, not a second implementation of it.
                // Which language version of an Article is shown is Editorial's
                // decision, and this page uses the helper that makes it.
                const translation = translationFor(record, locale);
                return (
                  <Panel key={record.slug} as="li">
                    <p lang={translation.languageCode} dir="auto">
                      <TextLink
                        href={`/${locale}/library/articles/${encodeURIComponent(record.slug)}`}
                      >
                        {translation.title}
                      </TextLink>
                    </p>
                  </Panel>
                );
              })}
            </ul>
          )}

          <p className="text-sm">
            <TextLink href={`/${locale}/library/articles`}>{t('allArticles')}</TextLink>
          </p>
        </section>

        {SCHOLARLY.map((kind, index) => {
          const page = scholarly[index];
          const title = sectionTitle(t, kind);
          return (
            <section key={kind} className="flex flex-col gap-4">
              <SectionHeading>{title}</SectionHeading>

              {page === undefined || page.items.length === 0 ? (
                <EmptyState>{t(`scholarly.empty.${kind}`)}</EmptyState>
              ) : (
                <ul aria-label={title} className="flex flex-col gap-3">
                  {page.items.slice(0, PREVIEW).map((row) => {
                    const label = scholarlyLabel(row, locale);
                    return (
                      <Panel key={row.id} as="li">
                        <p lang={label.locale} dir={directionOf(label.locale)}>
                          <TextLink href={listingHref(locale, row)}>
                            {label.title}
                          </TextLink>
                        </p>
                      </Panel>
                    );
                  })}
                </ul>
              )}

              <p className="text-sm">
                <TextLink href={scholarlyListPath(locale, kind)}>
                  {t(`scholarly.viewAll.${kind}`)}
                </TextLink>
              </p>
            </section>
          );
        })}
      </div>
    </Container>
  );
}
