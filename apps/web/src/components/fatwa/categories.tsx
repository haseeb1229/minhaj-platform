import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  FATWA_PAGE_SIZE,
  fatwaCategoryName,
  type FatwaAvailability,
  type PublicFatwaCategory,
} from '@minhaj/contracts/fatwa';

import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { referenceNames } from '@/composition/public-references';
import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import {
  ActionLink,
  CardGrid,
  EmptyState,
  LinkCard,
  MetaRow,
  SectionHeader,
} from '@/components/ui';
import { categoryLabelsOf, FatwaList } from './list';
import { FatwaFrame, fatwaTrail } from './parts';
import {
  categoryHref,
  fatwaBrowseHref,
  fatwaSectionPath,
  offsetHref,
} from './presentation';
import { readFatwaCategories } from './read';

/**
 * `/fatwa/categories` and `/fatwa/categories/{slug}` (ROUTE_MAP.md §3.8).
 *
 * A CATEGORY IS FATWA'S OWN CLASSIFICATION, mapped onto exactly one canonical
 * Topic and never replacing it (DOMAIN_MODEL.md §12). Each category page links
 * to that Topic's hub, where everything on the subject meets. Only ACTIVE
 * categories exist publicly; an archived or unknown one is a 404.
 */

export async function FatwaCategoriesPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const parts = await fatwaTrail(locale);
  const categories = await readFatwaCategories();
  const title = t('sections.categories');

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.fatwa, { text: title }]}
      heading={{ title, lede: t('categories.intro') }}
    >
      {categories.length === 0 ? (
        <EmptyState>{t('categories.empty')}</EmptyState>
      ) : (
        <CardGrid label={title}>
          {categories.map((category) => (
            <LinkCard
              key={category.id}
              href={categoryHref(locale, category.slug)}
              title={fatwaCategoryName(category.names, locale) ?? category.slug}
              headingLevel="h2"
              meta={
                <MetaRow
                  items={[t('categories.count', { count: category.publicCount })]}
                />
              }
            />
          ))}
        </CardGrid>
      )}
    </FatwaFrame>
  );
}

export async function FatwaCategoryPage({
  locale,
  availability,
  category,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly category: PublicFatwaCategory;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const parts = await fatwaTrail(locale);
  const [page, categories, names] = await Promise.all([
    fatwaReadRuntime().reader.browse({
      sort: 'latest',
      categoryId: category.id,
      topicId: null,
      offset,
    }),
    readFatwaCategories(),
    referenceNames({ personIds: [], topicIds: [category.topicId] }, locale),
  ]);
  const name = fatwaCategoryName(category.names, locale) ?? category.slug;
  const topic = names.topics.get(category.topicId);
  const path = categoryHref(locale, category.slug);
  const links = pageLinks(page.offset, FATWA_PAGE_SIZE, page.total);

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[
        parts.home,
        parts.fatwa,
        { href: fatwaSectionPath(locale, 'categories'), text: t('sections.categories') },
        { text: name },
      ]}
      heading={{
        title: <span className="wrap-anywhere">{name}</span>,
        meta: (
          <MetaRow items={[t('categories.count', { count: category.publicCount })]} />
        ),
        extra: (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <ActionLink
              href={fatwaBrowseHref(locale, { sort: 'popular', category: category.slug })}
              tone="secondary"
            >
              {t('categories.popular')}
            </ActionLink>
            {topic === undefined ? null : (
              <ActionLink
                href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                tone="secondary"
              >
                {t('categories.topicLink', { topic: topic.name })}
              </ActionLink>
            )}
          </div>
        ),
      }}
    >
      <section className="flex flex-col gap-5" aria-labelledby="fatwa-category-rulings">
        <SectionHeader id="fatwa-category-rulings" heading={t('categories.rulings')} />
        {page.items.length === 0 ? (
          <EmptyState>{t('categories.rulingsEmpty')}</EmptyState>
        ) : (
          <FatwaList
            locale={locale}
            items={page.items}
            categories={categoryLabelsOf(categories, locale)}
            label={t('categories.rulings')}
            headingLevel="h3"
            t={t}
          />
        )}
        <Pagination
          label={t('categories.rulings')}
          previous={links.previous === null ? null : offsetHref(path, links.previous)}
          next={links.next === null ? null : offsetHref(path, links.next)}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
      </section>
    </FatwaFrame>
  );
}
