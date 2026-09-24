import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { CONTRIBUTION_ROLES } from '@minhaj/contracts/people';
import {
  formatReaderDocument,
  libraryStateSchema,
  SCHOLARLY_LIMITS,
  type MagazineIssueRecord,
  type ScholarlyKind,
  type ScholarlyListingPage,
  type ScholarlyRecord,
  type StandaloneScholarlyKind,
} from '@minhaj/contracts/library';

import { requireAdminPage } from '@/composition/authorization';
import { libraryReferenceChoices, libraryRuntime } from '@/composition/library';
import { requireLocale } from '@/config/route-locale';
import {
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
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { issueNumbering } from '@/components/library/scholarly';
import {
  scholarlyLabel,
  scholarlyPath,
} from '@/components/library/scholarly-presentation';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, PAGE_SIZE, queryValue } from '../shared';
import { saveScholarly } from './actions';
import { libraryCopy } from './forms';

/**
 * The Phase-9 Library administration — Research, ResearchPaper, Publication,
 * Magazine, MagazineIssue and Encyclopedia (ROUTE_MAP.md §7).
 *
 * THE SAME AUTHORITIES AND THE SAME SHAPE AS THE WORK SCREENS. `library.read`
 * opens a screen and `library.administer` is what the action re-checks, live;
 * every screen is `noindex` and private through the administrative layouts; the
 * form carries the expected version, so a stale save is a conflict with a
 * message rather than a silent overwrite (DOMAIN_MODEL.md §19.8).
 *
 * ONE FORM, SIX AGGREGATES, AND ONLY THEIR OWN FIELDS. Each aggregate is shown the
 * fields it genuinely has — a Magazine has no content language and no date; only
 * Research and ResearchPaper have an abstract, an institutional context and
 * citations; only a paper has a venue and a DOI. Nothing is a JSON textarea.
 *
 * NO RAW IDENTIFIERS AS THE PRIMARY UX. Records are listed and headed by their
 * resolved title; contributors, topics and languages are chosen from their
 * owners' names; the issue form is reached from its Magazine.
 */

type ScholarlyReferenceChoices = Awaited<ReturnType<typeof libraryReferenceChoices>>;
type LibraryCopy = Awaited<ReturnType<typeof libraryCopy>>;

/** The directory path of each aggregate beneath `/{locale}/admin/library/`. */
const ADMIN_SEGMENT = Object.freeze({
  research: 'research',
  'research-paper': 'research/papers',
  publication: 'publications',
  encyclopedia: 'encyclopedias',
  magazine: 'magazines',
} as const satisfies Record<StandaloneScholarlyKind, string>);

/** The heading of each aggregate's directory, as the admin navigation names it. */
const ADMIN_TITLE = Object.freeze({
  research: 'admin.research',
  'research-paper': 'admin.research-papers',
  publication: 'admin.publications',
  encyclopedia: 'admin.encyclopedias',
  magazine: 'admin.magazines',
} as const satisfies Record<StandaloneScholarlyKind, string>);

/** How many repeated contributor and topic rows a form offers — as the Work form. */
const FORM_ROWS = 12;
const ROW_INDEXES = Array.from({ length: FORM_ROWS }, (_, index) => index);

/** Blank citation rows offered beyond the ones a record already has. */
const SPARE_CITATIONS = 5;

interface Params {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/* ===========================================================================
 * Directory
 * ========================================================================= */

function StateBadge({
  state,
  copy,
}: {
  readonly state: ScholarlyRecord['state'];
  readonly copy: LibraryCopy;
}) {
  return (
    <StatusBadge tone={state === 'published' ? 'positive' : 'neutral'}>
      {copy.t(`stateName.${state}`)}
    </StatusBadge>
  );
}

/**
 * One page of a directory as a table: the resolved title first, then the state
 * in words (never colour alone), the content language, the version the next save
 * must match, and when it last changed.
 */
function RecordTable({
  locale,
  page,
  caption,
  hrefFor,
  copy,
}: {
  readonly locale: Locale;
  readonly page: ScholarlyListingPage;
  readonly caption: string;
  readonly hrefFor: (id: string) => string;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;
  if (page.items.length === 0) return <EmptyState>{t('adminEmpty')}</EmptyState>;

  return (
    <DataTable
      caption={caption}
      columns={[
        t('labelTitle'),
        t('slug'),
        t('state'),
        t('contentLanguage'),
        t('version'),
        t('scholarlyAdmin.updated'),
      ]}
    >
      {page.items.map((row) => {
        const label = scholarlyLabel(row, locale);
        const numbering =
          row.issue === null
            ? null
            : issueNumbering(t, row.issue.volume, row.issue.issueNumber);
        return (
          <DataRow key={row.id}>
            <DataCell wrap>
              <TextLink href={hrefFor(row.id)}>
                <span lang={label.locale} dir="auto">
                  {label.title}
                </span>
              </TextLink>
              {numbering === null ? null : (
                <span className="block text-sm text-[color:var(--color-foreground-muted)]">
                  {numbering}
                </span>
              )}
            </DataCell>
            <DataCell wrap>{row.slug}</DataCell>
            <DataCell>
              <StateBadge state={row.state} copy={copy} />
            </DataCell>
            <DataCell>{row.languageCode ?? '—'}</DataCell>
            <DataCell>{row.version}</DataCell>
            <DataCell>
              <time dateTime={row.updatedAt.toISOString()}>
                {row.updatedAt.toISOString().slice(0, 10)}
              </time>
            </DataCell>
          </DataRow>
        );
      })}
    </DataTable>
  );
}

function Pager({
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
  readonly copy: LibraryCopy;
}) {
  if (offset === 0 && !hasMore) return null;
  const current = offset / PAGE_SIZE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

/** A narrowing GET form for the contributor choices, beside — never inside — a save form. */
function ReferenceSearch({
  query,
  copy,
}: {
  readonly query: string;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field id="reference-query" label={t('referenceQuery')}>
          {(props) => (
            <TextInput {...props} name="q" defaultValue={query} maxLength={200} />
          )}
        </Field>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
        >
          {t('findReferences')}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('referenceHelp')}
      </p>
    </>
  );
}

/**
 * `/{locale}/admin/library/{research|research/papers|publications|encyclopedias|magazines}`
 * — the directory of one aggregate, with a state filter and the create form.
 */
export async function ScholarlyDirectory({
  kind,
  params,
  searchParams,
}: Params & { readonly kind: StandaloneScholarlyKind }) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/library/${ADMIN_SEGMENT[kind]}`;
  const context = await requireAdminPage(locale, 'library.read', base);

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const offset = pageOffset(query, PAGE_SIZE);
  const state = libraryStateSchema.safeParse(queryValue(query, 'state'));
  const reference = queryValue(query, 'q') ?? '';

  const [page, choices] = await Promise.all([
    libraryRuntime().library.scholarlyRecords(actor, kind, {
      offset,
      state: state.success ? state.data : null,
    }),
    libraryReferenceChoices(locale, reference),
  ]);

  const title = t(ADMIN_TITLE[kind]);
  const pageHref = (page: number) => {
    const search = new URLSearchParams();
    if (page > 1) search.set('page', String(page));
    if (state.success) search.set('state', state.data);
    const text = search.toString();
    return text === '' ? base : `${base}?${text}`;
  };

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{title}</PageHeading>

      {kind === 'research' || kind === 'research-paper' ? (
        <nav className="flex flex-wrap gap-4 text-sm" aria-label={t('admin.research')}>
          <TextLink href={`/${locale}/admin/library/research`}>
            {t('admin.research')}
          </TextLink>
          <TextLink href={`/${locale}/admin/library/research/papers`}>
            {t('admin.research-papers')}
          </TextLink>
        </nav>
      ) : null}

      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <Field id="state-filter" label={t('state')}>
          {(props) => (
            <Select
              {...props}
              name="state"
              defaultValue={state.success ? state.data : ''}
            >
              <option value="">{t('scholarlyAdmin.allStates')}</option>
              {libraryStateSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`stateName.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
        >
          {t('filterApply')}
        </button>
      </form>

      <RecordTable
        locale={locale}
        page={page}
        caption={title}
        hrefFor={(id) => `${base}/${id}`}
        copy={copy}
      />
      <Pager
        offset={offset}
        hasMore={page.hasMore}
        hrefFor={pageHref}
        label={title}
        copy={copy}
      />

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t(`scholarlyAdmin.create.${kind}`)}</SectionHeading>
          <ReferenceSearch query={reference} copy={copy} />
          <ScholarlyForm
            locale={locale}
            kind={kind}
            record={null}
            magazineId={null}
            choices={choices}
            copy={copy}
          />
        </div>
      </Panel>
    </main>
  );
}

/* ===========================================================================
 * Editors
 * ========================================================================= */

interface EditorParams {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Editing one standalone record. A Magazine's editor also lists its issues, in
 * the periodical's own order, and offers the create-issue form — which is why an
 * issue is never created without its Magazine.
 */
export async function ScholarlyEditor({
  kind,
  params,
  searchParams,
}: EditorParams & { readonly kind: StandaloneScholarlyKind }) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/library/${ADMIN_SEGMENT[kind]}`;
  const context = await requireAdminPage(locale, 'library.read', base);

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  // A malformed identifier is the page's own 404, not an error boundary.
  const record = await libraryRuntime()
    .library.scholarlyRecord(actor, kind, id)
    .catch(() => null);
  if (record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const offset = pageOffset(query, PAGE_SIZE);
  const [choices, issues] = await Promise.all([
    libraryReferenceChoices(locale, reference),
    kind === 'magazine'
      ? libraryRuntime().library.scholarlyRecords(actor, 'magazine-issue', {
          offset,
          magazineId: record.id,
        })
      : Promise.resolve(null),
  ]);

  const label = scholarlyLabel(record, locale);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('scholarlyAdmin.backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span lang={label.locale} dir="auto">
            {label.title}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          <span>
            {t('version')}: {record.version}
          </span>
          {record.state === 'published' ? (
            <TextLink href={scholarlyPath(locale, kind, record.slug)}>
              {t('scholarlyAdmin.viewPublic')}
            </TextLink>
          ) : null}
        </p>
      </div>

      {issues === null ? null : (
        <section className="flex flex-col gap-4">
          <SectionHeading>{t('scholarly.issues')}</SectionHeading>
          <RecordTable
            locale={locale}
            page={issues}
            caption={t('scholarly.issues')}
            hrefFor={(issueId) => `${base}/${record.id}/issues/${issueId}`}
            copy={copy}
          />
          <Pager
            offset={offset}
            hasMore={issues.hasMore}
            hrefFor={(page) =>
              `${base}/${record.id}${page > 1 ? `?page=${String(page)}` : ''}`
            }
            label={t('scholarly.issues')}
            copy={copy}
          />
          <Panel>
            <div className="flex flex-col gap-4">
              <SectionHeading>{t('scholarlyAdmin.create.magazine-issue')}</SectionHeading>
              <ScholarlyForm
                locale={locale}
                kind="magazine-issue"
                record={null}
                magazineId={record.id}
                choices={choices}
                copy={copy}
              />
            </div>
          </Panel>
        </section>
      )}

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t(`scholarlyAdmin.edit.${kind}`)}</SectionHeading>
          <ReferenceSearch query={reference} copy={copy} />
          <ScholarlyForm
            locale={locale}
            kind={kind}
            record={record}
            magazineId={null}
            choices={choices}
            copy={copy}
          />
        </div>
      </Panel>
    </main>
  );
}

/**
 * `/{locale}/admin/library/magazines/{id}/issues/{issueId}` — one issue, edited
 * beneath its Magazine. An issue addressed under another Magazine is a 404: the
 * URL may not re-parent it.
 */
export async function IssueEditor({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly locale: string;
    readonly id: string;
    readonly issueId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { id, issueId } = await params;
  const query = await searchParams;
  const magazinePath = `/${locale}/admin/library/magazines/${id}`;
  const context = await requireAdminPage(
    locale,
    'library.read',
    `/${locale}/admin/library/magazines`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  const record: MagazineIssueRecord | null = await libraryRuntime()
    .library.scholarlyRecord(actor, 'magazine-issue', issueId)
    .catch(() => null);
  if (record === null || record.magazineId !== id) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const choices = await libraryReferenceChoices(locale, reference);
  const label = scholarlyLabel(record, locale);
  const magazine = scholarlyLabel(record.magazine, locale);
  const numbering = issueNumbering(t, record.volume, record.issueNumber);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={magazinePath}>
          {t('scholarlyAdmin.backToMagazine')}:{' '}
          <span lang={magazine.locale} dir="auto">
            {magazine.title}
          </span>
        </TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span lang={label.locale} dir="auto">
            {label.title}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          {numbering === null ? null : <span>{numbering}</span>}
          <span>
            {t('version')}: {record.version}
          </span>
        </p>
      </div>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('scholarlyAdmin.edit.magazine-issue')}</SectionHeading>
          <ReferenceSearch query={reference} copy={copy} />
          <ScholarlyForm
            locale={locale}
            kind="magazine-issue"
            record={record}
            magazineId={record.magazineId}
            choices={choices}
            copy={copy}
          />
        </div>
      </Panel>
    </main>
  );
}

/* ===========================================================================
 * The form
 * ========================================================================= */

/** The currently selected person stays offered even when off the first page. */
function personOptions(
  people: ScholarlyReferenceChoices['people'],
  selected: string | undefined,
): readonly { readonly id: string; readonly name: string }[] {
  if (selected === undefined || people.some((person) => person.id === selected))
    return people;
  return [{ id: selected, name: selected }, ...people];
}

/** The form's view of a record, whichever aggregate it is. */
interface FormFields {
  readonly languageCode: string;
  readonly publicationYear: number | null;
  readonly publishedOn: string | null;
  readonly document: string;
  readonly institutionalContext: string | null;
  readonly abstract: string | null;
  readonly citations: readonly { text: string; url: string | null; doi: string | null }[];
  readonly venue: string | null;
  readonly doi: string | null;
  readonly publisher: string | null;
  readonly volume: number | null;
  readonly issueNumber: number | null;
}

const NO_FIELDS: FormFields = {
  languageCode: '',
  publicationYear: null,
  publishedOn: null,
  document: '',
  institutionalContext: null,
  abstract: null,
  citations: [],
  venue: null,
  doi: null,
  publisher: null,
  volume: null,
  issueNumber: null,
};

function fieldsOf(record: ScholarlyRecord | null): FormFields {
  if (record === null || record.kind === 'magazine') return NO_FIELDS;
  const dated: FormFields = {
    ...NO_FIELDS,
    languageCode: record.languageCode,
    publicationYear: record.publicationYear,
    publishedOn: record.publishedOn,
    // The inverse of the authoring format, so editing is a round trip.
    document: record.document === null ? '' : formatReaderDocument(record.document),
  };
  switch (record.kind) {
    case 'research':
      return {
        ...dated,
        institutionalContext: record.institutionalContext,
        abstract: record.abstract,
        citations: record.citations,
      };
    case 'research-paper':
      return {
        ...dated,
        institutionalContext: record.institutionalContext,
        abstract: record.abstract,
        citations: record.citations,
        venue: record.venue,
        doi: record.doi,
      };
    case 'publication':
    case 'encyclopedia':
      return { ...dated, publisher: record.publisher };
    case 'magazine-issue':
      return { ...dated, volume: record.volume, issueNumber: record.issueNumber };
  }
}

function ScholarlyForm({
  locale,
  kind,
  record,
  magazineId,
  choices,
  copy,
}: {
  readonly locale: Locale;
  readonly kind: ScholarlyKind;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: ScholarlyRecord | null;
  /** The Magazine an issue belongs to; `null` for every other aggregate. */
  readonly magazineId: string | null;
  readonly choices: ScholarlyReferenceChoices;
  readonly copy: LibraryCopy;
}) {
  const { t } = copy;
  const prefix = record === null ? `new-${kind}` : kind;
  const dated = kind !== 'magazine';
  const cited = kind === 'research' || kind === 'research-paper';
  const fields = fieldsOf(record);
  const citationRows = Math.min(
    SCHOLARLY_LIMITS.citations,
    fields.citations.length + SPARE_CITATIONS,
  );

  return (
    <ActionForm
      action={saveScholarly}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="kind" value={kind} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}
      {magazineId === null ? null : (
        <input type="hidden" name="magazineId" value={magazineId} />
      )}

      <Field id={`${prefix}-slug`} label={t('slug')} help={t('scholarlyAdmin.slugHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="slug"
            required
            defaultValue={record?.slug ?? ''}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={120}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
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
                  {option}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id={`${prefix}-state`}
          label={t('state')}
          help={t('scholarlyAdmin.stateHelp')}
        >
          {(props) => (
            <Select {...props} name="state" defaultValue={record?.state ?? 'draft'}>
              {libraryStateSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`stateName.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <SectionHeading>{t('labels')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scholarlyAdmin.labelsHelp')}
      </p>
      {localeSchema.options.map((language) => {
        const existing = record?.labels.find((entry) => entry.locale === language);
        return (
          <Panel key={language}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`${language}-enabled`}
                  defaultChecked={
                    existing !== undefined ||
                    language === (record?.primaryLocale ?? locale)
                  }
                  className="size-5"
                />
                {language}
              </label>
              <Field id={`${prefix}-title-${language}`} label={t('labelTitle')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name={`${language}-title`}
                    defaultValue={existing?.title ?? ''}
                    maxLength={SCHOLARLY_LIMITS.title}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
              <Field
                id={`${prefix}-summary-${language}`}
                label={t('scholarlyAdmin.summary')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`${language}-summary`}
                    defaultValue={existing?.summary ?? ''}
                    maxLength={SCHOLARLY_LIMITS.summary}
                    rows={3}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
            </div>
          </Panel>
        );
      })}

      {dated ? (
        <>
          <SectionHeading>{t('scholarlyAdmin.facts')}</SectionHeading>
          <Field
            id={`${prefix}-language`}
            label={t('contentLanguage')}
            help={t('scholarlyAdmin.contentLanguageHelp')}
          >
            {(props) => (
              <Select
                {...props}
                name="languageCode"
                required
                defaultValue={fields.languageCode}
              >
                <option value="">{t('none')}</option>
                {choices.languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name} ({language.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${prefix}-year`}
              label={t('scholarlyAdmin.publicationYear')}
              help={t('scholarlyAdmin.publicationYearHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="publicationYear"
                  type="number"
                  min={1}
                  max={9999}
                  inputMode="numeric"
                  defaultValue={fields.publicationYear ?? ''}
                />
              )}
            </Field>
            <Field
              id={`${prefix}-date`}
              label={t('scholarlyAdmin.publishedOn')}
              help={t('scholarlyAdmin.publishedOnHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="publishedOn"
                  type="date"
                  defaultValue={fields.publishedOn ?? ''}
                />
              )}
            </Field>
          </div>
        </>
      ) : null}

      {kind === 'magazine-issue' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${prefix}-volume`}
            label={t('scholarlyAdmin.volume')}
            help={t('scholarlyAdmin.numbersHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="volume"
                type="number"
                min={1}
                max={SCHOLARLY_LIMITS.issueNumber}
                inputMode="numeric"
                defaultValue={fields.volume ?? ''}
              />
            )}
          </Field>
          <Field id={`${prefix}-number`} label={t('scholarlyAdmin.issueNumber')}>
            {(props) => (
              <TextInput
                {...props}
                name="issueNumber"
                type="number"
                min={1}
                max={SCHOLARLY_LIMITS.issueNumber}
                inputMode="numeric"
                defaultValue={fields.issueNumber ?? ''}
              />
            )}
          </Field>
        </div>
      ) : null}

      {kind === 'publication' || kind === 'encyclopedia' ? (
        <Field
          id={`${prefix}-publisher`}
          label={t('scholarlyAdmin.publisher')}
          help={t('scholarlyAdmin.publisherHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="publisher"
              maxLength={SCHOLARLY_LIMITS.publisher}
              defaultValue={fields.publisher ?? ''}
              dir="auto"
            />
          )}
        </Field>
      ) : null}

      {kind === 'research-paper' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`${prefix}-venue`}
            label={t('scholarlyAdmin.venue')}
            help={t('scholarlyAdmin.venueHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="venue"
                maxLength={SCHOLARLY_LIMITS.venue}
                defaultValue={fields.venue ?? ''}
                dir="auto"
              />
            )}
          </Field>
          <Field
            id={`${prefix}-doi`}
            label={t('scholarlyAdmin.doi')}
            help={t('scholarlyAdmin.doiHelp')}
          >
            {(props) => (
              <TextInput
                {...props}
                name="doi"
                maxLength={SCHOLARLY_LIMITS.doi}
                defaultValue={fields.doi ?? ''}
                dir="ltr"
              />
            )}
          </Field>
        </div>
      ) : null}

      {cited ? (
        <>
          <Field
            id={`${prefix}-context`}
            label={t('scholarlyAdmin.institutionalContext')}
            help={t('scholarlyAdmin.institutionalContextHelp')}
          >
            {(props) => (
              <TextArea
                {...props}
                name="institutionalContext"
                maxLength={SCHOLARLY_LIMITS.institutionalContext}
                rows={2}
                defaultValue={fields.institutionalContext ?? ''}
                dir="auto"
              />
            )}
          </Field>
          <Field
            id={`${prefix}-abstract`}
            label={t('scholarlyAdmin.abstract')}
            help={t('scholarlyAdmin.abstractHelp')}
          >
            {(props) => (
              <TextArea
                {...props}
                name="abstract"
                maxLength={SCHOLARLY_LIMITS.abstract}
                rows={6}
                defaultValue={fields.abstract ?? ''}
                dir="auto"
              />
            )}
          </Field>
        </>
      ) : null}

      {dated ? (
        <Field
          id={`${prefix}-document`}
          label={t('scholarlyAdmin.document')}
          help={t('documentHelp')}
        >
          {(props) => (
            <TextArea
              {...props}
              name="document"
              rows={10}
              defaultValue={fields.document}
              dir="auto"
            />
          )}
        </Field>
      ) : null}

      <SectionHeading>{t('contributors')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('contributorsHelp')}
      </p>
      {ROW_INDEXES.map((index) => {
        const existing = record?.contributors[index];
        return (
          <div key={index} className="grid gap-3 sm:grid-cols-2">
            <Field id={`${prefix}-person-${String(index)}`} label={t('person')}>
              {(props) => (
                <Select
                  {...props}
                  name={`person-${String(index)}`}
                  defaultValue={existing?.personId ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {personOptions(choices.people, existing?.personId).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id={`${prefix}-role-${String(index)}`} label={t('contributorRole')}>
              {(props) => (
                <Select
                  {...props}
                  name={`role-${String(index)}`}
                  defaultValue={existing?.role ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {CONTRIBUTION_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`role.${role}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        );
      })}

      <SectionHeading>{t('topics')}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        {ROW_INDEXES.map((index) => (
          <Field key={index} id={`${prefix}-topic-${String(index)}`} label={t('topic')}>
            {(props) => (
              <Select
                {...props}
                name={`topic-${String(index)}`}
                defaultValue={record?.topicIds[index] ?? ''}
              >
                <option value="">{t('none')}</option>
                {choices.topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>

      {cited ? (
        <>
          <SectionHeading>{t('scholarly.citations')}</SectionHeading>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('scholarlyAdmin.citationsHelp')}
          </p>
          <ol className="flex flex-col gap-4">
            {Array.from({ length: citationRows }, (_, index) => {
              const existing = fields.citations[index];
              const id = `${prefix}-citation-${String(index)}`;
              return (
                <li key={index}>
                  <Panel>
                    <div className="flex flex-col gap-3">
                      <Field
                        id={`${id}-text`}
                        label={t('scholarlyAdmin.citationText', { number: index + 1 })}
                      >
                        {(props) => (
                          <TextArea
                            {...props}
                            name={`citation-${String(index)}-text`}
                            maxLength={SCHOLARLY_LIMITS.citationText}
                            rows={2}
                            defaultValue={existing?.text ?? ''}
                            dir="auto"
                          />
                        )}
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id={`${id}-url`} label={t('scholarlyAdmin.citationUrl')}>
                          {(props) => (
                            <TextInput
                              {...props}
                              name={`citation-${String(index)}-url`}
                              type="url"
                              maxLength={SCHOLARLY_LIMITS.url}
                              defaultValue={existing?.url ?? ''}
                              dir="ltr"
                            />
                          )}
                        </Field>
                        <Field id={`${id}-doi`} label={t('scholarlyAdmin.doi')}>
                          {(props) => (
                            <TextInput
                              {...props}
                              name={`citation-${String(index)}-doi`}
                              maxLength={SCHOLARLY_LIMITS.doi}
                              defaultValue={existing?.doi ?? ''}
                              dir="ltr"
                            />
                          )}
                        </Field>
                      </div>
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </ActionForm>
  );
}
