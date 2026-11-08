import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { PERSONAL_LIMITS, targetKey } from '@minhaj/contracts/personalisation';

import { pageLinks } from '@/components/hadith/presentation';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs } from '@/components/my/sections';
import { TargetItem } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { refusalMessages } from '@/components/personal/parts';
import {
  encodeTarget,
  personalOffsetHref,
  readPersonalOffset,
} from '@/components/personal/presentation';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Pager } from '@/components/ui';
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
  const related = { label: t('nav.label'), links: savedLinks(locale, t) };
  const my = await getTranslations({ locale, namespace: 'my' });
  const offset = readPersonalOffset(await searchParams);
  const read = await personalRead('personal-bookmarks', () =>
    personalisationRuntime().saved.bookmarks({ accountId: session.account.id }, offset),
  );
  const tabs = {
    label: my('tabs.label.saved'),
    items: myTabs(locale, 'saved', 'bookmarks', (key) => my(`tabs.${key}`)),
  };

  if (!read.ok)
    return (
      <MyPage related={related} title={t('bookmarks.title')} tabs={tabs}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const page = read.value;
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);
  const timeZone = session.account.timezone;

  return (
    <MyPage
      related={related}
      title={t('bookmarks.title')}
      description={<p>{t('bookmarks.description')}</p>}
      tabs={tabs}
    >
      {page.items.length === 0 ? (
        page.total === 0 ? (
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
        ) : (
          <EmptyState>{t('list.beyond')}</EmptyState>
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

      <Pager
        label={t('bookmarks.list')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />
    </MyPage>
  );
}
