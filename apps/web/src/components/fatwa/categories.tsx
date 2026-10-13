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
import { EmptyState, PageHeading, Panel, Prose, TextLink } from '@/components/ui';
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
    >
      <Prose>
        <PageHeading>{title}</PageHeading>
        <p>{t('categories.intro')}</p>
      </Prose>
      {categories.length === 0 ? (
        <EmptyState>{t('categories.empty')}</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Panel key={category.id} as="li">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold wrap-anywhere">
                  <TextLink href={categoryHref(locale, category.slug)}>
                    {fatwaCategoryName(category.names, locale) ?? category.slug}
                  </TextLink>
                </h2>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('categories.count', { count: category.publicCount })}
                </p>
              </div>
            </Panel>
          ))}
        </ul>
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
    >
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span className="wrap-anywhere">{name}</span>
        </PageHeading>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li>
            <TextLink
              href={fatwaBrowseHref(locale, { sort: 'popular', category: category.slug })}
            >
              {t('categories.popular')}
            </TextLink>
          </li>
          {topic === undefined ? null : (
            <li>
              <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
                {t('categories.topicLink', { topic: topic.name })}
              </TextLink>
            </li>
          )}
        </ul>
      </div>
      {page.items.length === 0 ? (
        <EmptyState>{t('categories.rulingsEmpty')}</EmptyState>
      ) : (
        <FatwaList
          locale={locale}
          items={page.items}
          categories={categoryLabelsOf(categories, locale)}
          label={t('categories.rulings')}
          headingLevel="h2"
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
    </FatwaFrame>
  );
}
