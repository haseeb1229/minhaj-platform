import { notFound, redirect } from 'next/navigation';
import type { Locale } from '@minhaj/contracts';
import {
  CLASS_PAGE,
  LEARNING_PAGE,
  REMINDER_LEAD_MINUTES,
  type AdminTrialRequestView,
  type AvailabilityRecord,
} from '@minhaj/contracts/learning';

import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import {
  requireAdminPage,
  requireOwnSession,
  type AdminPageContext,
} from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { pageOffset } from '../../shared';
import { confirmTrialAction } from '../actions';
import { ActivationNotice, PersonName, participantNameMap } from '../classes/parts';
import {
  Pager,
  StateBadge,
  Title,
  learningCopy,
  pageHref,
  titleText,
  type Copy,
  type ListParams,
} from '../shared';

/**
 * `/{locale}/admin/learning/trials` — trial-class requests (ROUTE_MAP.md §7;
 * Phase 22, extended by Phase 23).
 *
 * TWO KEYS, TWO VIEWS. Under `learning.read` the Phase-22 table stays exactly
 * what it was: how many requests each live Course holds, and since when —
 * counts, never people. Only a viewer who ALSO holds `learning.classes.read`
 * sees the second section: each request with WHO asked (Identity's display
 * name; the read is audited by the service), its Course, when it was made and
 * whether it is booked. Under `learning.classes.administer` an unbooked
 * request carries a confirmation form: a window chosen among the open,
 * unbooked, future windows of teachers currently scoped to that Course, and a
 * reminder lead.
 *
 * A REQUEST IS NOT A BOOKING until that form succeeds; the page says so.
 */
export const dynamic = 'force-dynamic';

/** Open windows for each Course on this page of requests, one read per Course. */
async function windowsByCourse(
  actor: { readonly accountId: string },
  requests: readonly AdminTrialRequestView[],
): Promise<ReadonlyMap<string, readonly AvailabilityRecord[]>> {
  const courseIds = [
    ...new Set(
      requests.filter((request) => request.booking === null).map((r) => r.course.id),
    ),
  ];
  const { classes } = learningRuntime();
  const entries = await Promise.all(
    courseIds.map(
      async (courseId) =>
        [courseId, (await classes.availableWindows(actor, courseId, 0)).items] as const,
    ),
  );
  return new Map(entries);
}

function ConfirmRequest({
  locale,
  request,
  windows,
  names,
  copy,
}: {
  readonly locale: Locale;
  readonly request: AdminTrialRequestView;
  readonly windows: readonly AvailabilityRecord[];
  readonly names: ReadonlyMap<string, string>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (windows.length === 0) return <p className="text-sm">{t('trials.noWindows')}</p>;
  const format = (window: AvailabilityRecord) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        timeZone: window.timeZone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(window.startsAt);
    } catch {
      return window.startsLocal.replace('T', ' ');
    }
  };
  return (
    <ActionForm
      action={confirmTrialAction}
      submitLabel={t('trials.confirm', {
        title: titleText(request.course.labels, locale, request.course.primaryLocale),
      })}
      pendingLabel={t('pending')}
      messages={{ ...copy.messages, success: t('trials.confirmed') }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="requestId" value={request.id} />
      <Field
        id={`window-${request.id}`}
        label={t('trials.window')}
        help={t('trials.windowHelp')}
      >
        {(props) => (
          <Select {...props} name="availabilityId" required defaultValue="">
            <option value="" disabled>
              {t('trials.chooseWindow')}
            </option>
            {windows.map((window) => (
              <option key={window.id} value={window.id}>
                {t('trials.windowOption', {
                  teacher: names.get(window.accountId) ?? t('classes.teacherUnnamed'),
                  time: format(window),
                  zone: window.timeZone,
                })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id={`reminder-${request.id}`} label={t('classes.reminder')}>
        {(props) => (
          <Select {...props} name="reminderLeadMinutes" defaultValue="">
            <option value="">{t('classes.reminderNone')}</option>
            {REMINDER_LEAD_MINUTES.map((lead) => (
              <option key={lead} value={String(lead)}>
                {t(`classes.reminderLead.${lead}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </ActionForm>
  );
}

/**
 * Either key opens this page (the Fatwa-area precedent): `learning.read` for
 * the Phase-22 counts, `learning.classes.read` for who asked and the
 * confirmation. Holding neither is the administrative 404.
 */
async function requireLearningTrialsPage(
  locale: string,
  returnPath: string,
): Promise<AdminPageContext> {
  const active = await requireOwnSession(locale);
  if (active === null)
    redirect(`/${locale}/signin?returnTo=${encodeURIComponent(returnPath)}`);
  const held = (await identityRuntime().authorization.evaluate(active.session))
    .permissions;
  const key = (['learning.read', 'learning.classes.read'] as const).find((candidate) =>
    held.has(candidate),
  );
  if (key === undefined) notFound();
  return requireAdminPage(locale, key, returnPath);
}

export default async function TrialSummaryPage({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/learning/trials`;
  const context = await requireLearningTrialsPage(locale, base);
  const copy = await learningCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const offset = pageOffset(query, LEARNING_PAGE);
  const classesRead = context.authorization.can('learning.classes.read');
  const administer = context.authorization.can('learning.classes.administer');
  const requestOffset = classesRead
    ? (() => {
        const raw = typeof query['requests'] === 'string' ? Number(query['requests']) : 1;
        const page = Number.isInteger(raw) && raw > 0 && raw <= 1_000 ? raw : 1;
        return (page - 1) * CLASS_PAGE;
      })()
    : 0;

  // The Phase-22 counts stay the catalogue key's; an operator holding only the
  // class keys sees the requests section and not the counts table.
  const catalogueRead = context.authorization.can('learning.read');
  const page = catalogueRead
    ? await learningRuntime().learning.trialSummary(actor, offset)
    : { items: [], hasMore: false };
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const classes = classesRead
    ? await (async () => {
        const runtime = learningRuntime().classes;
        const [mode, requests] = await Promise.all([
          runtime.activation(actor),
          runtime.trialRequests(actor, null, requestOffset),
        ]);
        const windows =
          administer && mode !== null
            ? await windowsByCourse(actor, requests.items)
            : new Map<string, readonly AvailabilityRecord[]>();
        const names = await participantNameMap([
          ...requests.items.map((request) => request.accountId),
          ...[...windows.values()].flat().map((window) => window.accountId),
        ]);
        return { mode, requests, windows, names };
      })()
    : null;

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <PageHeading>{t('surface.trials')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('trials.description')}
        </p>
      </div>
      <Alert tone="info">
        {classesRead ? t('trials.notBookedUntilConfirmed') : t('trials.notScheduled')}
      </Alert>
      {!catalogueRead ? null : page.items.length === 0 ? (
        <EmptyState>{t('trials.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.trials')}
          columns={[
            t('labelTitle'),
            t('state'),
            t('trials.requests'),
            t('trials.oldest'),
          ]}
        >
          {page.items.map((row) => (
            <DataRow key={row.course.id}>
              <DataCell wrap>
                <TextLink href={`/${locale}/admin/learning/courses/${row.course.id}`}>
                  <Title record={row.course} locale={locale} />
                </TextLink>
              </DataCell>
              <DataCell>
                <StateBadge state={row.course.state} copy={copy} />
              </DataCell>
              <DataCell>{row.requests}</DataCell>
              <DataCell>
                {row.oldest === null ? (
                  '—'
                ) : (
                  <time dateTime={row.oldest.toISOString()}>
                    {date.format(row.oldest)}
                  </time>
                )}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      {catalogueRead ? (
        <Pager
          offset={offset}
          hasMore={page.hasMore}
          hrefFor={pageHref(base)}
          label={t('surface.trials')}
          copy={copy}
        />
      ) : null}

      {classes === null ? null : (
        <section className="flex flex-col gap-4" aria-labelledby="trial-requests">
          <SectionHeading>
            <span id="trial-requests">{t('trials.requestsHeading')}</span>
          </SectionHeading>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('trials.requestsHelp')}
          </p>
          <ActivationNotice mode={classes.mode} copy={copy} />
          {classes.requests.items.length === 0 ? (
            <EmptyState>{t('trials.empty')}</EmptyState>
          ) : (
            <ul aria-label={t('trials.requestsHeading')} className="flex flex-col gap-3">
              {classes.requests.items.map((request) => (
                <Panel key={request.id} as="li">
                  <div className="flex min-w-0 flex-col gap-3">
                    <p className="font-semibold">
                      <Title record={request.course} locale={locale} />
                    </p>
                    <dl className="flex flex-col gap-1 text-sm">
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-[color:var(--color-foreground-muted)]">
                          {t('trials.requester')}
                        </dt>
                        <dd>
                          <PersonName
                            accountId={request.accountId}
                            names={classes.names}
                            fallback={t('classes.learnerUnnamed')}
                          />
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-[color:var(--color-foreground-muted)]">
                          {t('trials.requestedAt')}
                        </dt>
                        <dd>
                          <time dateTime={request.requestedAt.toISOString()}>
                            {date.format(request.requestedAt)}
                          </time>
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2">
                        <dt className="text-[color:var(--color-foreground-muted)]">
                          {t('trials.booking')}
                        </dt>
                        <dd>
                          <StatusBadge
                            tone={request.booking === null ? 'caution' : 'neutral'}
                          >
                            {request.booking === null
                              ? t('trials.unbooked')
                              : t(`trials.bookingState.${request.booking.state}`)}
                          </StatusBadge>
                        </dd>
                      </div>
                    </dl>
                    {request.booking === null ? null : (
                      <p className="text-sm">
                        <TextLink
                          href={`/${locale}/admin/learning/classes/${request.booking.sessionId}`}
                        >
                          {t('trials.openClass')}
                        </TextLink>
                      </p>
                    )}
                    {request.booking !== null || !administer ? null : classes.mode ===
                      null ? (
                      <p className="text-sm">{t('classes.notActivated')}</p>
                    ) : (
                      <ConfirmRequest
                        locale={locale}
                        request={request}
                        windows={classes.windows.get(request.course.id) ?? []}
                        names={classes.names}
                        copy={copy}
                      />
                    )}
                  </div>
                </Panel>
              ))}
            </ul>
          )}
          {requestOffset === 0 && !classes.requests.hasMore ? null : (
            <nav className="flex gap-6" aria-label={t('trials.requestsHeading')}>
              {requestOffset > 0 ? (
                <TextLink
                  href={
                    requestOffset / CLASS_PAGE === 1
                      ? base
                      : `${base}?requests=${String(requestOffset / CLASS_PAGE)}`
                  }
                >
                  {t('previous')}
                </TextLink>
              ) : null}
              {classes.requests.hasMore ? (
                <TextLink
                  href={`${base}?requests=${String(requestOffset / CLASS_PAGE + 2)}`}
                >
                  {t('next')}
                </TextLink>
              ) : null}
            </nav>
          )}
        </section>
      )}
    </main>
  );
}
