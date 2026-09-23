import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import type { TopicView } from '@minhaj/contracts/taxonomy';

import { taxonomyRuntime } from '@/composition/taxonomy';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  TextLink,
} from '@/components/ui';
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
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[{ href: `/${locale}`, text: shell('nav.home') }, { text: t('title') }]}
        />

        <div className="flex flex-col gap-2">
          <PageHeading>{t('title')}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">{t('intro')}</p>
        </div>

        {roots.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <ul aria-label={t('title')} className="grid gap-4 sm:grid-cols-2">
            {roots.map((root) => (
              <Panel as="li" key={root.id}>
                <div className="flex flex-col gap-2">
                  <p className="font-semibold">
                    <TextLink href={`/${locale}/topics/${encodeURIComponent(root.slug)}`}>
                      <span
                        lang={root.label.resolvedLocale}
                        dir={directionOf(root.label.resolvedLocale)}
                      >
                        {root.label.name}
                      </span>
                    </TextLink>
                  </p>
                  {root.label.description === null ? null : (
                    <p
                      className="text-sm text-[color:var(--color-foreground-muted)]"
                      lang={root.label.resolvedLocale}
                      dir={directionOf(root.label.resolvedLocale)}
                    >
                      {root.label.description}
                    </p>
                  )}
                  {childrenOf(root.id).length === 0 ? null : (
                    <ul className="flex flex-col gap-2 ps-4 text-sm">
                      {childrenOf(root.id).map((child) => (
                        <Branch
                          key={child.id}
                          topic={child}
                          locale={locale}
                          tree={tree}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </div>
    </Container>
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
    <li className="flex flex-col gap-2">
      <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
        <span
          lang={topic.label.resolvedLocale}
          dir={directionOf(topic.label.resolvedLocale)}
        >
          {topic.label.name}
        </span>
      </TextLink>
      {children.length === 0 ? null : (
        <ul className="flex flex-col gap-2 ps-5">
          {children.map((child) => (
            <Branch key={child.id} topic={child} locale={locale} tree={tree} />
          ))}
        </ul>
      )}
    </li>
  );
}
