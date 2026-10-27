import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  fatwaCategoryName,
  type PublicFatwaCategory,
  type PublicFatwaSummary,
} from '@minhaj/contracts/fatwa';

import { MetaRow } from '@/components/ui';
import { FatwaDate, type FatwaTranslator } from './parts';
import { categoryHref, fatwaTextDirection, rulingHref } from './presentation';
import { readFatwaCategories } from './read';

/**
 * A list of published rulings — the landing's browse, a category, a topic view
 * and the topic hub's preview all render it.
 *
 * THE TITLE IS THE LINK, to the ruling's one canonical address, marked with the
 * ruling's own language and direction. Beneath it, one line of metadata (each
 * item isolated, so an Urdu category beside an English date keeps its order):
 * the category, the first
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
    <ol
      aria-label={label}
      className="flex list-none flex-col border-t border-[color:var(--color-border)] p-0"
    >
      {items.map((item) => {
        const category = categories.get(item.categoryId);
        return (
          <li key={item.id} className="border-b border-[color:var(--color-border)]">
            <article className="flex min-w-0 flex-col gap-2 py-5">
              <Heading
                className="text-subheading font-semibold text-balance wrap-anywhere"
                lang={item.language}
                dir={fatwaTextDirection(item.language)}
              >
                <a
                  href={rulingHref(locale, item.slug)}
                  className="text-[color:var(--color-foreground)] underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:decoration-[color:var(--color-action)] active:text-[color:var(--color-action)]"
                >
                  {item.title}
                </a>
              </Heading>
              <MetaRow
                items={[
                  category === undefined ? null : (
                    <span className="wrap-anywhere">
                      {t('item.category')}:{' '}
                      <a
                        href={categoryHref(locale, category.slug)}
                        className="inline-flex min-h-6 items-center text-[color:var(--color-action)] underline underline-offset-2"
                      >
                        {category.name}
                      </a>
                    </span>
                  ),
                  <>
                    {t('item.published')}:{' '}
                    <FatwaDate value={item.firstPublishedAt} locale={locale} />
                  </>,
                  item.correctedAt === null ? null : (
                    <>
                      {t('item.corrected')}:{' '}
                      <FatwaDate value={item.correctedAt} locale={locale} />
                    </>
                  ),
                ]}
              />
            </article>
          </li>
        );
      })}
    </ol>
  );
}
