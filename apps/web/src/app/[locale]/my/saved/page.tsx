import { getTranslations } from 'next-intl/server';

import { targetKey } from '@minhaj/contracts/personalisation';

import {
  KindBadge,
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  TargetTitle,
} from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  DetailRow,
  EmptyState,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../guard';
import { savedLinks } from '@/components/personal/nav';

/**
 * Saved — the overview of what the person keeps (ROUTE_MAP.md §5.1;
 * Personalisation-owned, Phase 21): how many bookmarks, notes and private
 * collections there are, the most recently saved targets, and the way into
 * each list.
 *
 * KEYED BY THE SESSION. Every read names the signed-in account; no URL
 * parameter names whose saved items these are. Titles are their owners'
 * answers, asked now — a target its owner no longer shows anybody says so.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const RECENT = 5;

export default async function SavedPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, `/${locale}/my/saved`);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const actor = { accountId: session.account.id };
  const { saved } = personalisationRuntime();
  const read = await personalRead('personal-saved-overview', () =>
    Promise.all([saved.counts(actor), saved.recent(actor, RECENT)]),
  );
  const back = <PersonalLinks label={t('nav.label')} links={savedLinks(locale, t)} />;

  if (!read.ok)
    return (
      <PersonalFrame title={t('saved.title')} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const [counts, recent] = read.value;
  const titles = await resolvePersonalTargets(
    recent.map((entry) => entry.target),
    locale,
  );

  return (
    <PersonalFrame
      title={t('saved.title')}
      description={<p>{t('saved.description')}</p>}
      back={back}
    >
      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('saved.bookmarks')}>
            <TextLink href={`/${locale}/my/saved/bookmarks`}>{counts.bookmarks}</TextLink>
          </DetailRow>
          <DetailRow term={t('saved.notes')}>
            <TextLink href={`/${locale}/my/saved/notes`}>{counts.notes}</TextLink>
          </DetailRow>
          <DetailRow term={t('saved.collections')}>
            <TextLink href={`/${locale}/my/saved/collections`}>
              {counts.collections}
            </TextLink>
          </DetailRow>
        </dl>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="saved-recent">
        <span id="saved-recent">
          <SectionHeading>{t('saved.recent')}</SectionHeading>
        </span>
        {recent.length === 0 ? (
          <EmptyState>{t('saved.empty')}</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {recent.map((entry) => (
              <Panel key={entry.savedItemId} as="li">
                <div className="flex flex-col gap-2">
                  <TargetTitle resolved={titles.get(targetKey(entry.target))} t={t} />
                  <div className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-foreground-muted)]">
                    <KindBadge kind={entry.target.kind} t={t} />
                    <span>
                      {t('target.savedAt')}{' '}
                      <PersonalTime
                        value={entry.savedAt}
                        locale={locale}
                        timeZone={session.account.timezone}
                      />
                    </span>
                  </div>
                </div>
              </Panel>
            ))}
          </ol>
        )}
      </section>
    </PersonalFrame>
  );
}
