import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import type { TopicView } from '@minhaj/contracts/taxonomy';

import { taxonomyRuntime } from '@/composition/taxonomy';
import { Breadcrumbs, Container, EmptyState, MetaRow, PageHero } from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/topics` — the canonical taxonomy browser (ROUTE_MAP.md §3.1).
 *
 * THE TREE, ONE BOUNDED READ. Taxonomy's own listing returns the active tree to
 * its accepted depth and row bound in one call per level, already ordered; this
 * page only nests it. Each topic links to its hub.
 *
 * PRESENTED AS STRUCTURE. Every top-level topic is a branch with its own
 * heading, and its descendants hang beneath it on a rule, so the shape of the
 * taxonomy is visible at a glance. The figures are counts of the tree this page
 * already holds — nothing is estimated.
 *
 * DYNAMIC, because topics are records an administrator changes.
 */
export const dynamic = 'force-dynamic';

interface TopicsParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: TopicsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'topics' });

  return shellMetadata({
    locale,
    route: requireRoute('topics'),
    title: t('title'),
    description: t('description'),
  });
}

/** The address of one topic's hub. */
function hubPath(locale: string, topic: TopicView): string {
  return `/${locale}/topics/${encodeURIComponent(topic.slug)}`;
}

export default async function TopicsPage({ params }: TopicsParams) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'topics' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const tree = await taxonomyRuntime().taxonomy.listTree({
    locale,
    includeArchived: false,
  });
  const childrenOf = (parentId: string | null) =>
    tree.filter((topic) => topic.parentId === parentId);
  const roots = childrenOf(null);

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs
            label={shell('nav.breadcrumbs')}
            trail={[
              { href: `/${locale}`, text: shell('nav.home') },
              { text: t('title') },
            ]}
          />
        </div>
      </Container>

      <PageHero eyebrow={t('index.eyebrow')} title={t('title')} lede={t('intro')}>
        {roots.length === 0 ? null : (
          <MetaRow
            items={[
              t('index.roots', { count: roots.length }),
              t('index.total', { count: tree.length }),
            ]}
          />
        )}
      </PageHero>

      <Container>
        <div className="py-[var(--space-section)]">
          {roots.length === 0 ? (
            <EmptyState>{t('empty')}</EmptyState>
          ) : (
            <ul
              aria-label={t('title')}
              className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3"
            >
              {roots.map((root) => {
                const children = childrenOf(root.id);
                return (
                  <li
                    key={root.id}
                    className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
                  >
                    <h2 className="text-subheading font-semibold wrap-anywhere">
                      <a
                        href={hubPath(locale, root)}
                        lang={root.label.resolvedLocale}
                        dir={directionOf(root.label.resolvedLocale)}
                        className="inline-flex min-h-11 items-center text-[color:var(--color-foreground)] underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:decoration-[color:var(--color-action)] active:text-[color:var(--color-action)]"
                      >
                        {root.label.name}
                      </a>
                    </h2>
                    {root.label.description === null ? null : (
                      <p
                        className="line-clamp-3 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
                        lang={root.label.resolvedLocale}
                        dir={directionOf(root.label.resolvedLocale)}
                      >
                        {root.label.description}
                      </p>
                    )}
                    {children.length === 0 ? null : (
                      <>
                        <MetaRow
                          items={[t('index.children', { count: children.length })]}
                        />
                        <ul className="flex list-none flex-col border-s-2 border-[color:var(--color-accent-rule)] p-0 ps-3">
                          {children.map((child) => (
                            <Branch
                              key={child.id}
                              topic={child}
                              locale={locale}
                              tree={tree}
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Container>
    </>
  );
}

/** One topic and its descendants, nested by the tree Taxonomy already ordered. */
function Branch({
  topic,
  locale,
  tree,
}: {
  readonly topic: TopicView;
  readonly locale: string;
  readonly tree: readonly TopicView[];
}) {
  const children = tree.filter((entry) => entry.parentId === topic.id);
  return (
    <li className="flex min-w-0 flex-col">
      <a
        href={hubPath(locale, topic)}
        lang={topic.label.resolvedLocale}
        dir={directionOf(topic.label.resolvedLocale)}
        className="inline-flex min-h-11 items-center text-sm font-medium wrap-anywhere text-[color:var(--color-action)] underline-offset-4 hover:underline active:text-[color:var(--color-action-hover)]"
      >
        {topic.label.name}
      </a>
      {children.length === 0 ? null : (
        <ul className="flex list-none flex-col border-s border-[color:var(--color-border)] p-0 ps-3">
          {children.map((child) => (
            <Branch key={child.id} topic={child} locale={locale} tree={tree} />
          ))}
        </ul>
      )}
    </li>
  );
}
