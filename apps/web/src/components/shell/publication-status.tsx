import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

/**
 * The state a RESERVED route is in.
 *
 * Every Explore and legal route this phase reserves renders exactly this, and
 * exactly this is all it renders. It says, in the visitor's own language, that
 * the page has no published content yet — it does not stand in for the content,
 * summarise it, approximate it, or imply what it will say.
 *
 * WHY A PLACEHOLDER RATHER THAN NOTHING. The routes are part of the accepted
 * information architecture and the navigation that leads here has to lead
 * somewhere real, so the honest answer is an explicit, accessible "not yet
 * published" state rather than a 404 on a route that exists or a link that goes
 * nowhere (ROUTE_MAP.md §5.2).
 *
 * WHY IT IS NOT CONTENT. Organisational facts — vision, mission, history,
 * governance, leadership — and legal document bodies are Minhaj-owned content
 * published through the Phase-6 `Page` workflow with its review, permissions
 * and audit (OPEN_DECISIONS.md §2.3, §6.1). This notice is REPLACED by that
 * record; it is never promoted into one, never migrated, and it is never
 * presented as a statement by the organisation.
 *
 * NOT INDEXABLE, EITHER. A reserved route is `excluded` in the registry, so it
 * carries no canonical link, no `hreflang` alternates and no sitemap entry — a
 * page with nothing on it is not a resource to advertise (ROUTE_MAP.md §9.4).
 */
export async function PublicationStatus({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <aside
      aria-labelledby="publication-status-heading"
      className="max-w-[var(--measure-prose)] rounded-[var(--radius-panel)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] p-5"
    >
      <h2 id="publication-status-heading" className="text-sm font-semibold">
        {t('reserved.heading')}
      </h2>
      <p className="mt-2 text-sm text-[color:var(--color-foreground-muted)]">
        {t('reserved.body')}
      </p>
    </aside>
  );
}
