import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import type { TopicView } from '@minhaj/contracts/taxonomy';

import { learningReadRuntime } from '@/composition/learning-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  Icon,
  PageHero,
  Stat,
  type IconName,
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
 * WHAT EACH TOPIC HOLDS, PER OWNER (Learn Part 2). Beside every topic, the
 * published Courses, books, videos and research filed under it — each count
 * one grouped read by its OWNER over the whole tree (Learning's
 * `topicCourseTotals`, Library's `topicTotals`, Media's `topicVideoTotals`),
 * under the very predicate of the read that topic's hub opens its shelf with,
 * so the number here is the number there. A topic's count is of what is filed
 * under IT, never summed from its narrower topics; a topic with nothing filed
 * says nothing. Taxonomy decides which topics exist; nothing here does.
 *
 * PRESENTED AS STRUCTURE. Every top-level topic is a branch with its own
 * heading, and its descendants hang beneath it on a rule, so the shape of the
 * taxonomy is visible at a glance.
 *
 * DYNAMIC, because topics are records an administrator changes and material is
 * published and withdrawn.
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

/** The owners counted beside each topic, in the order a learner reaches for them. */
const OWNERS = ['courses', 'books', 'videos', 'research'] as const;
type Owner = (typeof OWNERS)[number];
const OWNER_ICONS: Readonly<Record<Owner, IconName>> = {
  courses: 'calendar',
  books: 'book',
  videos: 'video',
  research: 'news',
};

/** What one topic holds, per owner; absent owners hold nothing. */
type Holdings = Readonly<Partial<Record<Owner, number>>>;

/** The address of one topic's hub. */
function hubPath(locale: string, topic: TopicView): string {
  return localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`);
}

export default async function TopicsPage({ params }: TopicsParams) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'topics' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const tree = await taxonomyRuntime().taxonomy.listTree({
    locale,
    includeArchived: false,
  });
  const ids = tree.map((topic) => topic.id);
  const [courses, library, videos] = await Promise.all([
    learningReadRuntime().topicCourseTotals(ids),
    libraryReadRuntime().topicTotals(ids),
    mediaReadRuntime().topicVideoTotals(ids),
  ]);
  const holdings = new Map<string, Record<string, number>>();
  const add = (owner: Owner, rows: readonly { topic: string; count: number }[]) => {
    for (const row of rows) {
      const entry = holdings.get(row.topic) ?? {};
      entry[owner] = row.count;
      holdings.set(row.topic, entry);
    }
  };
  add('courses', courses);
  add('books', library.works);
  add('videos', videos);
  add('research', library.research);
  const holdingsOf = (topic: TopicView): Holdings => holdings.get(topic.id) ?? {};

  const childrenOf = (parentId: string | null) =>
    tree.filter((topic) => topic.parentId === parentId);
  const roots = childrenOf(null);
  const withMaterial = tree.filter((topic) => holdings.has(topic.id)).length;

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs
            label={shell('nav.breadcrumbs')}
            trail={[
              { href: localizedPath(locale, ''), text: shell('nav.home') },
              { text: t('title') },
            ]}
          />
        </div>
      </Container>

      <PageHero eyebrow={t('index.eyebrow')} title={t('title')} lede={t('intro')}>
        {roots.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <Stat
              value={tree.length}
              label={t('index.statTopics', { count: tree.length })}
            />
            <Stat
              value={roots.length}
              label={t('index.statRoots', { count: roots.length })}
            />
            {withMaterial === 0 ? null : (
              <Stat
                value={withMaterial}
                label={t('index.statWithMaterial', { count: withMaterial })}
              />
            )}
          </div>
        )}
        {roots.length === 0 ? null : (
          <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
            {t('index.countsNote')}
          </p>
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
                    className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel"
                  >
                    <h2 className="text-subheading font-semibold wrap-anywhere">
                      <a
                        href={hubPath(locale, root)}
                        lang={root.label.resolvedLocale}
                        dir={directionOf(root.label.resolvedLocale)}
                        className="inline-flex min-h-11 items-center text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action active:text-action"
                      >
                        {root.label.name}
                      </a>
                    </h2>
                    {root.label.description === null ? null : (
                      <p
                        className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
                        lang={root.label.resolvedLocale}
                        dir={directionOf(root.label.resolvedLocale)}
                      >
                        {root.label.description}
                      </p>
                    )}
                    <HoldingsRow holdings={holdingsOf(root)} t={t} />
                    {children.length === 0 ? null : (
                      <>
                        <p className="text-caption text-foreground-muted">
                          {t('index.children', { count: children.length })}
                        </p>
                        <ul className="flex list-none flex-col border-s-2 border-accent-rule p-0 ps-3">
                          {children.map((child) => (
                            <Branch
                              key={child.id}
                              topic={child}
                              locale={locale}
                              tree={tree}
                              holdingsOf={holdingsOf}
                              t={t}
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

type TopicsTranslator = Awaited<ReturnType<typeof getTranslations<'topics'>>>;

/**
 * What a topic holds, owner by owner — each count in words with its icon, so
 * the meaning is never in the icon alone. Nothing for a topic that holds none.
 */
function HoldingsRow({
  holdings,
  t,
  compact = false,
}: {
  readonly holdings: Holdings;
  readonly t: TopicsTranslator;
  readonly compact?: boolean;
}) {
  const present = OWNERS.flatMap((owner) => {
    const count = holdings[owner];
    return count === undefined || count === 0 ? [] : [{ owner, count }];
  });
  if (present.length === 0) return null;
  return (
    <ul
      className={`flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-caption ${
        compact ? 'text-foreground-muted' : 'font-medium text-foreground'
      }`}
    >
      {present.map(({ owner, count }) => (
        <li key={owner} className="inline-flex items-center gap-1.5">
          <Icon name={OWNER_ICONS[owner]} size={16} className="shrink-0 text-accent" />
          {t(`index.holds.${owner}`, { count })}
        </li>
      ))}
    </ul>
  );
}

/** One topic and its descendants, nested by the tree Taxonomy already ordered. */
function Branch({
  topic,
  locale,
  tree,
  holdingsOf,
  t,
}: {
  readonly topic: TopicView;
  readonly locale: string;
  readonly tree: readonly TopicView[];
  readonly holdingsOf: (topic: TopicView) => Holdings;
  readonly t: TopicsTranslator;
}) {
  const children = tree.filter((entry) => entry.parentId === topic.id);
  return (
    <li className="flex min-w-0 flex-col pb-1">
      <a
        href={hubPath(locale, topic)}
        lang={topic.label.resolvedLocale}
        dir={directionOf(topic.label.resolvedLocale)}
        className="inline-flex min-h-11 items-center text-sm font-medium wrap-anywhere text-action underline-offset-4 hover:underline active:text-action-hover"
      >
        {topic.label.name}
      </a>
      <HoldingsRow holdings={holdingsOf(topic)} t={t} compact />
      {children.length === 0 ? null : (
        <ul className="flex list-none flex-col border-s border-border p-0 ps-3">
          {children.map((child) => (
            <Branch
              key={child.id}
              topic={child}
              locale={locale}
              tree={tree}
              holdingsOf={holdingsOf}
              t={t}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
