import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { targetKey } from '@minhaj/contracts/personalisation';

import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { PersonalTime, TargetTitle, refusalMessages } from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { ActionLink, Alert, EmptyState } from '@/components/ui';
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
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'quran');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function QuranProgressPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, '/my/progress/quran'),
  );
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-quran-progress', () =>
    personalisationRuntime().history.quranProgress({ accountId: session.account.id }),
  );
  const description = (
    <>
      <p>{t('progress.description')}</p>
      <p>{t('progress.howTo')}</p>
    </>
  );

  if (!read.ok)
    return (
      <MyPage title={t('progress.title')} description={description}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const progress = read.value;
  if (progress === null)
    return (
      <MyPage title={t('progress.title')} description={description}>
        <EmptyState
          icon="bookmark"
          action={{ href: localizedPath(locale, '/quran'), text: t('progress.browse') }}
        >
          {t('progress.empty')}
        </EmptyState>
      </MyPage>
    );

  const target = { kind: 'ayah' as const, surah: progress.surah, ayah: progress.ayah };
  const resolved = (await resolvePersonalTargets([target], locale)).get(
    targetKey(target),
  );

  return (
    <MyPage title={t('progress.title')} description={description}>
      <section
        aria-labelledby="quran-position"
        className="flex min-w-0 flex-col gap-4 rounded-panel bg-ink p-6 text-ink-foreground sm:p-8"
      >
        <h2 id="quran-position" className="text-sm font-semibold text-ink-muted">
          {t('progress.position')}
        </h2>
        <p className="font-serif text-title font-semibold text-balance [&_a]:text-ink-foreground [&_a]:decoration-ink-accent [&_span]:text-ink-muted">
          <TargetTitle resolved={resolved} t={t} />
        </p>
        <p className="text-sm text-ink-muted">
          {t('progress.updatedAt')}{' '}
          <PersonalTime
            value={progress.updatedAt}
            locale={locale}
            timeZone={session.account.timezone}
          />
        </p>
        {resolved?.status === 'available' ? (
          <div>
            <ActionLink href={resolved.href} onInk>
              {t('progress.continue')}
            </ActionLink>
          </div>
        ) : null}
      </section>

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
    </MyPage>
  );
}
