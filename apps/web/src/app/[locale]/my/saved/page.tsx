import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { PERSONAL_TARGET_KINDS, targetKey } from '@minhaj/contracts/personalisation';

import { MyPage, MySection } from '@/components/my/frame';
import { myListHref } from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { TargetCard } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Icon, MetaRow, Stat } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { savedLinks } from '@/components/personal/nav';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../guard';

/**
 * Saved — the overview of what the person keeps (ROUTE_MAP.md §5.1;
 * Personalisation-owned, Phase 21; redesigned in R2): how many bookmarks,
 * notes and private collections there are, the most recently saved targets,
 * and the way into each list.
 *
 * KEYED BY THE SESSION. Every read names the signed-in account; no URL
 * parameter names whose saved items these are. Titles are their owners'
 * answers, asked now — a target its owner no longer shows anybody says so.
 *
 * MY MINHAJ PART 1: the four Saved views as tabs, the bookmarks counted by
 * kind (each a way into that filtered list), and the collections most
 * recently changed — every figure the account's own, read now.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'saved');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const RECENT = 12;
const COLLECTIONS = 4;

export default async function SavedPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, localizedPath(locale, '/my/saved'));
  const t = await getTranslations({ locale, namespace: 'personal' });
  const related = { label: t('nav.label'), links: savedLinks(locale, t) };
  const my = await getTranslations({ locale, namespace: 'my' });
  const actor = { accountId: session.account.id };
  const { saved } = personalisationRuntime();
  const read = await personalRead('personal-saved-overview', () =>
    Promise.all([
      saved.counts(actor),
      saved.recent(actor, RECENT),
      saved.bookmarkKinds(actor),
      saved.collections(actor),
    ]),
  );
  const frame = {
    related,
    title: t('saved.title'),
    description: <p>{t('saved.description')}</p>,
    tabs: {
      label: my('tabs.label.saved'),
      items: myTabs(locale, 'saved', 'saved', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: t('saved.title') }]),
    },
  };

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [counts, recent, kinds, collections] = read.value;
  const titles = await resolvePersonalTargets(
    recent.map((entry) => entry.target),
    locale,
  );
  const timeZone = session.account.timezone;
  const number = new Intl.NumberFormat(locale);
  const bookmarksPath = localizedPath(locale, '/my/saved/bookmarks');
  const held = PERSONAL_TARGET_KINDS.filter((kind) => kinds[kind] > 0);

  return (
    <MyPage {...frame}>
      <dl className="grid grid-cols-3 gap-4 rounded-panel border border-border bg-surface-raised p-5 shadow-panel">
        {(
          [
            ['bookmarks', counts.bookmarks, '/my/saved/bookmarks'],
            ['notes', counts.notes, '/my/saved/notes'],
            ['collections', counts.collections, '/my/saved/collections'],
          ] as const
        ).map(([key, count, path]) => (
          <div key={key} className="min-w-0">
            <dt className="sr-only">{t(`saved.${key}`)}</dt>
            <dd>
              <Stat
                value={number.format(count)}
                label={t(`saved.${key}`)}
                href={localizedPath(locale, path)}
              />
            </dd>
          </div>
        ))}
      </dl>

      {held.length === 0 ? null : (
        <nav aria-labelledby="saved-kinds" className="flex flex-col gap-3">
          <h2 id="saved-kinds" className="text-base font-semibold">
            {my('saved.byKind')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {held.map((kind) => (
              <li key={kind}>
                <a
                  href={myListHref(
                    { path: bookmarksPath, param: 'kind' },
                    { page: 1, filter: kind },
                  )}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-strong bg-surface-raised px-4 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:border-action hover:text-action"
                >
                  {my(`kinds.${kind}`)}
                  <span className="text-caption text-foreground-muted tabular-nums">
                    {number.format(kinds[kind])}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <MySection
        id="saved-recent"
        heading={t('saved.recent')}
        {...(counts.bookmarks === 0
          ? {}
          : { link: { href: bookmarksPath, text: my('saved.allBookmarks') } })}
      >
        {recent.length === 0 ? (
          <EmptyState
            icon="bookmark"
            title={my('saved.emptyTitle')}
            action={{
              href: localizedPath(locale, '/library'),
              text: my('saved.explore'),
            }}
          >
            {t('saved.empty')}
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
            {recent.map((entry) => (
              <TargetCard
                key={entry.savedItemId}
                kind={entry.target.kind}
                resolved={titles.get(targetKey(entry.target))}
                words={{
                  kind: (kind) => t(`kinds.${kind}`),
                  unavailable: t('target.unavailable'),
                  unknown: t('target.unknown'),
                }}
                meta={[
                  my('saved.when', {
                    date: shortDate(new Date(entry.savedAt), locale, timeZone),
                  }),
                ]}
              />
            ))}
          </ul>
        )}
      </MySection>

      <MySection
        id="saved-collections"
        heading={t('collections.title')}
        intro={t('collections.description')}
        link={{
          href: localizedPath(locale, '/my/saved/collections'),
          text:
            collections.length === 0
              ? t('collections.create')
              : my('saved.allCollections', { count: collections.length }),
        }}
      >
        {collections.length === 0 ? (
          <p className="text-sm text-foreground-muted">{my('saved.noCollections')}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            {collections.slice(0, COLLECTIONS).map((collection) => (
              <li
                key={collection.id}
                className="flex min-w-0 items-start gap-3 rounded-panel border border-border bg-surface-raised p-4"
              >
                <Icon name="grid" size={20} className="mt-0.5 shrink-0 text-accent" />
                <div className="flex min-w-0 flex-col gap-1">
                  <a
                    href={localizedPath(locale, `/my/saved/collections/${collection.id}`)}
                    dir="auto"
                    className="w-fit max-w-full font-semibold wrap-anywhere text-foreground underline decoration-accent-rule underline-offset-4 hover:decoration-action"
                  >
                    {collection.title}
                  </a>
                  <MetaRow
                    items={[
                      my('collections.items', { count: collection.itemCount }),
                      my('collections.changed', {
                        date: shortDate(new Date(collection.updatedAt), locale, timeZone),
                      }),
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </MySection>
    </MyPage>
  );
}
