import { localizedPath, type Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { EXPLORE_SECTIONS, exploreHrefOf, exploreSlugsOf } from '@/shell/explore';

/**
 * THE ORGANISATION INDEX on `/explore` — every section and every page it
 * reserves, one panel per section under a real heading.
 *
 * THE WHOLE INDEX, ALWAYS (restored after R2, owner direction 2026-11-08).
 * R1 had narrowed this index to published pages only; the owner wants the
 * organisation's full structure visible again, as it was before R1. Every
 * entry resolves — the panel is built from the allowlists the routes
 * themselves validate against, so a link here and a 404 there cannot
 * disagree — and a page not yet published renders its honest
 * publication-status state when visited (ROUTE_MAP.md §5.2). A page an owner
 * delivers elsewhere (the newsletter) links to that owner's page.
 *
 * A Server Component: it ships neither the labels nor the route list to the
 * browser, and it reads nothing but code, so a content read that fails cannot
 * take the index down with it.
 */
export async function ExplorePanel({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {EXPLORE_SECTIONS.map((section) => {
        const slugs = exploreSlugsOf(section);
        return (
          <section
            key={section}
            className="flex flex-col gap-3 rounded-panel border border-border bg-surface-raised p-6 shadow-panel"
          >
            <h3 className="text-heading">
              <a
                href={localizedPath(locale, `/explore/${section}`)}
                className="text-foreground no-underline hover:underline hover:underline-offset-4"
              >
                {t(`explore.${section}.title` as 'explore.about.title')}
              </a>
            </h3>
            {slugs.length === 0 ? null : (
              <ul className="flex list-none flex-col gap-1 p-0">
                {slugs.map((slug) => (
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
