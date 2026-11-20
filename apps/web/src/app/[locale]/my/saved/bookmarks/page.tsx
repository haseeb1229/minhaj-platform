import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  PERSONAL_TARGET_KINDS,
  targetKey,
  type PersonalTargetKind,
} from '@minhaj/contracts/personalisation';

import { MyPage } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListFilters,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs, myTrail } from '@/components/my/sections';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import { encodeTarget } from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { savedLinks } from '@/components/personal/nav';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { unbookmarkAction } from '../actions';

/**
 * Bookmarks — the person's OWN saved pointers to Quran ayat, Hadith, articles,
 * videos and books (ROUTE_MAP.md §5.1; INFORMATION_ARCHITECTURE.md §5).
 *
 * Each row is a typed reference resolved by its owner now: a title linking to
 * the public page, or the honest "no longer available" when the owner no
 * longer shows it to anybody — and a removal that works either way.
 *
 * MY MINHAJ PART 1: counted kinds as tabs (`?kind=`), "Showing n–m of N" and
 * numbered pages (`?page=`), one address per view (`list-view.ts`) — a filter
 * the list does not have is refused here, never widened — and a removal said
 * aloud once the row has gone (`announce`). The counts and the page are the
 * signed-in account's own, read by the session; no parameter names an owner.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'bookmarks');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function BookmarksPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/saved/bookmarks');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const related = { label: t('nav.label'), links: savedLinks(locale, t) };
  const spec: MyListSpec<PersonalTargetKind> = {
    path,
    param: 'kind',
    filters: PERSONAL_TARGET_KINDS,
  };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const frame = {
    related,
    title: t('bookmarks.title'),
    description: <p>{t('bookmarks.description')}</p>,
    tabs: {
      label: my('tabs.label.saved'),
      items: myTabs(locale, 'saved', 'bookmarks', (key) => my(`tabs.${key}`)),
    },
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [
        { path: '/saved', text: my('trail.saved') },
        { text: t('bookmarks.title') },
      ]),
    },
  };

  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );

  const view = asked.view;
  const actor = { accountId: session.account.id };
  const { saved } = personalisationRuntime();
  const read = await personalRead('personal-bookmarks', () =>
    Promise.all([
      saved.bookmarks(actor, myListOffset(view.page), view.filter),
      saved.bookmarkKinds(actor),
    ]),
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [page, kinds] = read.value;
  const everything = PERSONAL_TARGET_KINDS.reduce((sum, kind) => sum + kinds[kind], 0);
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const timeZone = session.account.timezone;
  const number = new Intl.NumberFormat(locale);
  const range = myListRange(view.page, page.items.length);

  return (
    <MyPage
      {...frame}
      announce={{
        value: `${view.filter ?? 'all'}:${String(page.total)}`,
        message: my('live.list', { count: page.total }),
      }}
    >
      {everything === 0 ? null : (
        <div className="flex flex-col gap-3">
          <MyListFilters
            label={my('list.kinds')}
            spec={spec}
            current={view.filter}
            format={(count) => number.format(count)}
            items={[
              { value: null, text: my('list.allKinds'), count: everything },
              ...PERSONAL_TARGET_KINDS.map((kind) => ({
                value: kind,
                text: my(`kinds.${kind}`),
                count: kinds[kind],
              })),
            ]}
          />
          {range === null ? null : (
            <MyListStatus>
              {my('count.bookmarks', { ...range, total: page.total })}
            </MyListStatus>
          )}
        </div>
      )}

      {page.items.length === 0 ? (
        everything === 0 ? (
          <EmptyState
            icon="bookmark"
            title={my('saved.emptyTitle')}
            action={{
              href: localizedPath(locale, '/library'),
              text: my('saved.explore'),
            }}
          >
            {t('bookmarks.empty')}
          </EmptyState>
        ) : page.total === 0 ? (
          <EmptyState
            icon="bookmark"
            title={my('list.noneOfKind')}
            action={{ href: path, text: my('list.all') }}
          >
            {my('bookmarks.noneOfKind', {
              kind: view.filter === null ? '' : my(`kinds.${view.filter}`),
            })}
          </EmptyState>
        ) : (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: view.filter })}
            firstText={my('list.first')}
          />
        )
      ) : (
        <ol
          aria-label={t('bookmarks.list')}
          className="flex flex-col border-t border-border"
        >
          {page.items.map((entry) => (
            <TargetItem
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
                  date: shortDate(new Date(entry.bookmarkedAt), locale, timeZone),
                }),
              ]}
              actions={
                <ActionForm
                  action={unbookmarkAction}
                  submitLabel={t('bookmarks.remove')}
                  pendingLabel={t('common.working')}
                  tone="secondary"
                  messages={refusalMessages(t)}
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="target" value={encodeTarget(entry.target)} />
                </ActionForm>
              }
            />
          ))}
        </ol>
      )}

      <MyListPager
        label={t('bookmarks.list')}
        spec={spec}
        view={view}
        total={page.total}
        locale={locale}
        words={{
          previous: t('list.previous'),
          next: t('list.next'),
          page: (number) => my('list.page', { page: number }),
        }}
      />
    </MyPage>
  );
}
