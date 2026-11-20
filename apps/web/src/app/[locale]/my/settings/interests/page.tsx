import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import {
  PERSONAL_GOALS,
  PERSONAL_INTERESTS,
  type PersonalInterest,
} from '@minhaj/contracts/personalisation';

import { refusalMessages } from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import {
  Alert,
  Icon,
  Panel,
  SectionHeading,
  StatusBadge,
  TextLink,
  type IconName,
} from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
import { myTabs, myTrail } from '@/components/my/sections';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireActiveSession } from '../../guard';
import { saveInterestsAction, skipInterestsAction } from './actions';

/**
 * Interests & Goals — the optional personalisation onboarding, editable at any
 * time (ROUTE_MAP.md §5.1; INFORMATION_ARCHITECTURE.md §5; Phase 21).
 *
 * NEVER REQUIRED. Nothing on the platform waits on these answers; skipping is
 * a complete answer, and every public page reads the same either way.
 *
 * WHAT IS ASKED, AND WHAT IS NOT. A choice among the platform's public areas
 * and a few reading goals — nothing about who the person is, and nothing
 * inferred from what they read or watch (SECURITY_BASELINE.md §19.1). The
 * answers shape only the person's own My Minhaj pages. Account language and
 * time zone are Identity's, on their own page.
 *
 * MY MINHAJ PART 1: the trail, and each choice as a tile — the section's
 * picture, its name as the checkbox's whole label, and the tile marked when
 * chosen by its border and surface as well as the tick, never colour alone.
 * The form, its fields and its versioned save are unchanged.
 */

/** The picture beside each interest's name — decoration; the name is the label. */
const INTEREST_ICONS: Readonly<Record<PersonalInterest, IconName>> = {
  quran: 'book',
  hadith: 'list',
  library: 'book',
  watch: 'video',
  listen: 'audio',
  fatwa: 'mail',
  'news-events': 'news',
  'global-network': 'globe',
};

/** A checkbox as a tile; the whole tile is its label's target. */
const TILE =
  'relative flex min-h-14 items-center gap-3 rounded-panel border border-border bg-surface-raised px-4 py-3 text-sm transition-colors duration-[var(--duration-fast)] hover:border-border-strong has-[:checked]:border-action has-[:checked]:bg-accent-surface';
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'interests');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function InterestsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(
    locale,
    localizedPath(locale, '/my/settings/interests'),
  );
  const t = await getTranslations({ locale, namespace: 'personal' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const tabs = {
    label: my('tabs.label.settings'),
    items: myTabs(locale, 'settings', 'interests', (tab) => my(`tabs.${tab}`)),
  };
  const trail = {
    label: my('trail.label'),
    crumbs: myTrail(locale, my('trail.home'), [
      { path: '/settings/profile', text: my('trail.settings') },
      { text: t('interests.title') },
    ]),
  };
  const read = await personalRead('personal-onboarding', () =>
    personalisationRuntime().settings.settings({ accountId: session.account.id }),
  );
  const description = (
    <>
      <p>{t('interests.description')}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
        <li>{t('interests.ownPages')}</li>
        <li>{t('interests.notInferred')}</li>
        <li>
          {t('interests.language')}{' '}
          <TextLink href={localizedPath(locale, '/my/settings/language')}>
            {t('interests.languageLink')}
          </TextLink>
        </li>
      </ul>
    </>
  );

  if (!read.ok)
    return (
      <MyPage
        tabs={tabs}
        measure="reading"
        title={t('interests.title')}
        description={description}
        trail={trail}
      >
        <Alert tone="error">{t('failure.load')}</Alert>
      </MyPage>
    );

  const current = read.value;
  const messages = refusalMessages(t, { conflict: t('interests.conflict') });

  return (
    <MyPage
      tabs={tabs}
      measure="reading"
      title={t('interests.title')}
      description={description}
      trail={trail}
    >
      <p>
        <StatusBadge tone={current.onboarding === 'completed' ? 'positive' : 'neutral'}>
          {t(`interests.state.${current.onboarding ?? 'none'}`)}
        </StatusBadge>
      </p>

      <Panel>
        <ActionForm
          action={saveInterestsAction}
          submitLabel={t('interests.save')}
          pendingLabel={t('common.working')}
          messages={{ ...messages, success: t('interests.saved') }}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="version" value={current.version} />

          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 font-semibold">
              {t('interests.interestsLegend')}
            </legend>
            <p className="text-sm text-foreground-muted">
              {my('settings.interests.pick')}
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              {PERSONAL_INTERESTS.map((interest) => (
                <div key={interest} className={TILE}>
                  <input
                    id={`interest-${interest}`}
                    type="checkbox"
                    name="interest"
                    value={interest}
                    defaultChecked={current.interests.includes(interest)}
                    className="relative z-10 size-5 shrink-0"
                  />
                  <Icon
                    name={INTEREST_ICONS[interest]}
                    size={20}
                    className="shrink-0 text-accent"
                  />
                  <label
                    htmlFor={`interest-${interest}`}
                    className="min-w-0 font-medium after:absolute after:inset-0 after:content-['']"
                  >
                    {t(`interests.interest.${interest}`)}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-1 font-semibold">{t('interests.goalsLegend')}</legend>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              {PERSONAL_GOALS.map((goal) => (
                <div key={goal} className={TILE}>
                  <input
                    id={`goal-${goal}`}
                    type="checkbox"
                    name="goal"
                    value={goal}
                    defaultChecked={current.goals.includes(goal)}
                    className="relative z-10 size-5 shrink-0"
                  />
                  <label
                    htmlFor={`goal-${goal}`}
                    className="min-w-0 font-medium after:absolute after:inset-0 after:content-['']"
                  >
                    {t(`interests.goal.${goal}`)}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
        </ActionForm>
      </Panel>

      {current.onboarding === null ? (
        <section className="flex flex-col gap-3" aria-labelledby="interests-skip">
          <span id="interests-skip">
            <SectionHeading>{t('interests.skipHeading')}</SectionHeading>
          </span>
          <p className="text-sm text-foreground-muted">{t('interests.skipHelp')}</p>
          <div className="self-start">
            <ActionForm
              action={skipInterestsAction}
              submitLabel={t('interests.skip')}
              pendingLabel={t('common.working')}
              tone="secondary"
              messages={messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="version" value={current.version} />
            </ActionForm>
          </div>
        </section>
      ) : null}
    </MyPage>
  );
}
