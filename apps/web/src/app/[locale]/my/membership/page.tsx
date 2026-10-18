import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  isOpenApplication,
  type ApplicationRecord,
  type MembershipRecord,
  type MembershipTypeReference,
  type PublicMembershipType,
} from '@minhaj/contracts/membership';

import {
  ApplicationStatusBadge,
  MembershipStatusBadge,
  MembershipTime,
  TypeTitle,
  TypeWords,
  closureText,
  withdrawalText,
  type MembershipTranslator,
} from '@/components/membership/parts';
import {
  membershipPath,
  readDoneNotice,
  typeTitleText,
  type Query,
} from '@/components/membership/presentation';
import { membershipRead } from '@/components/membership/read';
import { ConfirmField, PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { Alert, DetailRow, EmptyState, Panel, SectionHeading } from '@/components/ui';
import { membershipRuntime } from '@/composition/membership';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { requireActiveSession } from '../guard';
import { applyAction, closeOwnAction, withdrawAction } from './actions';

/**
 * My Membership — the person's own applications and Memberships
 * (DELIVERY_PLAN.md Phase 26; DOMAIN_MODEL.md §17.2).
 *
 * THE ACCOUNT IS THE SESSION'S. Every row here is the signed-in account's own;
 * the adapter keys every read by the account, so nothing an address names
 * widens it. The published types are offered with an apply form each — and a
 * type the person already has an application in progress for, or an active
 * Membership of, says so instead of offering a second.
 *
 * WHAT APPLYING RECORDS IS SAID BEFORE IT HAPPENS: the account and the type,
 * nothing else — no profile, no questionnaire, no upload. A decision is an
 * operator's; the page promises no outcome and no response time.
 *
 * A MEMBERSHIP IS NOT THE ACCOUNT. Ending one leaves the account open, and
 * closing the account withdraws an application in progress but does not end a
 * Membership — both said in words where the person acts.
 *
 * BOUNDED: the service returns at most `OWN_HISTORY` applications and
 * Memberships, newest first. `noindex`, and rendered per request.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

type MyMembershipTranslator = Awaited<ReturnType<typeof getTranslations<'myMembership'>>>;

/** The words for every refusal a My Membership act can return — a category, never content. */
function formMessages(t: MyMembershipTranslator): Readonly<Record<string, string>> {
  return {
    conflict: t('failure.conflict'),
    invalid: t('failure.invalid'),
    'invalid-state': t('failure.invalidState'),
    'type-unavailable': t('failure.typeUnavailable'),
    'already-member': t('failure.alreadyMember'),
    'not-found': t('failure.notFound'),
    'rate-limited': t('failure.rateLimited'),
    'confirm-required': t('failure.confirmRequired'),
    'no-session': t('failure.noSession'),
    denied: t('failure.noSession'),
    'applicant-closed': t('failure.noSession'),
    // An applicant's acts can meet neither of these; each still has words.
    incomplete: t('failure.invalid'),
    limit: t('failure.invalid'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
  };
}

export default async function MyMembershipPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/my/membership`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myMembership' });
  const s = await getTranslations({ locale, namespace: 'membership' });
  const notice = readDoneNotice(await searchParams);
  const read = await membershipRead('membership-my-state', () =>
    membershipRuntime().applicant.state({ accountId: session.account.id }),
  );

  const back = (
    <PersonalLinks
      label={t('nav.label')}
      links={[
        { href: membershipPath(locale), text: t('nav.public') },
        { href: `/${locale}/my`, text: t('nav.account') },
      ]}
    />
  );
  const description = (
    <>
      <p>{t('description')}</p>
      <p className="text-sm">{t('decisionNotice')}</p>
    </>
  );

  if (!read.ok)
    return (
      <PersonalFrame title={t('title')} description={description} back={back}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </PersonalFrame>
    );

  const { available, applications, memberships } = read.value;
  const types = new Map<string, MembershipTypeReference | PublicMembershipType>([
    ...read.value.types.map((type) => [type.id, type] as const),
    ...available.map((type) => [type.id, type] as const),
  ]);
  const open = applications.filter((entry) => isOpenApplication(entry.status));
  const earlier = applications.filter((entry) => !isOpenApplication(entry.status));
  const timeZone = session.account.timezone;
  const messages = formMessages(t);

  return (
    <PersonalFrame title={t('title')} description={description} back={back}>
      {notice === null ? null : <Alert tone="success">{t(`done.${notice}`)}</Alert>}

      {/* ---- Applications in progress ------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="membership-open">
        <span id="membership-open">
          <SectionHeading>{t('open.heading')}</SectionHeading>
        </span>
        {open.length === 0 ? (
          <EmptyState>{t('open.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('open.heading')} className="flex flex-col gap-3">
            {open.map((entry) => (
              <OpenApplication
                key={entry.id}
                entry={entry}
                type={types.get(entry.membershipTypeId)}
                locale={locale}
                timeZone={timeZone}
                t={t}
                s={s}
                messages={messages}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- Memberships ------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="membership-held">
        <span id="membership-held">
          <SectionHeading>{t('memberships.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('memberships.help')}
        </p>
        {memberships.length === 0 ? (
          <EmptyState>{t('memberships.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('memberships.heading')} className="flex flex-col gap-3">
            {memberships.map((entry) => (
              <HeldMembership
                key={entry.id}
                entry={entry}
                type={types.get(entry.membershipTypeId)}
                locale={locale}
                timeZone={timeZone}
                t={t}
                s={s}
                messages={messages}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- Apply ------------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="membership-apply">
        <span id="membership-apply">
          <SectionHeading>{t('apply.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('apply.help')}
        </p>
        {available.length === 0 ? (
          <EmptyState>{t('apply.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('apply.heading')} className="flex flex-col gap-3">
            {available.map((type) => {
              const pending = open.some((entry) => entry.membershipTypeId === type.id);
              const member = memberships.some(
                (entry) =>
                  entry.membershipTypeId === type.id && entry.status === 'active',
              );
              return (
                <Panel key={type.id} as="li">
                  {/* The apply button names the type, so a long unbroken
                      title must be able to break inside it at 320px. */}
                  <div className="flex min-w-0 flex-col gap-4 wrap-anywhere">
                    <TypeWords type={type} locale={locale} t={s} headingLevel="h3" />
                    {member ? (
                      <p className="text-sm font-medium">{t('apply.member')}</p>
                    ) : pending ? (
                      <p className="text-sm font-medium">{t('apply.inProgress')}</p>
                    ) : (
                      <ActionForm
                        action={applyAction}
                        submitLabel={t('apply.submit', {
                          title: typeTitleText(type, locale),
                        })}
                        pendingLabel={t('working')}
                        messages={messages}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="membershipTypeId" value={type.id} />
                      </ActionForm>
                    )}
                  </div>
                </Panel>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Earlier applications ---------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="membership-history">
        <span id="membership-history">
          <SectionHeading>{t('history.heading')}</SectionHeading>
        </span>
        {earlier.length === 0 ? (
          <EmptyState>{t('history.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('history.heading')} className="flex flex-col gap-3">
            {earlier.map((entry) => (
              <Panel key={entry.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ApplicationStatusBadge status={entry.status} t={s} />
                  </div>
                  <p className="font-semibold">
                    <TypeTitle
                      type={types.get(entry.membershipTypeId)}
                      locale={locale}
                      t={s}
                    />
                  </p>
                  <dl className="divide-y divide-[color:var(--color-border)]">
                    <DetailRow term={t('when.submitted')}>
                      <MembershipTime
                        value={entry.submittedAt}
                        locale={locale}
                        timeZone={timeZone}
                      />
                    </DetailRow>
                    {entry.decidedAt === null ? null : (
                      <DetailRow term={t('when.decided')}>
                        <MembershipTime
                          value={entry.decidedAt}
                          locale={locale}
                          timeZone={timeZone}
                        />
                      </DetailRow>
                    )}
                    {entry.withdrawnAt === null ? null : (
                      <DetailRow term={t('when.withdrawn')}>
                        <MembershipTime
                          value={entry.withdrawnAt}
                          locale={locale}
                          timeZone={timeZone}
                        />
                        {entry.withdrawalSource === null
                          ? null
                          : ` — ${withdrawalText(entry.withdrawalSource, s)}`}
                      </DetailRow>
                    )}
                  </dl>
                  {entry.membershipId === null ? null : (
                    <p className="text-sm">{t('history.membership')}</p>
                  )}
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </section>
    </PersonalFrame>
  );
}

interface RowProps<Entry> {
  readonly entry: Entry;
  readonly type: MembershipTypeReference | PublicMembershipType | undefined;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly t: MyMembershipTranslator;
  readonly s: MembershipTranslator;
  readonly messages: Readonly<Record<string, string>>;
}

/** One application in progress, with the withdrawal it still allows. */
function OpenApplication({
  entry,
  type,
  locale,
  timeZone,
  t,
  s,
  messages,
}: RowProps<ApplicationRecord>) {
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationStatusBadge status={entry.status} t={s} />
        </div>
        <p className="font-semibold">
          <TypeTitle type={type} locale={locale} t={s} />
        </p>
        <p className="text-sm">
          {entry.status === 'submitted' ? t('open.submittedHelp') : t('open.reviewHelp')}
        </p>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('when.submitted')}>
            <MembershipTime
              value={entry.submittedAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          {entry.reviewStartedAt === null ? null : (
            <DetailRow term={t('when.reviewStarted')}>
              <MembershipTime
                value={entry.reviewStartedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
        </dl>
        <ActionForm
          action={withdrawAction}
          submitLabel={t('withdraw.submit')}
          pendingLabel={t('working')}
          tone="secondary"
          messages={messages}
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="version" value={String(entry.version)} />
          <ConfirmField id={`withdraw-${entry.id}`} label={t('withdraw.confirm')} />
        </ActionForm>
      </div>
    </Panel>
  );
}

/** One Membership — active with the way to end it, or ended and how. */
function HeldMembership({
  entry,
  type,
  locale,
  timeZone,
  t,
  s,
  messages,
}: RowProps<MembershipRecord>) {
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MembershipStatusBadge status={entry.status} t={s} />
        </div>
        <p className="font-semibold">
          <TypeTitle type={type} locale={locale} t={s} />
        </p>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('when.began')}>
            <MembershipTime
              value={entry.activatedAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          {entry.closedAt === null ? null : (
            <DetailRow term={t('when.ended')}>
              <MembershipTime
                value={entry.closedAt}
                locale={locale}
                timeZone={timeZone}
              />
              {entry.closureSource === null
                ? null
                : ` — ${closureText(entry.closureSource, s)}`}
            </DetailRow>
          )}
        </dl>
        {entry.status === 'active' ? (
          <ActionForm
            action={closeOwnAction}
            submitLabel={t('close.submit')}
            pendingLabel={t('working')}
            tone="destructive"
            messages={messages}
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={entry.id} />
            <input type="hidden" name="version" value={String(entry.version)} />
            <ConfirmField id={`close-${entry.id}`} label={t('close.confirm')} />
          </ActionForm>
        ) : null}
      </div>
    </Panel>
  );
}
