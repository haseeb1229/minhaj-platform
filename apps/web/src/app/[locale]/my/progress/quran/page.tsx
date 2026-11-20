import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { SURAH_AYAH_COUNTS, SURAH_TOTAL } from '@minhaj/contracts/passage';
import { targetKey } from '@minhaj/contracts/personalisation';

import { MyPage, MySection, ProgressMeter } from '@/components/my/frame';
import { MyListStatus } from '@/components/my/list-parts';
import { myPageMetadata } from '@/components/my/metadata';
import { quranPlace } from '@/components/my/quran-place';
import { myTrail } from '@/components/my/sections';
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
 * Quran reading position — the ONE position the person set (ROUTE_MAP.md §5.1;
 * DOMAIN_MODEL.md §14.1 ReadingProgress; Phase 21).
 *
 * SET BY THE READER, NEVER BY A PAGE VIEW. It moves only when the person
 * chooses "Set as my reading position" on an Ayah page, so it is never a
 * record of what they happened to open. Course progress is Learning's
 * (Phase 22): it lives beside this page at `/my/progress/courses`, read
 * through Learning's own runtime, and is not on this page.
 *
 * MY MINHAJ PART 1: where the position stands in the Mushaf — Surah n of 114,
 * ayah n of that Surah, and the ayah's place among all 6,236 — from the
 * Quran's fixed STRUCTURE (`@minhaj/contracts/passage`), never from what the
 * person read; the ways on (continue, the whole Surah, the Quran); how to set
 * it; and a confirmation before it is cleared.
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
  const my = await getTranslations({ locale, namespace: 'my' });
  const read = await personalRead('personal-quran-progress', () =>
    personalisationRuntime().history.quranProgress({ accountId: session.account.id }),
  );
  const frame = {
    title: t('progress.title'),
    description: <p>{t('progress.description')}</p>,
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: t('progress.title') }]),
    },
    related: {
      label: t('nav.label'),
      links: [
        { href: localizedPath(locale, '/quran'), text: my('quran.home') },
        {
          href: localizedPath(locale, '/my/saved/bookmarks?kind=ayah'),
          text: my('quran.bookmarks'),
        },
        {
          href: localizedPath(locale, '/my/history/reading?kind=ayah'),
          text: my('quran.read'),
        },
        {
          href: localizedPath(locale, '/my/progress/courses'),
          text: my('quran.courses'),
        },
      ],
    },
  };
  const howTo = (
    <MySection id="quran-how" heading={my('quran.howHeading')}>
      <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm">
        <li>{my('quran.how.open')}</li>
        <li>{my('quran.how.set')}</li>
        <li>{my('quran.how.back')}</li>
      </ol>
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('progress.howTo')}
      </p>
    </MySection>
  );

  if (!read.ok)
    return (
      <MyPage {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const progress = read.value;
  if (progress === null)
    return (
      <MyPage {...frame} announce={{ value: 'none', message: my('live.quranCleared') }}>
        <EmptyState
          icon="bookmark"
          title={my('quran.emptyTitle')}
          action={{ href: localizedPath(locale, '/quran'), text: t('progress.browse') }}
        >
          {t('progress.empty')}
        </EmptyState>
        {howTo}
      </MyPage>
    );

  const target = { kind: 'ayah' as const, surah: progress.surah, ayah: progress.ayah };
  const resolved = (await resolvePersonalTargets([target], locale)).get(
    targetKey(target),
  );
  const place = quranPlace(progress.surah, progress.ayah, SURAH_AYAH_COUNTS);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: place === null || place.percent >= 1 ? 0 : 1,
  });
  const available = resolved?.status === 'available';

  return (
    <MyPage
      {...frame}
      announce={{
        value: `${String(progress.version)}`,
        message: my('live.quranSet', { surah: progress.surah, ayah: progress.ayah }),
      }}
    >
      <section
        aria-labelledby="quran-position"
        className="flex min-w-0 flex-col gap-5 rounded-panel bg-ink p-6 text-ink-foreground sm:p-8"
      >
        <h2 id="quran-position" className="text-sm font-semibold text-ink-muted">
          {t('progress.position')}
        </h2>
        <p className="font-serif text-title font-semibold text-balance [&_a]:text-ink-foreground [&_a]:decoration-ink-accent [&_span]:text-ink-muted">
          <TargetTitle resolved={resolved} t={t} />
        </p>
        {place === null ? null : (
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
            {(
              [
                [
                  my('quran.surah'),
                  my('quran.ofTotal', {
                    value: number.format(progress.surah),
                    total: number.format(SURAH_TOTAL),
                  }),
                ],
                [
                  my('quran.ayah'),
                  my('quran.ofTotal', {
                    value: number.format(progress.ayah),
                    total: number.format(place.surahAyat),
                  }),
                ],
                [
                  my('quran.inQuran'),
                  my('quran.ofTotal', {
                    value: number.format(place.ordinal),
                    total: number.format(place.total),
                  }),
                ],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-caption text-ink-muted">{term}</dt>
                <dd className="font-serif text-subheading font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {place === null ? null : (
          <div className="[&_span]:text-ink-muted">
            <ProgressMeter percent={place.percent * 100}>
              {my('quran.through', { percent: percent.format(place.percent) })}
            </ProgressMeter>
          </div>
        )}
        <p className="text-sm text-ink-muted">
          {t('progress.updatedAt')}{' '}
          <PersonalTime
            value={progress.updatedAt}
            locale={locale}
            timeZone={session.account.timezone}
          />
        </p>
        {available ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <ActionLink href={resolved.href} onInk>
              {t('progress.continue')}
            </ActionLink>
            <a
              href={localizedPath(locale, `/quran/surah/${String(progress.surah)}`)}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-ink-foreground underline decoration-ink-accent underline-offset-4"
            >
              {my('quran.wholeSurah')}
            </a>
          </div>
        ) : (
          <MyListStatus>{my('quran.notShown')}</MyListStatus>
        )}
      </section>

      {howTo}

      <MySection
        id="quran-clear"
        heading={t('progress.clear')}
        intro={my('quran.clearHelp')}
      >
        <div className="self-start">
          <ActionForm
            action={clearQuranProgressAction}
            submitLabel={t('progress.clear')}
            pendingLabel={t('common.working')}
            tone="secondary"
            messages={refusalMessages(t, { conflict: t('progress.conflict') })}
            confirm={{
              title: my('confirm.quran.title'),
              body: my('confirm.quran.body'),
              confirmLabel: my('confirm.quran.confirm'),
              cancelLabel: my('confirm.cancel'),
            }}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="version" value={progress.version} />
          </ActionForm>
        </div>
      </MySection>
    </MyPage>
  );
}
