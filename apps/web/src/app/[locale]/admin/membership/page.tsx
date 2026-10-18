import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  MEMBERSHIP_LIMITS,
  MEMBERSHIP_PAGE,
  MEMBERSHIP_STATUSES,
  MEMBERSHIP_TYPE_TRANSITIONS,
  type MembershipTypeRecord,
  type MembershipTypeState,
  type StaffMembership,
} from '@minhaj/contracts/membership';

import {
  MembershipStatusBadge,
  MembershipTime,
  TypeStateBadge,
  TypeTitle,
  closureText,
} from '@/components/membership/parts';
import {
  adminMembershipPath,
  readChoice,
  readTypeFilter,
  withQuery,
} from '@/components/membership/presentation';
import { membershipRead } from '@/components/membership/read';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { membershipRuntime } from '@/composition/membership';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset } from '../shared';
import {
  closeMembershipAction,
  createTypeAction,
  reorderTypeAction,
  saveLabelAction,
  transitionTypeAction,
} from './actions';
import {
  Pager,
  PersonName,
  RecordIdentity,
  adminMembershipCopy,
  personNames,
  type AdminMembershipCopy,
  type Query,
} from './shared';

/**
 * `/{locale}/admin/membership` — the Membership types and the members
 * (DELIVERY_PLAN.md Phase 26) — under `membership.read`, re-checked live by
 * the service.
 *
 * EVERY TYPE, EVERY STATE. Drafts, published and archived types are listed in
 * display order with their open applications and active Memberships counted;
 * `?type={id}` opens one type's editor — its position, its words in each
 * interface locale, and its lifecycle — and narrows the member list to it.
 * Only a published type is public and takes applications, and only with its
 * primary locale's words; a type that has been public never returns to draft.
 *
 * THE MEMBER LIST IS AN AUDITED ACCESS, bounded and paged (`?members=` and
 * `?page=`), naming each member by the display name Identity returns — never
 * an address. An operator may end an active Membership, after confirming;
 * ending it changes nothing about the person's account or the application
 * that began it.
 *
 * A MALFORMED OR UNKNOWN `?type=` IS A 404, never a quietly broadened list.
 * Forms appear only for a holder of `membership.administer`, and every action
 * re-checks it.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MembershipAdminPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = adminMembershipPath(locale);
  const context = await requireAdminPage(locale, 'membership.read', base);
  const copy = await adminMembershipCopy(locale);
  const { t, s } = copy;
  const query = await searchParams;
  const selected = readTypeFilter(query);
  if (selected.state === 'invalid') notFound();
  const members = readChoice(query, 'members', MEMBERSHIP_STATUSES, 'active');
  const offset = pageOffset(query, MEMBERSHIP_PAGE);
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('membership.administer');
  const timeZone = context.session.account.timezone;
  const { admin } = membershipRuntime();

  const types = await membershipRead('membership-admin-types', () => admin.types(actor));
  if (!types.ok && types.failure === 'denied') notFound();
  const all = types.ok ? types.value : [];
  const record =
    selected.state === 'value'
      ? all.find((entry) => entry.id === selected.value)
      : undefined;
  if (types.ok && selected.state === 'value' && record === undefined) notFound();
  const byId = new Map(all.map((entry) => [entry.id, entry]));

  const listing = types.ok
    ? await membershipRead('membership-admin-members', () =>
        admin.memberships(actor, {
          status: members,
          membershipTypeId: record?.id ?? null,
          offset,
        }),
      )
    : null;
  const names =
    listing?.ok === true
      ? await personNames(listing.value.rows.map((row) => row.memberAccountId))
      : new Map<string, string>();
  const membersHref = (page: number) =>
    withQuery(base, {
      type: record?.id ?? null,
      members: members === 'active' ? null : members,
      page: page > 1 ? String(page) : null,
    });

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('types.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('types.description')}
        </p>
      </header>

      {/* ---- Types ------------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="membership-types">
        <SectionHeading>
          <span id="membership-types">{t('types.heading')}</span>
        </SectionHeading>
        {!types.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : all.length === 0 ? (
          <EmptyState>{t('types.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('types.caption')}
            columns={[
              t('types.column.title'),
              t('types.column.state'),
              t('types.column.order'),
              t('types.column.open'),
              t('types.column.active'),
            ]}
          >
            {all.map((entry) => (
              <DataRow key={entry.id}>
                <DataCell wrap>
                  <TextLink href={withQuery(base, { type: entry.id })}>
                    <TypeTitle type={entry} locale={locale} t={s} />
                  </TextLink>
                  {entry.id === record?.id ? (
                    <span className="ms-2 text-xs font-medium">
                      {t('types.selected')}
                    </span>
                  ) : null}
                </DataCell>
                <DataCell>
                  <TypeStateBadge state={entry.state} t={s} />
                </DataCell>
                <DataCell>{entry.displayOrder}</DataCell>
                <DataCell>
                  <TextLink
                    href={withQuery(`${base}/applications`, {
                      type: entry.id,
                    })}
                  >
                    {t('types.openCount', { count: entry.openApplications })}
                  </TextLink>
                </DataCell>
                <DataCell>{entry.activeMemberships}</DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {record === undefined ? null : (
        <TypeEditor
          locale={locale}
          record={record}
          administer={administer}
          timeZone={timeZone}
          back={base}
          copy={copy}
        />
      )}

      {administer && types.ok ? <CreateType locale={locale} copy={copy} /> : null}

      {/* ---- Members ----------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="membership-members">
        <SectionHeading>
          <span id="membership-members">{t('members.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('members.description')}
        </p>
        <nav aria-label={t('members.filter')} className="flex flex-wrap gap-2">
          {MEMBERSHIP_STATUSES.map((status) => (
            <FilterLink
              key={status}
              href={withQuery(base, {
                type: record?.id ?? null,
                members: status === 'active' ? null : status,
              })}
              current={status === members}
            >
              {s(`status.membership.${status}`)}
            </FilterLink>
          ))}
        </nav>
        {record === undefined ? null : (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>{t('members.forType')}</span>
            <TextLink
              href={withQuery(base, { members: members === 'active' ? null : members })}
            >
              {t('members.allTypes')}
            </TextLink>
          </p>
        )}
        {listing === null ? null : !listing.ok ? (
          <Alert tone="error">
            {listing.failure === 'invalid' ? t('beyond') : t('failure.load')}
          </Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('members.empty') : t('beyond')}</EmptyState>
        ) : (
          <ul aria-label={t('members.heading')} className="flex flex-col gap-3">
            {listing.value.rows.map((row) => (
              <MemberRow
                key={row.id}
                row={row}
                type={byId.get(row.membershipTypeId)}
                names={names}
                locale={locale}
                timeZone={timeZone}
                administer={administer}
                copy={copy}
              />
            ))}
          </ul>
        )}
        {listing?.ok === true ? (
          <Pager
            offset={offset}
            total={listing.value.total}
            hrefFor={membersHref}
            label={t('members.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}

/* ===========================================================================
 * One type's editor
 * ========================================================================= */

/** Where a type may go next — never back to draft, so only the two named acts. */
function nextStates(state: MembershipTypeState): readonly ('published' | 'archived')[] {
  return MEMBERSHIP_TYPE_TRANSITIONS[state].filter(
    (to): to is 'published' | 'archived' => to !== 'draft',
  );
}

function TypeEditor({
  locale,
  record,
  administer,
  timeZone,
  back,
  copy,
}: {
  readonly locale: Locale;
  readonly record: MembershipTypeRecord;
  readonly administer: boolean;
  readonly timeZone: string | null;
  readonly back: string;
  readonly copy: AdminMembershipCopy;
}) {
  const { t, s } = copy;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="membership-editor">
      <SectionHeading>
        <span id="membership-editor">
          {t('editor.heading')}: <TypeTitle type={record} locale={locale} t={s} />
        </span>
      </SectionHeading>
      <p>
        <TextLink href={back}>{t('editor.back')}</TextLink>
      </p>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('editor.state')}>
            <TypeStateBadge state={record.state} t={s} />
          </DetailRow>
          <DetailRow term={t('fields.primaryLocale')}>
            {t(`localeName.${record.primaryLocale}`)}
          </DetailRow>
          <DetailRow term={t('fields.displayOrder')}>{record.displayOrder}</DetailRow>
          <DetailRow term={t('editor.version')}>{record.version}</DetailRow>
          <DetailRow term={t('editor.created')}>
            <MembershipTime
              value={record.createdAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          <DetailRow term={t('editor.updated')}>
            <MembershipTime
              value={record.updatedAt}
              locale={locale}
              timeZone={timeZone}
            />
          </DetailRow>
          {record.publishedAt === null ? null : (
            <DetailRow term={t('editor.published')}>
              <MembershipTime
                value={record.publishedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
          {record.archivedAt === null ? null : (
            <DetailRow term={t('editor.archived')}>
              <MembershipTime
                value={record.archivedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
          )}
        </dl>
      </Panel>

      {administer ? (
        <>
          <Panel>
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">{t('lifecycle.heading')}</h3>
              {nextStates(record.state).map((to) => (
                <div key={to} className="flex flex-col gap-3">
                  <p className="text-sm">{t(`lifecycle.explain.${to}`)}</p>
                  <ActionForm
                    action={transitionTypeAction}
                    submitLabel={t(`lifecycle.to.${to}`)}
                    pendingLabel={t('pending')}
                    tone={to === 'published' ? 'primary' : 'secondary'}
                    messages={copy.messages}
                  >
                    <RecordIdentity locale={locale} record={record} />
                    <input type="hidden" name="to" value={to} />
                  </ActionForm>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">{t('order.heading')}</h3>
              <ActionForm
                action={reorderTypeAction}
                submitLabel={t('order.submit')}
                pendingLabel={t('pending')}
                tone="secondary"
                messages={copy.messages}
              >
                <RecordIdentity locale={locale} record={record} />
                <Field
                  id="type-order"
                  label={t('fields.displayOrder')}
                  help={t('fields.displayOrderHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="displayOrder"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MEMBERSHIP_LIMITS.displayOrder}
                      required
                      defaultValue={record.displayOrder}
                    />
                  )}
                </Field>
              </ActionForm>
            </div>
          </Panel>
        </>
      ) : null}

      <section
        className="flex min-w-0 flex-col gap-3"
        aria-labelledby="membership-labels"
      >
        <h3 id="membership-labels" className="font-semibold">
          {t('labels.heading')}
        </h3>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('labels.help')}
        </p>
        {localeSchema.options.map((language) => (
          <LabelEditor
            key={language}
            locale={locale}
            language={language}
            record={record}
            administer={administer}
            copy={copy}
          />
        ))}
      </section>
    </section>
  );
}

/** One interface locale's words for a type: a form for an administrator, the words otherwise. */
function LabelEditor({
  locale,
  language,
  record,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly language: Locale;
  readonly record: MembershipTypeRecord;
  readonly administer: boolean;
  readonly copy: AdminMembershipCopy;
}) {
  const { t } = copy;
  const existing = record.labels.find((entry) => entry.locale === language);
  const name = t(`localeName.${language}`);
  const id = `label-${language}`;
  return (
    <Panel as="div">
      <div className="flex min-w-0 flex-col gap-3">
        <h4 className="text-sm font-semibold">
          {language === record.primaryLocale
            ? t('labels.primary', { language: name })
            : name}
        </h4>
        {existing === undefined ? (
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('labels.missing')}
          </p>
        ) : null}
        {administer ? (
          <ActionForm
            action={saveLabelAction}
            submitLabel={t('labels.submit', { language: name })}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
            preserveInput
          >
            <RecordIdentity locale={locale} record={record} />
            <input type="hidden" name="labelLocale" value={language} />
            <LabelFields
              prefix={id}
              language={language}
              existing={existing}
              copy={copy}
            />
          </ActionForm>
        ) : existing === undefined ? null : (
          <dl
            className="divide-y divide-[color:var(--color-border)]"
            lang={language}
            dir="auto"
          >
            <DetailRow term={t('fields.title')}>{existing.title}</DetailRow>
            <DetailRow term={t('fields.summary')}>{existing.summary}</DetailRow>
            <DetailRow term={t('fields.description')}>
              <span className="whitespace-pre-line">{existing.description}</span>
            </DetailRow>
            {existing.guidance === null ? null : (
              <DetailRow term={t('fields.guidance')}>
                <span className="whitespace-pre-line">{existing.guidance}</span>
              </DetailRow>
            )}
          </dl>
        )}
      </div>
    </Panel>
  );
}

/** Title, summary, description and optional guidance for one locale. */
function LabelFields({
  prefix,
  language,
  existing,
  copy,
}: {
  readonly prefix: string;
  readonly language: Locale;
  readonly existing:
    | {
        readonly title: string;
        readonly summary: string;
        readonly description: string;
        readonly guidance: string | null;
      }
    | undefined;
  readonly copy: AdminMembershipCopy;
}) {
  const { t } = copy;
  return (
    <>
      <Field id={`${prefix}-title`} label={t('fields.title')}>
        {(props) => (
          <TextInput
            {...props}
            name="title"
            required
            defaultValue={existing?.title ?? ''}
            maxLength={MEMBERSHIP_LIMITS.title}
            lang={language}
            dir="auto"
          />
        )}
      </Field>
      <Field id={`${prefix}-summary`} label={t('fields.summary')}>
        {(props) => (
          <TextArea
            {...props}
            name="summary"
            required
            defaultValue={existing?.summary ?? ''}
            maxLength={MEMBERSHIP_LIMITS.summary}
            rows={2}
            lang={language}
            dir="auto"
          />
        )}
      </Field>
      <Field id={`${prefix}-description`} label={t('fields.description')}>
        {(props) => (
          <TextArea
            {...props}
            name="description"
            required
            defaultValue={existing?.description ?? ''}
            maxLength={MEMBERSHIP_LIMITS.description}
            rows={6}
            lang={language}
            dir="auto"
          />
        )}
      </Field>
      <Field
        id={`${prefix}-guidance`}
        label={t('fields.guidance')}
        help={t('fields.guidanceHelp')}
      >
        {(props) => (
          <TextArea
            {...props}
            name="guidance"
            defaultValue={existing?.guidance ?? ''}
            maxLength={MEMBERSHIP_LIMITS.guidance}
            rows={3}
            lang={language}
            dir="auto"
          />
        )}
      </Field>
    </>
  );
}

/* ===========================================================================
 * Creating a type
 * ========================================================================= */

function CreateType({
  locale,
  copy,
}: {
  readonly locale: Locale;
  readonly copy: AdminMembershipCopy;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="membership-create">
      <SectionHeading>
        <span id="membership-create">{t('create.heading')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('create.help')}
      </p>
      <Panel>
        <ActionForm
          action={createTypeAction}
          submitLabel={t('create.submit')}
          pendingLabel={t('pending')}
          messages={copy.messages}
          preserveInput
        >
          <input type="hidden" name="locale" value={locale} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="create-primary"
              label={t('fields.primaryLocale')}
              help={t('fields.primaryLocaleHelp')}
            >
              {(props) => (
                <Select {...props} name="primaryLocale" defaultValue={locale}>
                  {localeSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {t(`localeName.${option}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              id="create-order"
              label={t('fields.displayOrder')}
              help={t('fields.displayOrderHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="displayOrder"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MEMBERSHIP_LIMITS.displayOrder}
                  required
                  defaultValue={0}
                />
              )}
            </Field>
          </div>
          <LabelFields
            prefix="create"
            language={locale}
            existing={undefined}
            copy={copy}
          />
        </ActionForm>
      </Panel>
    </section>
  );
}

/* ===========================================================================
 * One member
 * ========================================================================= */

function MemberRow({
  row,
  type,
  names,
  locale,
  timeZone,
  administer,
  copy,
}: {
  readonly row: StaffMembership;
  readonly type: MembershipTypeRecord | undefined;
  readonly names: ReadonlyMap<string, string>;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly administer: boolean;
  readonly copy: AdminMembershipCopy;
}) {
  const { t, s } = copy;
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MembershipStatusBadge status={row.status} t={s} />
        </div>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('members.member')}>
            <PersonName accountId={row.memberAccountId} names={names} copy={copy} />
          </DetailRow>
          <DetailRow term={t('members.type')}>
            <TypeTitle type={type} locale={locale} t={s} />
          </DetailRow>
          <DetailRow term={t('members.began')}>
            <MembershipTime value={row.activatedAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
          {row.closedAt === null ? null : (
            <DetailRow term={t('members.ended')}>
              <MembershipTime value={row.closedAt} locale={locale} timeZone={timeZone} />
              {row.closureSource === null
                ? null
                : ` — ${closureText(row.closureSource, s)}`}
            </DetailRow>
          )}
        </dl>
        {administer && row.status === 'active' ? (
          <ActionForm
            action={closeMembershipAction}
            submitLabel={t('members.close')}
            pendingLabel={t('pending')}
            tone="destructive"
            messages={copy.messages}
          >
            <RecordIdentity locale={locale} record={row} />
            <ConfirmField id={`close-${row.id}`} label={t('members.closeConfirm')} />
          </ActionForm>
        ) : null}
      </div>
    </Panel>
  );
}
