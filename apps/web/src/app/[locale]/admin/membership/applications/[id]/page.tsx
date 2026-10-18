import { notFound } from 'next/navigation';

import { membershipIdSchema } from '@minhaj/contracts/membership';

import {
  ApplicationStatusBadge,
  MembershipTime,
  TypeStateBadge,
  TypeTitle,
  withdrawalText,
} from '@/components/membership/parts';
import { adminMembershipPath, withQuery } from '@/components/membership/presentation';
import { membershipRead } from '@/components/membership/read';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DetailRow,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { membershipRuntime } from '@/composition/membership';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { decideAction, startReviewAction } from '../../actions';
import {
  PersonName,
  RecordIdentity,
  adminMembershipCopy,
  personNames,
} from '../../shared';

/**
 * One application, as an operator reads it (DELIVERY_PLAN.md Phase 26) —
 * under `membership.read`; every act on it re-checks `membership.administer`.
 *
 * OPENING IT IS AUDITED. The service records the access — the operator, the
 * application, the key that authorised it, identifiers only — before it
 * returns the record, and the page says so, so nobody opens a person's
 * application believing it goes unrecorded.
 *
 * WHAT THERE IS TO READ IS WHAT THE APPLICATION HOLDS: the applicant's
 * display name from Identity (never an address), the type, the status and
 * its instants, and the Membership an approval began. Nothing was asked of
 * the applicant beyond choosing the type, so nothing more is shown.
 *
 * REVIEW BEFORE DECISION, EACH UNDER THE VERSION SHOWN. A submitted
 * application can be taken under review; only one under review can be
 * approved or rejected, and each act needs an explicit confirmation. A
 * finished application changes no further. A malformed or unknown id is the
 * administrative 404.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MembershipApplicationPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const applications = `${adminMembershipPath(locale)}/applications`;
  const path = `${applications}/${encodeURIComponent(id)}`;
  const context = await requireAdminPage(locale, 'membership.read', path);
  if (!membershipIdSchema.safeParse(id).success) notFound();
  const copy = await adminMembershipCopy(locale);
  const { t, s } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('membership.administer');
  const timeZone = context.session.account.timezone;
  const { admin } = membershipRuntime();

  const read = await membershipRead('membership-admin-application', async () => {
    const application = await admin.application(actor, id);
    if (application === null) return null;
    const type = await admin.type(actor, application.membershipTypeId);
    return { application, type };
  });
  const back = (
    <p>
      <TextLink href={applications}>{t('application.back')}</TextLink>
    </p>
  );

  if (!read.ok) {
    if (['denied', 'not-found', 'invalid'].includes(read.failure)) notFound();
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('application.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  }
  if (read.value === null) notFound();

  const { application, type } = read.value;
  const names = await personNames([application.applicantAccountId]);

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('application.title')}</PageHeading>
        <Alert tone="info">{t('application.audited')}</Alert>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('application.applicant')}>
            <PersonName
              accountId={application.applicantAccountId}
              names={names}
              copy={copy}
            />
          </DetailRow>
          <DetailRow term={t('application.type')}>
            <span className="flex flex-wrap items-center gap-2">
              <TypeTitle type={type ?? undefined} locale={locale} t={s} />
              {type === null ? null : <TypeStateBadge state={type.state} t={s} />}
            </span>
          </DetailRow>
          <DetailRow term={t('application.status')}>
            <ApplicationStatusBadge status={application.status} t={s} />
          </DetailRow>
          <DetailRow term={t('application.submitted')}>
            <MembershipTime
              value={application.submittedAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          {application.reviewStartedAt === null ? null : (
            <DetailRow term={t('application.reviewStarted')}>
              <MembershipTime
                value={application.reviewStartedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          {application.decidedAt === null ? null : (
            <DetailRow term={t('application.decided')}>
              <MembershipTime
                value={application.decidedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          {application.withdrawnAt === null ? null : (
            <DetailRow term={t('application.withdrawn')}>
              <MembershipTime
                value={application.withdrawnAt}
                locale={locale}
                timeZone={timeZone}
              />
              {application.withdrawalSource === null
                ? null
                : ` — ${withdrawalText(application.withdrawalSource, s)}`}
            </DetailRow>
          )}
          <DetailRow term={t('application.membership')}>
            {application.membershipId === null ? (
              t('application.membershipNone')
            ) : (
              <TextLink
                href={withQuery(adminMembershipPath(locale), {
                  type: application.membershipTypeId,
                })}
              >
                {t('application.membershipCreated')}
              </TextLink>
            )}
          </DetailRow>
          <DetailRow term={t('application.version')}>{application.version}</DetailRow>
        </dl>
      </Panel>

      {application.status === 'submitted' && administer ? (
        <section className="flex flex-col gap-3" aria-labelledby="application-review">
          <SectionHeading>
            <span id="application-review">{t('review.heading')}</span>
          </SectionHeading>
          <p className="text-sm">{t('review.help')}</p>
          <ActionForm
            action={startReviewAction}
            submitLabel={t('review.submit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
          >
            <RecordIdentity locale={locale} record={application} />
            <ConfirmField id="review-confirm" label={t('review.confirm')} />
          </ActionForm>
        </section>
      ) : null}

      {application.status === 'under_review' && administer ? (
        <section className="flex flex-col gap-3" aria-labelledby="application-decision">
          <SectionHeading>
            <span id="application-decision">{t('decide.heading')}</span>
          </SectionHeading>
          <p className="text-sm">{t('decide.help')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Panel as="div">
              <ActionForm
                action={decideAction}
                submitLabel={t('decide.approve')}
                pendingLabel={t('pending')}
                messages={copy.messages}
              >
                <RecordIdentity locale={locale} record={application} />
                <input type="hidden" name="decision" value="approve" />
                <ConfirmField id="approve-confirm" label={t('decide.approveConfirm')} />
              </ActionForm>
            </Panel>
            <Panel as="div">
              <ActionForm
                action={decideAction}
                submitLabel={t('decide.reject')}
                pendingLabel={t('pending')}
                tone="secondary"
                messages={copy.messages}
              >
                <RecordIdentity locale={locale} record={application} />
                <input type="hidden" name="decision" value="reject" />
                <ConfirmField id="reject-confirm" label={t('decide.rejectConfirm')} />
              </ActionForm>
            </Panel>
          </div>
        </section>
      ) : null}

      {application.status === 'submitted' ||
      application.status === 'under_review' ? null : (
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('application.terminal')}
        </p>
      )}

      {back}
    </main>
  );
}
