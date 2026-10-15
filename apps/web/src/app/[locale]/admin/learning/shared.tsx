import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  LEARNING_LIMITS,
  LEARNING_PAGE,
  LEARNING_STATES,
  learningIdSchema,
  learningStateSchema,
  type LearningState,
} from '@minhaj/contracts/learning';

import { pickLabel } from '@/components/my-learning/presentation';
import {
  Field,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { ActionForm, type FormActionState } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';

/**
 * The parts every Learning administration screen shares (Phase 22): the copy
 * and its refusal messages, the directory filter and pager, the lifecycle
 * badge and transitions, the per-locale label fields and the hidden fields
 * that make an edit an edit.
 *
 * `learning.read` OPENS A SCREEN, `learning.administer` IS WHAT EVERY ACTION
 * RE-CHECKS, live. Every form carries its record's expected version, so a
 * stale save is a visible conflict rather than a silent overwrite.
 *
 * NO RAW IDENTIFIERS AS THE PRIMARY UX. Records are listed and headed by their
 * resolved title, and an order is changed with named buttons whose accessible
 * names carry the item's title and position — never by editing a list of
 * identifiers.
 */

export type Query = Record<string, string | string[] | undefined>;

export interface ListParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}

export interface EditorParams {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}

/** The copy every Learning screen needs, and a message for every refusal. */
export async function learningCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'adminLearning' });
  return {
    t,
    messages: {
      success: t('saved'),
      denied: t('failure.denied'),
      invalid: t('failure.invalid'),
      conflict: t('failure.conflict'),
      'not-found': t('failure.notFound'),
      'duplicate-slug': t('failure.duplicateSlug'),
      'duplicate-member': t('failure.duplicateMember'),
      limit: t('failure.limit'),
      'not-draft': t('failure.notDraft'),
      incomplete: t('failure.incomplete'),
      'in-published-path': t('failure.inPublishedPath'),
      'course-unavailable': t('failure.courseUnavailable'),
      'not-enrolled': t('failure.invalid'),
      'rate-limited': t('failure.rateLimited'),
      'confirm-required': t('failure.confirmRequired'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type Copy = Awaited<ReturnType<typeof learningCopy>>;

/** `new` creates; otherwise the segment must be an identifier, or it is a 404. */
export function editorTarget(id: string): string {
  if (id === 'new' || learningIdSchema.safeParse(id).success) return id;
  notFound();
}

/** A record's title in the operator's locale where it has one, in its own language. */
export function Title({
  record,
  locale,
}: {
  readonly record: {
    readonly labels: readonly { readonly locale: Locale; readonly title: string }[];
    readonly primaryLocale: Locale;
  };
  readonly locale: Locale;
}) {
  const label = pickLabel(record.labels, locale, record.primaryLocale);
  return (
    <span lang={label?.locale} dir="auto" className="wrap-anywhere">
      {label?.title}
    </span>
  );
}

/** The plain-text title, for an accessible name that must carry it. */
export function titleText(
  labels: readonly { readonly locale: Locale; readonly title: string }[],
  locale: Locale,
  primaryLocale: Locale,
): string {
  return pickLabel(labels, locale, primaryLocale)?.title ?? '';
}

export function StateBadge({
  state,
  copy,
}: {
  readonly state: LearningState;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={state === 'published' ? 'positive' : 'neutral'}>
      {copy.t(`stateName.${state}`)}
    </StatusBadge>
  );
}

/** Previous and next pages of a directory, as links. */
export function Pager({
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
  const current = offset / LEARNING_PAGE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

/** The directory filter read back from the query, bounded. */
export function directoryQuery(query: Query) {
  const state = learningStateSchema.safeParse(queryValue(query, 'state'));
  return {
    offset: pageOffset(query, LEARNING_PAGE),
    state: state.success ? state.data : null,
    text: queryValue(query, 'text'),
  };
}

export function directoryHref(
  base: string,
  filter: ReturnType<typeof directoryQuery>,
): (page: number) => string {
  return (page) => {
    const search = new URLSearchParams();
    if (page > 1) search.set('page', String(page));
    if (filter.state !== null) search.set('state', filter.state);
    if (filter.text !== null) search.set('text', filter.text);
    const encoded = search.toString();
    return encoded === '' ? base : `${base}?${encoded}`;
  };
}

/** A page-only address, for the count summaries. */
export function pageHref(base: string): (page: number) => string {
  return (page) => (page > 1 ? `${base}?page=${String(page)}` : base);
}

/** A narrowing GET form for a directory: a state and a title or slug match. */
export function DirectoryFilter({
  base,
  filter,
  copy,
}: {
  readonly base: string;
  readonly filter: ReturnType<typeof directoryQuery>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <form method="get" action={base} className="flex flex-wrap items-end gap-3">
      <Field id="state-filter" label={t('state')}>
        {(props) => (
          <Select {...props} name="state" defaultValue={filter.state ?? ''}>
            <option value="">{t('allStates')}</option>
            {LEARNING_STATES.map((option) => (
              <option key={option} value={option}>
                {t(`stateName.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="text-filter" label={t('textFilter')}>
        {(props) => (
          <TextInput
            {...props}
            name="text"
            defaultValue={filter.text ?? ''}
            maxLength={200}
          />
        )}
      </Field>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
      >
        {t('filterApply')}
      </button>
    </form>
  );
}

/** The hidden fields that make an edit an edit: its record and expected version. */
export function EditIdentity({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: { readonly id: string; readonly version: number } | null;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}
    </>
  );
}

/** Slug and primary locale — the identity fields a Course and a path share. */
export function CatalogueIdentityFields({
  prefix,
  locale,
  record,
  copy,
}: {
  readonly prefix: string;
  readonly locale: Locale;
  readonly record: { readonly slug: string; readonly primaryLocale: Locale } | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field id={`${prefix}-slug`} label={t('slug')} help={t('slugHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="slug"
            required
            defaultValue={record?.slug ?? ''}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={120}
            dir="ltr"
          />
        )}
      </Field>
      <Field
        id={`${prefix}-primary`}
        label={t('primaryLocale')}
        help={t('primaryLocaleHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="primaryLocale"
            defaultValue={record?.primaryLocale ?? locale}
          >
            {localeSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`localeName.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

interface AnyLabel {
  readonly locale: Locale;
  readonly title: string;
  readonly summary: string;
  readonly description?: string;
  readonly body?: string;
}

/**
 * Enable, title and summary for each interface locale — plus a description
 * for a Course or a path, or a plain-text body for a lesson. A locale left
 * unticked is absent, never saved empty.
 */
export function LabelFields({
  prefix,
  locale,
  labels,
  primaryLocale,
  kind,
  copy,
}: {
  readonly prefix: string;
  readonly locale: Locale;
  readonly labels: readonly AnyLabel[];
  /** Which locale starts ticked when there are no labels yet. */
  readonly primaryLocale: Locale | null;
  readonly kind: 'catalogue' | 'outline' | 'lesson';
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="pb-1 text-sm font-medium">{t('labels')}</legend>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('labelsHelp')}
      </p>
      {localeSchema.options.map((language) => {
        const existing = labels.find((entry) => entry.locale === language);
        const id = `${prefix}-${language}`;
        return (
          <Panel key={language} as="div">
            <div className="flex flex-col gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`${language}-enabled`}
                  defaultChecked={
                    existing !== undefined ||
                    (labels.length === 0 && language === (primaryLocale ?? locale))
                  }
                  className="size-5"
                />
                {t('labelEnabled', { language: t(`localeName.${language}`) })}
              </label>
              <Field id={`${id}-title`} label={t('labelTitle')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name={`${language}-title`}
                    defaultValue={existing?.title ?? ''}
                    maxLength={LEARNING_LIMITS.title}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
              <Field id={`${id}-summary`} label={t('labelSummary')}>
                {(props) => (
                  <TextArea
                    {...props}
                    name={`${language}-summary`}
                    defaultValue={existing?.summary ?? ''}
                    maxLength={LEARNING_LIMITS.summary}
                    rows={2}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
              {kind === 'catalogue' ? (
                <Field id={`${id}-description`} label={t('labelDescription')}>
                  {(props) => (
                    <TextArea
                      {...props}
                      name={`${language}-description`}
                      defaultValue={existing?.description ?? ''}
                      maxLength={LEARNING_LIMITS.description}
                      rows={4}
                      lang={language}
                      dir="auto"
                    />
                  )}
                </Field>
              ) : null}
              {kind === 'lesson' ? (
                <Field id={`${id}-body`} label={t('labelBody')} help={t('labelBodyHelp')}>
                  {(props) => (
                    <TextArea
                      {...props}
                      name={`${language}-body`}
                      defaultValue={existing?.body ?? ''}
                      maxLength={LEARNING_LIMITS.lessonBody}
                      rows={12}
                      lang={language}
                      dir="auto"
                    />
                  )}
                </Field>
              ) : null}
            </div>
          </Panel>
        );
      })}
    </fieldset>
  );
}

/**
 * The lifecycle, as named acts — each its own small form carrying the version
 * the operator is looking at, with what it does said beside it. Whether it may
 * happen is the service's decision, reported in words when it refuses.
 */
export function Transitions({
  locale,
  record,
  action,
  kind,
  copy,
}: {
  readonly locale: Locale;
  readonly record: {
    readonly id: string;
    readonly version: number;
    readonly state: LearningState;
  };
  readonly action: (state: FormActionState, form: FormData) => Promise<FormActionState>;
  readonly kind: 'course' | 'path';
  readonly copy: Copy;
}) {
  const { t } = copy;
  const targets = LEARNING_STATES.filter((state) => state !== record.state);
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${kind}-lifecycle`}>
      <SectionHeading>
        <span id={`${kind}-lifecycle`}>{t('lifecycle.heading')}</span>
      </SectionHeading>
      <p className="text-sm">
        {t('lifecycle.current')} <StateBadge state={record.state} copy={copy} />
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {targets.map((state) => (
          <Panel key={state} as="div">
            <div className="flex flex-col gap-3">
              <p className="text-sm">{t(`lifecycle.${kind}.${state}`)}</p>
              <ActionForm
                action={action}
                submitLabel={t(`lifecycle.to.${state}`)}
                pendingLabel={t('pending')}
                messages={copy.messages}
                tone={state === 'published' ? 'primary' : 'secondary'}
              >
                <EditIdentity locale={locale} record={record} />
                <input type="hidden" name="state" value={state} />
              </ActionForm>
            </div>
          </Panel>
        ))}
      </div>
    </section>
  );
}
