import { getTranslations } from 'next-intl/server';

import { PERSONAL_GOALS, PERSONAL_INTERESTS } from '@minhaj/contracts/personalisation';

import { settingsLinks } from '@/components/personal/nav';
import {
  PersonalFrame,
  PersonalLinks,
  refusalMessages,
} from '@/components/personal/parts';
import { personalRead } from '@/components/personal/read';
import { Alert, Panel, SectionHeading, StatusBadge, TextLink } from '@/components/ui';
import { personalisationRuntime } from '@/composition/personalisation';
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
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function InterestsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const session = await requireActiveSession(locale, `/${locale}/my/settings/interests`);
  const t = await getTranslations({ locale, namespace: 'personal' });
  const read = await personalRead('personal-onboarding', () =>
    personalisationRuntime().settings.settings({ accountId: session.account.id }),
  );
  const back = <PersonalLinks label={t('nav.label')} links={settingsLinks(locale, t)} />;
  const description = (
    <>
      <p>{t('interests.description')}</p>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
        <li>{t('interests.ownPages')}</li>
        <li>{t('interests.notInferred')}</li>
        <li>
          {t('interests.language')}{' '}
          <TextLink href={`/${locale}/my/settings/language`}>
            {t('interests.languageLink')}
          </TextLink>
        </li>
      </ul>
    </>
  );

  if (!read.ok)
    return (
      <PersonalFrame title={t('interests.title')} description={description} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const current = read.value;
  const messages = refusalMessages(t, { conflict: t('interests.conflict') });

  return (
    <PersonalFrame title={t('interests.title')} description={description} back={back}>
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

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t('interests.interestsLegend')}</legend>
            {PERSONAL_INTERESTS.map((interest) => (
              <div key={interest} className="flex items-start gap-2 text-sm">
                <input
                  id={`interest-${interest}`}
                  type="checkbox"
                  name="interest"
                  value={interest}
                  defaultChecked={current.interests.includes(interest)}
                  className="mt-1"
                />
                <label htmlFor={`interest-${interest}`}>
                  {t(`interests.interest.${interest}`)}
                </label>
              </div>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">{t('interests.goalsLegend')}</legend>
            {PERSONAL_GOALS.map((goal) => (
              <div key={goal} className="flex items-start gap-2 text-sm">
                <input
                  id={`goal-${goal}`}
                  type="checkbox"
                  name="goal"
                  value={goal}
                  defaultChecked={current.goals.includes(goal)}
                  className="mt-1"
                />
                <label htmlFor={`goal-${goal}`}>{t(`interests.goal.${goal}`)}</label>
              </div>
            ))}
          </fieldset>
        </ActionForm>
      </Panel>

      {current.onboarding === null ? (
        <section className="flex flex-col gap-3" aria-labelledby="interests-skip">
          <span id="interests-skip">
            <SectionHeading>{t('interests.skipHeading')}</SectionHeading>
          </span>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('interests.skipHelp')}
          </p>
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
    </PersonalFrame>
  );
}
