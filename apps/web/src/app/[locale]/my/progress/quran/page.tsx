import { getTranslations } from 'next-intl/server';

import { targetKey } from '@minhaj/contracts/personalisation';

import { accountLink } from '@/components/personal/nav';
import {
  PersonalFrame,
  PersonalLinks,
  PersonalTime,
  TargetTitle,
  refusalMessages,
} from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { Alert, DetailRow, EmptyState, Panel, TextLink } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { resolvePersonalTargets } from '@/composition/personal-targets';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { clearQuranProgressAction } from '../actions';

/**
 * Quran reading progress — the ONE position the person set (ROUTE_MAP.md §5.1;
 * DOMAIN_MODEL.md §14.1 ReadingProgress; Phase 21).
 *
 * SET BY THE READER, NEVER BY A PAGE VIEW. It moves only when the person
 * chooses "Set as my reading position" on an Ayah page, so it is never a
 * record of what they happened to open. Course progress is Learning's
 * (Phase 22): it lives beside this page at `/my/progress/courses`, read
 * through Learning's own runtime, and is not on this page.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function QuranProgressPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, `/${locale}/my/progress/quran`);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-quran-progress', () =>
    personalisationRuntime().history.quranProgress({ accountId: session.account.id }),
  );
  const back = <PersonalLinks label={t('nav.label')} links={accountLink(locale, t)} />;
  const description = (
    <>
      <p>{t('progress.description')}</p>
      <p>{t('progress.howTo')}</p>
    </>
  );

  if (!read.ok)
    return (
      <PersonalFrame title={t('progress.title')} description={description} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const progress = read.value;
  if (progress === null)
    return (
      <PersonalFrame title={t('progress.title')} description={description} back={back}>
        <EmptyState>{t('progress.empty')}</EmptyState>
        <p>
          <TextLink href={`/${locale}/quran`}>{t('progress.browse')}</TextLink>
        </p>
      </PersonalFrame>
    );

  const target = { kind: 'ayah' as const, surah: progress.surah, ayah: progress.ayah };
  const resolved = (await resolvePersonalTargets([target], locale)).get(
    targetKey(target),
  );

  return (
    <PersonalFrame title={t('progress.title')} description={description} back={back}>
      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('progress.position')}>
            <TargetTitle resolved={resolved} t={t} />
          </DetailRow>
          <DetailRow term={t('progress.updatedAt')}>
            <PersonalTime
              value={progress.updatedAt}
              locale={locale}
              timeZone={session.account.timezone}
            />
          </DetailRow>
        </dl>
        {resolved?.status === 'available' ? (
          <p className="mt-4">
            <TextLink href={resolved.href}>{t('progress.continue')}</TextLink>
          </p>
        ) : null}
      </Panel>

      <div className="self-start">
        <ActionForm
          action={clearQuranProgressAction}
          submitLabel={t('progress.clear')}
          pendingLabel={t('common.working')}
          tone="secondary"
          messages={refusalMessages(t, { conflict: t('progress.conflict') })}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="version" value={progress.version} />
        </ActionForm>
      </div>
    </PersonalFrame>
  );
}
