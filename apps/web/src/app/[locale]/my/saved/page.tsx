import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { targetKey } from '@minhaj/contracts/personalisation';

import { MyPage, MySection } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTabs } from '@/components/my/sections';
import { TargetCard } from '@/components/my/targets';
import { shortDate } from '@/components/my/time';
import { personalRead } from '@/components/personal/read';
import { Alert, EmptyState, Stat } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
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

export default async function SavedPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, localizedPath(locale, '/my/saved'));
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const actor = { accountId: session.account.id };
  const { saved } = personalisationRuntime();
  const read = await personalRead('personal-saved-overview', () =>
    Promise.all([saved.counts(actor), saved.recent(actor, RECENT)]),
  );
  const tabs = {
    label: my('tabs.label.saved'),
    items: myTabs(locale, 'saved', 'saved', (key) => my(`tabs.${key}`)),
  };

  if (!read.ok)
    return (
      <MyPage title={t('saved.title')} tabs={tabs}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const [counts, recent] = read.value;
  const titles = await resolvePersonalTargets(
    recent.map((entry) => entry.target),
    locale,
  );
  const timeZone = session.account.timezone;

  return (
    <MyPage
      title={t('saved.title')}
      description={<p>{t('saved.description')}</p>}
      tabs={tabs}
    >
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
                value={count}
                label={t(`saved.${key}`)}
                href={localizedPath(locale, path)}
              />
            </dd>
          </div>
        ))}
      </dl>

      <MySection id="saved-recent" heading={t('saved.recent')}>
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
    </MyPage>
  );
}
