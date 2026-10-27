import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { EXPLORE_SECTIONS, exploreHrefOf, exploreSlugsOf } from '@/shell/explore';

/**
 * The Explore index — every section and its pages, on the `/explore` landing.
 *
 * The header's Explore mega menu groups the same allowlist into the IA's five
 * columns through `@/shell/menus`; this is the landing's own full index, one
 * column per section under a real heading. It is a Server Component, so it
 * ships neither the labels nor the route list to the browser.
 *
 * COLUMN PER SECTION, which is the shape INFORMATION_ARCHITECTURE.md §3.1 sets
 * out: a menu "presents structure and entry points; it is not an exhaustive
 * index of the section". Every entry resolves — the panel is built from the
 * allowlists the routes themselves validate against, so a link here and a 404
 * there cannot disagree.
 */
export async function ExplorePanel({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
      {EXPLORE_SECTIONS.map((section) => {
        const slugs = exploreSlugsOf(section);

        return (
          <div key={section} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-foreground-muted)]">
              <a
                href={`/${locale}/explore/${section}`}
                className="text-[color:var(--color-foreground)] underline underline-offset-2"
              >
                {t(`explore.${section}.title` as 'explore.about.title')}
              </a>
            </h2>

            {slugs.length === 0 ? null : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {slugs.map((slug) => (
                  <li key={slug}>
                    <a
                      href={exploreHrefOf(locale, section, slug)}
                      className="underline underline-offset-2"
                    >
                      {t(
                        `explore.${section}.pages.${slug}` as 'explore.about.pages.vision',
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
