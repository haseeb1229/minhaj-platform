import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  fatwaCategoryName,
  type PublicFatwaCategory,
  type PublicFatwaSummary,
} from '@minhaj/contracts/fatwa';

import { TextLink } from '@/components/ui';
import { FatwaDate, type FatwaTranslator } from './parts';
import { categoryHref, fatwaTextDirection, rulingHref } from './presentation';
import { readFatwaCategories } from './read';

/**
 * A list of published rulings — the landing's browse, a category, a topic view
 * and the topic hub's preview all render it.
 *
 * THE TITLE IS THE LINK, to the ruling's one canonical address, marked with the
 * ruling's own language and direction. Beside it: the category, the first
 * publication date and — when there has been one — the date of the latest
 * correction, so a corrected ruling never looks untouched. Nothing about who
 * asked, and no question text: a listing shows the published title only.
 */

export interface CategoryLabel {
  readonly slug: string;
  readonly name: string;
}

/** Every active category's display name, keyed by id — ONE read for a whole page. */
export async function categoryLabels(
  locale: Locale,
): Promise<ReadonlyMap<string, CategoryLabel>> {
  return categoryLabelsOf(await readFatwaCategories(), locale);
}

export function categoryLabelsOf(
  categories: readonly PublicFatwaCategory[],
  locale: Locale,
): ReadonlyMap<string, CategoryLabel> {
  return new Map(
    categories.map((category) => [
      category.id,
      {
        slug: category.slug,
        name: fatwaCategoryName(category.names, locale) ?? category.slug,
      },
    ]),
  );
}

export function FatwaList({
  locale,
  items,
  categories,
  label,
  headingLevel,
  t,
}: {
  readonly locale: Locale;
  readonly items: readonly PublicFatwaSummary[];
  readonly categories: ReadonlyMap<string, CategoryLabel>;
  readonly label: string;
  readonly headingLevel: 'h2' | 'h3';
  readonly t: FatwaTranslator;
}) {
  const Heading = headingLevel;
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((item) => {
        const category = categories.get(item.categoryId);
        return (
          <li key={item.id}>
            <article className="flex min-w-0 flex-col gap-2 border-b border-[color:var(--color-border)] py-4">
              <Heading
                className="text-base font-semibold wrap-anywhere"
                lang={item.language}
                dir={fatwaTextDirection(item.language)}
              >
                <TextLink href={rulingHref(locale, item.slug)}>{item.title}</TextLink>
              </Heading>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--color-foreground-muted)]">
                {category === undefined ? null : (
                  <span className="wrap-anywhere">
                    {t('item.category')}:{' '}
                    <a
                      href={categoryHref(locale, category.slug)}
                      className="underline underline-offset-2"
                    >
                      {category.name}
                    </a>
                  </span>
                )}
                <span>
                  {t('item.published')}:{' '}
                  <FatwaDate value={item.firstPublishedAt} locale={locale} />
                </span>
                {item.correctedAt === null ? null : (
                  <span>
                    {t('item.corrected')}:{' '}
                    <FatwaDate value={item.correctedAt} locale={locale} />
                  </span>
                )}
              </p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
