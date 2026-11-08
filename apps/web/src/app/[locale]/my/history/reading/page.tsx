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
import { historyLinks } from '@/components/personal/nav';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { removeReadAction } from '../actions';
import { ClearHistory, HistoryOffNotice } from '../shared';

/**
 * Reading history — what the person has read, most recent first, recorded
 * ONLY while they have history turned on (ROUTE_MAP.md §5.1; Phase 21).
 *
 * PRIVATE CONTINUITY, NOT ANALYTICS. One entry per item, the last time it was
 * read, kept only for the person themselves — and every entry, or all of them,
 * can be removed here.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'reading');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function ReadingHistoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/history/reading');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const related = { label: t('nav.label'), links: historyLinks(locale, t) };
  const my = await getTranslations({ locale, namespace: 'my' });
  const actor = { accountId: session.account.id };
  const offset = readPersonalOffset(await searchParams);
  const { history, settings } = personalisationRuntime();
  const read = await personalRead('personal-reading-history', () =>
    Promise.all([settings.settings(actor), history.reading(actor, offset)]),
  );
  const tabs = {
    label: my('tabs.label.history'),
    items: myTabs(locale, 'history', 'reading', (key) => my(`tabs.${key}`)),
  };

  if (!read.ok)
    return (
      <MyPage related={related} title={t('history.readingTitle')} tabs={tabs}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [current, page] = read.value;
  const titles = await resolvePersonalTargets(
    page.items.map((entry) => entry.target),
    locale,
  );
  const links = pageLinks(page.offset, PERSONAL_LIMITS.page, page.total);
  const timeZone = session.account.timezone;

  return (
    <MyPage
      related={related}
      title={t('history.readingTitle')}
      description={<p>{t('history.readingDescription')}</p>}
      tabs={tabs}
    >
      {current.historyEnabled ? null : <HistoryOffNotice locale={locale} t={t} />}

      {page.items.length === 0 ? (
        page.total === 0 ? (
          <EmptyState
            icon="book"
            title={my('history.emptyTitle')}
            action={{
              href: localizedPath(locale, '/library'),
              text: my('saved.explore'),
            }}
          >
            {t('history.readingEmpty')}
          </EmptyState>
        ) : (
          <EmptyState>{t('list.beyond')}</EmptyState>
        )
      ) : (
        <ol
          aria-label={t('history.readingList')}
          className="flex flex-col border-t border-border"
        >
          {page.items.map((entry) => (
            <TargetItem
              key={targetKey(entry.target)}
              kind={entry.target.kind}
              resolved={titles.get(targetKey(entry.target))}
              words={{
                kind: (kind) => t(`kinds.${kind}`),
                unavailable: t('target.unavailable'),
                unknown: t('target.unknown'),
              }}
              meta={[
                my('history.read', {
                  date: shortDate(new Date(entry.lastReadAt), locale, timeZone),
                }),
              ]}
              actions={
                <ActionForm
                  action={removeReadAction}
                  submitLabel={t('history.remove')}
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
        label={t('history.readingList')}
        previous={
          links.previous === null ? null : personalOffsetHref(path, links.previous)
        }
        next={links.next === null ? null : personalOffsetHref(path, links.next)}
        previousLabel={t('list.previous')}
        nextLabel={t('list.next')}
      />

      {page.total === 0 ? null : <ClearHistory locale={locale} t={t} />}
    </MyPage>
  );
}
