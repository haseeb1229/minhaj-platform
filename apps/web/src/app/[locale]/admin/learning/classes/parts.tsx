import type { Locale } from '@minhaj/contracts';
import {
  CLASS_PAGE,
  REMINDER_LEAD_MINUTES,
  SESSION_KINDS,
  SESSION_STATES,
  learningIdSchema,
  reminderLeadOf,
  type ClassSessionRecord,
  type LiveLearningAuthority,
  type SessionKind,
  type SessionState,
  type TeachingScopeView,
} from '@minhaj/contracts/learning';
import { supportedTimeZones } from '@minhaj/contracts/platform';

import { ClassTime } from '@/components/live-learning/parts';
import { Alert, Field, Select, StatusBadge, TextInput, TextLink } from '@/components/ui';
import { identityRuntime } from '@/composition/identity';
import { pageOffset, queryValue } from '../../shared';
import { Title, type Copy, type Query } from '../shared';

/**
 * The parts the class administration screens share (ROUTE_MAP.md §7
 * `/admin/learning/classes`; DELIVERY_PLAN.md Phase 23).
 *
 * NAMES ARE IDENTITY'S ANSWER, in one bounded call per page: a participant, a
 * requester or a teacher is shown by the display name Identity returns for
 * the account, and "Learner" or "Teacher" in words when it returns none —
 * never an identifier as the primary text.
 *
 * TIME IS STATED IN THE CLASS'S ZONE, with the zone named, because the zone a
 * class was scheduled in is a fact the record keeps (DOMAIN_MODEL.md §19.5).
 *
 * A SCHEDULE FORM ASKS FOR A WALL-CLOCK TIME IN A NAMED ZONE. The choice for
 * a repeated hour is offered under a closed disclosure and left unchosen
 * until the service refuses with `ambiguous-time`; the refusal's words say
 * where to choose. Nothing here guesses a daylight-saving fold.
 *
 * NO MEETING ADDRESS IS RENDERED HERE. The detail page alone renders the one
 * the disclosure read returns.
 */

export function classesBase(locale: Locale): string {
  return `/${locale}/admin/learning/classes`;
}

/** The display name of each account, from Identity — identifiers only cross. */
export async function participantNameMap(
  accountIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return new Map();
  const names = await identityRuntime().administration.participantNames(unique);
  return new Map(names.map((entry) => [entry.accountId, entry.name]));
}

/** A person's name as Identity reports it, or the honest word for an unnamed one. */
export function PersonName({
  accountId,
  names,
  fallback,
}: {
  readonly accountId: string;
  readonly names: ReadonlyMap<string, string>;
  readonly fallback: string;
}) {
  const name = names.get(accountId);
  return (
    <span dir="auto" className="wrap-anywhere">
      {name ?? fallback}
    </span>
  );
}

/** The live-learning activation, in words, for the operator's own honesty. */
export function ActivationNotice({
  mode,
  copy,
}: {
  readonly mode: LiveLearningAuthority | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (mode === 'approved') return null;
  return (
    <Alert tone={mode === null ? 'warning' : 'info'}>
      {mode === null ? t('classes.notActivated') : t('classes.fixture')}
    </Alert>
  );
}

export function SessionStateBadge({
  state,
  copy,
}: {
  readonly state: SessionState;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={state === 'scheduled' ? 'positive' : 'neutral'}>
      {copy.t(`classes.stateName.${state}`)}
    </StatusBadge>
  );
}

export function SessionKindBadge({
  kind,
  copy,
}: {
  readonly kind: SessionKind;
  readonly copy: Copy;
}) {
  return <StatusBadge tone="neutral">{copy.t(`classes.kindName.${kind}`)}</StatusBadge>;
}

/** A session's start and end in its own zone, the zone named. */
export function SessionTimes({
  session,
  locale,
  copy,
}: {
  readonly session: ClassSessionRecord;
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        <ClassTime
          instant={session.startsAt}
          local={session.startsLocal}
          timeZone={session.timeZone}
          locale={locale}
        />
      </span>
      <span>
        {t('classes.until')}{' '}
        <ClassTime
          instant={session.endsAt}
          local={session.endsLocal}
          timeZone={session.timeZone}
          locale={locale}
          date={false}
        />
      </span>
      <span className="text-xs text-[color:var(--color-foreground-muted)]">
        {session.timeZone}
      </span>
    </span>
  );
}

/** A scope as a choice: its Course's title and its teacher's name. */
export function ScopeOptionLabel({
  scope,
  names,
  locale,
  copy,
}: {
  readonly scope: TeachingScopeView;
  readonly names: ReadonlyMap<string, string>;
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  return (
    <>
      <Title record={scope.course} locale={locale} />
      {' — '}
      <PersonName
        accountId={scope.scope.accountId}
        names={names}
        fallback={copy.t('classes.teacherUnnamed')}
      />
    </>
  );
}

/** The same, as plain text for an `<option>`. */
export function scopeOptionText(
  scope: TeachingScopeView,
  names: ReadonlyMap<string, string>,
  title: string,
  copy: Copy,
): string {
  return `${title} — ${names.get(scope.scope.accountId) ?? copy.t('classes.teacherUnnamed')}`;
}

/* ===========================================================================
 * The directory query
 * ========================================================================= */

export function sessionsQuery(query: Query) {
  const state = queryValue(query, 'state');
  const kind = queryValue(query, 'kind');
  const course = queryValue(query, 'course');
  return {
    offset: pageOffset(query, CLASS_PAGE),
    state: (SESSION_STATES as readonly string[]).includes(state ?? '')
      ? (state as SessionState)
      : null,
    kind: (SESSION_KINDS as readonly string[]).includes(kind ?? '')
      ? (kind as SessionKind)
      : null,
    courseId:
      course !== null && learningIdSchema.safeParse(course).success ? course : null,
  };
}

export type SessionsQuery = ReturnType<typeof sessionsQuery>;

export function sessionsHref(
  base: string,
  filter: SessionsQuery,
): (page: number) => string {
  return (page) => {
    const search = new URLSearchParams();
    if (page > 1) search.set('page', String(page));
    if (filter.state !== null) search.set('state', filter.state);
    if (filter.kind !== null) search.set('kind', filter.kind);
    if (filter.courseId !== null) search.set('course', filter.courseId);
    const encoded = search.toString();
    return encoded === '' ? base : `${base}?${encoded}`;
  };
}

/** Previous and next pages of a class listing, as links. */
export function ClassPager({
  offset,
  hasMore,
  hrefFor,
  label,
  copy,
}: {
  readonly offset: number;
  readonly hasMore: boolean;
  readonly hrefFor: (page: number) => string;
  readonly label: string;
  readonly copy: Copy;
}) {
  if (offset === 0 && !hasMore) return null;
  const current = offset / CLASS_PAGE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

/** A page-only address with one fixed query, for the scopes listing. */
export function pagedHref(base: string, fixed: Readonly<Record<string, string>>) {
  return (page: number) => {
    const search = new URLSearchParams(fixed);
    if (page > 1) search.set('page', String(page));
    const encoded = search.toString();
    return encoded === '' ? base : `${base}?${encoded}`;
  };
}

/* ===========================================================================
 * Schedule fields
 * ========================================================================= */

/** The zone a form starts on: the operator's own when the runtime knows it. */
export function defaultTimeZone(preferred: string | null): string {
  const zones = supportedTimeZones();
  return preferred !== null && zones.includes(preferred) ? preferred : 'UTC';
}

/** The reminder lead a form offers; `keep` only on a reschedule. */
function ReminderSelect({
  id,
  copy,
  current,
  reschedule,
}: {
  readonly id: string;
  readonly copy: Copy;
  readonly current: number | null;
  readonly reschedule: boolean;
}) {
  const { t } = copy;
  return (
    <Field id={id} label={t('classes.reminder')} help={t('classes.reminderHelp')}>
      {(props) => (
        <Select
          {...props}
          name="reminderLeadMinutes"
          defaultValue={reschedule ? 'keep' : current === null ? '' : String(current)}
        >
          {reschedule ? <option value="keep">{t('classes.reminderKeep')}</option> : null}
          <option value="">{t('classes.reminderNone')}</option>
          {REMINDER_LEAD_MINUTES.map((lead) => (
            <option key={lead} value={String(lead)}>
              {t(`classes.reminderLead.${lead}`)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function FoldChoice({
  name,
  legend,
  copy,
}: {
  readonly name: 'startFold' | 'endFold';
  readonly legend: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{legend}</legend>
      {(['', 'earlier', 'later'] as const).map((value) => (
        <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={value}
            defaultChecked={value === ''}
            className="size-5"
          />
          {value === '' ? t('classes.foldNone') : t(`classes.fold.${value}`)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The zone, the local start and end, the fold choice for a repeated hour and
 * the reminder lead — the window every scheduling act states.
 */
export function ScheduleFields({
  prefix,
  copy,
  session,
  timeZone,
}: {
  readonly prefix: string;
  readonly copy: Copy;
  /** The session being moved; absent when one is being created. */
  readonly session: ClassSessionRecord | null;
  /** The zone to start on when there is no session. */
  readonly timeZone: string;
}) {
  const { t } = copy;
  const zones = supportedTimeZones();
  return (
    <div className="flex flex-col gap-4">
      <Field
        id={`${prefix}-zone`}
        label={t('classes.timeZone')}
        help={t('classes.timeZoneHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="timeZone"
            defaultValue={session?.timeZone ?? timeZone}
            dir="ltr"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-starts`} label={t('classes.startsLocal')}>
          {(props) => (
            <TextInput
              {...props}
              type="datetime-local"
              name="startsLocal"
              required
              step={60}
              defaultValue={session?.startsLocal ?? ''}
              dir="ltr"
            />
          )}
        </Field>
        <Field id={`${prefix}-ends`} label={t('classes.endsLocal')}>
          {(props) => (
            <TextInput
              {...props}
              type="datetime-local"
              name="endsLocal"
              required
              step={60}
              defaultValue={session?.endsLocal ?? ''}
              dir="ltr"
            />
          )}
        </Field>
      </div>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {t('classes.windowHelp')}
      </p>
      <details className="rounded-[var(--radius-control)] border border-[color:var(--color-border)] p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          {t('classes.foldSummary')}
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <p className="text-xs text-[color:var(--color-foreground-muted)]">
            {t('classes.foldHelp')}
          </p>
          <FoldChoice name="startFold" legend={t('classes.foldStart')} copy={copy} />
          <FoldChoice name="endFold" legend={t('classes.foldEnd')} copy={copy} />
        </div>
      </details>
      <ReminderSelect
        id={`${prefix}-reminder`}
        copy={copy}
        current={
          session === null ? null : reminderLeadOf(session.startsAt, session.reminderAt)
        }
        reschedule={session !== null}
      />
    </div>
  );
}
