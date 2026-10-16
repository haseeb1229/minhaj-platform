import { getTranslations } from 'next-intl/server';

import type { ContributorCapabilities } from '@minhaj/contracts/identity';

import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { Alert, DetailRow, Panel, SectionHeading, TextLink } from '@/components/ui';
import { identityRuntime } from '@/composition/identity';
import { appLogger } from '@/composition/logging';
import { peopleReadRuntime } from '@/composition/people-read';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * The teacher's profile, READ-ONLY (ROUTE_MAP.md §6).
 *
 * THREE OWNERS, EACH ANSWERING ITS OWN QUESTION. People's public answer —
 * the published TeacherProfile's name, address, subjects and languages, or
 * none; Identity's live capability projection — what the account's current
 * roles approve; and the account's own name. NONE OF IT IS EDITABLE HERE:
 * a public profile is People's, kept by the editorial team, and the account
 * name is changed in the account's own settings. A profile grants nothing;
 * the projection is presentation, never a decision (DOMAIN_MODEL.md §5.2).
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const CAPABILITIES: readonly (keyof ContributorCapabilities)[] = [
  'canTeach',
  'canReceiveQuestions',
  'canReviewContent',
  'canIssueFatwa',
];

export default async function TeacherProfilePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, `/${locale}/teacher/profile`);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const accountId = gate.session.account.id;
  const read = await Promise.all([
    peopleReadRuntime().people.publicTeachers([accountId], locale),
    identityRuntime().authorization.contributorCapabilities(accountId),
  ]).then(
    ([profiles, capabilities]) => ({
      ok: true as const,
      profile: profiles[0],
      capabilities,
    }),
    () => {
      appLogger().error(
        { operation: 'teaching-profile' },
        'Teacher profile read failed.',
      );
      return { ok: false as const };
    },
  );

  return (
    <TeacherFrame
      title={t('profile.title')}
      description={<p>{t('profile.description')}</p>}
    >
      {!read.ok ? (
        <Alert tone="error">{t('profile.unavailable')}</Alert>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="profile-public">
            <span id="profile-public">
              <SectionHeading>{t('profile.publicHeading')}</SectionHeading>
            </span>
            {read.profile === undefined ? (
              <Alert tone="info">{t('profile.noProfile')}</Alert>
            ) : (
              <Panel>
                <dl className="flex flex-col">
                  <DetailRow term={t('profile.name')}>
                    <span lang={read.profile.nameLocale} dir="auto">
                      {read.profile.name}
                    </span>
                  </DetailRow>
                  <DetailRow term={t('profile.subjects')}>
                    {read.profile.subjects === null ? (
                      t('profile.none')
                    ) : (
                      <span dir="auto">{read.profile.subjects}</span>
                    )}
                  </DetailRow>
                  <DetailRow term={t('profile.languages')}>
                    {read.profile.languages.length === 0
                      ? t('profile.none')
                      : read.profile.languages.join(', ')}
                  </DetailRow>
                </dl>
                <p className="mt-3">
                  <TextLink
                    href={`/${locale}/people/${encodeURIComponent(read.profile.slug)}`}
                  >
                    {t('profile.publicPage')}
                  </TextLink>
                </p>
              </Panel>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="profile-capabilities">
            <span id="profile-capabilities">
              <SectionHeading>{t('profile.capabilitiesHeading')}</SectionHeading>
            </span>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('profile.capabilitiesHelp')}
            </p>
            <Panel>
              <dl className="flex flex-col">
                {CAPABILITIES.map((capability) => (
                  <DetailRow
                    key={capability}
                    term={t(`profile.capability.${capability}`)}
                  >
                    {read.capabilities[capability] ? t('profile.yes') : t('profile.no')}
                  </DetailRow>
                ))}
              </dl>
            </Panel>
          </section>
        </>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="profile-account">
        <span id="profile-account">
          <SectionHeading>{t('profile.accountHeading')}</SectionHeading>
        </span>
        <Panel>
          <dl className="flex flex-col">
            <DetailRow term={t('profile.accountName')}>
              <span dir="auto">{gate.session.account.name}</span>
            </DetailRow>
          </dl>
          <p className="mt-3">
            <TextLink href={`/${locale}/my/settings/profile`}>
              {t('profile.accountSettings')}
            </TextLink>
          </p>
        </Panel>
      </section>
    </TeacherFrame>
  );
}
