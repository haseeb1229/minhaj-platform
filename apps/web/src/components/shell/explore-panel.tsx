import { localizedPath, type Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { readPresence } from '@/composition/presence';
import {
  EXPLORE_SECTIONS,
  exploreHrefOf,
  exploreSlugsOf,
  ownerPathOf,
} from '@/shell/explore';
import { hasSignal } from '@/shell/presence';

/**
 * THE ORGANISATION INDEX on `/explore` (Rebaseline R1).
 *
 * PUBLISHED PAGES ONLY. The Explore route list reserves some forty pages for
 * the organisation's own content; promoting every reserved address made the
 * product look unfinished, so this index lists a page only once it is published
 * (or delivered by its owner elsewhere) and a section only when it holds
 * something to read. Reserved addresses still answer, honestly, if visited.
 * Leadership is listed when contributor profiles are published.
 */
export async function ExplorePanel({ locale }: { readonly locale: Locale }) {
  const [t, presence] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readPresence(),
  ]);

  const sections = EXPLORE_SECTIONS.map((section) => {
    const landingPublished =
      presence.publishedPages.has(`/explore/${section}`) ||
      (section === 'leadership' && hasSignal(presence, 'people'));
    const pages = exploreSlugsOf(section).filter(
      (slug) =>
        ownerPathOf(section, slug) !== null ||
        presence.publishedPages.has(`/explore/${section}/${slug}`),
    );
    return { section, landingPublished, pages };
  }).filter(({ landingPublished, pages }) => landingPublished || pages.length > 0);

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map(({ section, landingPublished, pages }) => {
        const title = t(`explore.${section}.title` as 'explore.about.title');
        return (
          <section
            key={section}
            className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-6 shadow-panel"
          >
            <h2 className="text-heading">
              {landingPublished ? (
                <a
                  href={localizedPath(locale, `/explore/${section}`)}
                  className="text-foreground no-underline hover:underline hover:underline-offset-4"
                >
                  {title}
                </a>
              ) : (
                title
              )}
            </h2>
            {pages.length === 0 ? null : (
              <ul className="flex list-none flex-col gap-1 p-0">
                {pages.map((slug) => (
                  <li key={slug}>
                    <a
                      href={exploreHrefOf(locale, section, slug)}
                      className="inline-flex min-h-10 items-center text-action underline-offset-4 hover:underline"
                    >
                      {t(
                        `explore.${section}.pages.${slug}` as 'explore.about.pages.vision',
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
