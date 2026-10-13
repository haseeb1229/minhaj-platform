import { notFound } from 'next/navigation';

import {
  FATWA_LIMITS,
  FATWA_PAGE_SIZE,
  FATWA_PERMISSIONS,
  type FatwaRecord,
  type FatwaRevisionRecord,
} from '@minhaj/contracts/fatwa';

import { requireAdminPage } from '@/composition/authorization';
import { fatwaRuntime } from '@/composition/fatwa';
import { ownerReferenceChoices } from '@/composition/owner-references';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
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
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import { saveFatwaDraft, submitFatwaForReview } from './actions';
import {
  actorOf,
  categoryNames,
  DateText,
  DetailHeading,
  fatwaCopy,
  languageNames,
  Pager,
  recordTarget,
  RevisionView,
  shortReference,
  StageBadge,
  topicNames,
  WrittenText,
  type Copy,
  type ListParams,
  type Query,
} from './shared';

/**
 * The drafting screens (ROUTE_MAP.md §7: `/admin/fatwa/drafts`), Phase 20 —
 * under `fatwa.answer`, and only for the questions assigned to the actor NOW.
 *
 * THE PUBLIC QUESTION IS WRITTEN, NOT DERIVED. The private question is shown
 * for reference beside the form; the public question is a separate field the
 * answerer writes in their own anonymised words. Nothing copies, pre-fills,
 * redacts or rewrites it from the original, and the form says so where the
 * field is.
 *
 * EVERY SAVE IS A NEW REVISION. Nothing is edited in place: the list of
 * revisions below the form is the immutable record, and the form carries the
 * ruling's expected version so a stale save is a visible conflict. Once the
 * ruling has been published its address is fixed, and any new revision is a
 * correction that states its public reason.
 */

const SLUG_PATTERN = '[a-z0-9]+(-[a-z0-9]+)*';

/** The revision a new draft starts from: the pending one, else the public one. */
function startingRevision(fatwa: FatwaRecord | null): FatwaRevisionRecord | null {
  if (fatwa === null) return null;
  const id = fatwa.pendingRevisionId ?? fatwa.publishedRevisionId;
  return fatwa.revisions.find((revision) => revision.id === id) ?? null;
}

/* ===========================================================================
 * The actor's assigned questions
 * ========================================================================= */

export async function DraftsScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/fatwa/drafts`;
  const context = await requireAdminPage(locale, FATWA_PERMISSIONS.answer, base);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;
  const offset = pageOffset(query, FATWA_PAGE_SIZE);

  const [page, categories] = await Promise.all([
    workflow.assigned(actor, offset),
    workflow.categories(actor),
  ]);
  const names = categoryNames(categories, locale);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.drafts')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.drafts')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('drafts.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.drafts')}
          columns={[
            t('question.reference'),
            t('stage'),
            t('category'),
            t('submitted'),
            t('updated'),
          ]}
        >
          {page.items.map((row) => (
            <DataRow key={row.id}>
              <DataCell>
                <TextLink href={`${base}/${row.id}`}>
                  {t('drafts.write')}{' '}
                  <span dir="ltr" className="text-xs">
                    {shortReference(row.id)}
                  </span>
                </TextLink>
              </DataCell>
              <DataCell>
                <StageBadge stage={row.stage} copy={copy} />
              </DataCell>
              <DataCell wrap>
                <span dir="auto">
                  {row.categoryId === null
                    ? t('categoryUnset')
                    : (names.get(row.categoryId) ?? t('categoryUnavailable'))}
                </span>
              </DataCell>
              <DataCell>
                <DateText date={row.submittedAt} locale={locale} />
              </DataCell>
              <DataCell>
                <DateText date={row.updatedAt} locale={locale} />
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        shown={page.items.length}
        total={page.total}
        base={base}
        copy={copy}
      />
    </main>
  );
}

/* ===========================================================================
 * One assigned question — the private question, the ruling and the draft form
 * ========================================================================= */

/** The topic chooser's narrowing search: a GET form beside — never inside — the draft form. */
function TopicSearch({ query, copy }: { readonly query: string; readonly copy: Copy }) {
  const { t } = copy;
  return (
    <div className="flex flex-col gap-2">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field id="fatwa-topic-search" label={t('draft.topicSearch')}>
          {(props) => (
            <TextInput {...props} name="topics" defaultValue={query} maxLength={200} />
          )}
        </Field>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
        >
          {t('draft.topicSearchSubmit')}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('draft.topicSearchHelp')}
      </p>
    </div>
  );
}

export async function DraftScreen({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly questionId: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const questionId = recordTarget((await params).questionId);
  const query = await searchParams;
  const list = `/${locale}/admin/fatwa/drafts`;
  const context = await requireAdminPage(
    locale,
    FATWA_PERMISSIONS.answer,
    `${list}/${questionId}`,
  );
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;

  // Both reads are scoped to a question assigned to this account now; the
  // question's is recorded as a data access.
  const [question, fatwa] = await Promise.all([
    workflow.assignedQuestion(actor, questionId),
    workflow.assignedFatwa(actor, questionId),
  ]);
  if (question === null && fatwa === null) notFound();

  const topicQuery = queryValue(query, 'topics') ?? '';
  const [categories, choices, languages] = await Promise.all([
    workflow.categories(actor),
    ownerReferenceChoices(locale, ''),
    languageNames(),
  ]);
  const names = categoryNames(categories, locale);
  const start = startingRevision(fatwa);
  const published =
    fatwa?.revisions.find((revision) => revision.id === fatwa.publishedRevisionId) ??
    null;
  const shownTopicIds = fatwa?.revisions.flatMap((revision) => revision.topicIds) ?? [];
  const topics = await topicNames(shownTopicIds, locale);

  const isCorrection = fatwa?.firstPublishedAt != null;
  const editable =
    fatwa === null
      ? question?.stage === 'assigned'
      : fatwa.withdrawnAt === null && fatwa.reviewState !== 'in_review';

  // Only an ACTIVE category, topic and language can be saved.
  const activeCategories = categories.filter((category) => category.status === 'active');
  const defaultCategory = start?.categoryId ?? question?.categoryId ?? '';
  const activeTopicIds = new Set(choices.topics.map((topic) => topic.id));
  const chosen = (start?.topicIds ?? []).filter((id) => activeTopicIds.has(id));
  const dropped = (start?.topicIds.length ?? 0) - chosen.length;
  const needle = topicQuery.toLocaleLowerCase(locale);
  const offeredTopics = choices.topics.filter(
    (topic) =>
      chosen.includes(topic.id) ||
      needle === '' ||
      topic.name.toLocaleLowerCase(locale).includes(needle),
  );
  const pending =
    fatwa?.revisions.find((revision) => revision.id === fatwa.pendingRevisionId) ?? null;
  const returnNotes = (fatwa?.notes ?? []).filter((note) => note.decision === 'returned');
  const revisionNumber = new Map(
    (fatwa?.revisions ?? []).map((revision) => [revision.id, revision.number]),
  );

  return (
    <main className="flex flex-col gap-8">
      <DetailHeading back={list} copy={copy}>
        {t('drafts.heading')}{' '}
        <span dir="ltr" className="text-base font-normal">
          {shortReference(questionId)}
        </span>
      </DetailHeading>

      {question === null ? null : (
        <dl className="grid gap-x-6 sm:grid-cols-2">
          <DetailRow term={t('stage')}>
            <StageBadge stage={question.stage} copy={copy} />
          </DetailRow>
          <DetailRow term={t('submitted')}>
            <DateText date={question.submittedAt} locale={locale} time />
          </DetailRow>
        </dl>
      )}

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('question.private')}</SectionHeading>
          {question === null ? (
            <p className="text-sm">{t('question.unavailable')}</p>
          ) : (
            <>
              <Alert tone="info">{t('question.accessNotice')}</Alert>
              <WrittenText text={question.body} />
            </>
          )}
        </div>
      </Panel>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-ruling">
        <h2 id="fatwa-ruling" className="text-lg font-semibold tracking-tight">
          {t('ruling.heading')}
        </h2>
        {fatwa === null ? (
          <p className="text-sm">{t('ruling.notStarted')}</p>
        ) : (
          <>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <DetailRow term={t('draft.slug')}>
                <span dir="ltr">{fatwa.slug}</span>
              </DetailRow>
              <DetailRow term={t('ruling.status')}>
                {fatwa.withdrawnAt !== null ? (
                  <StatusBadge tone="caution">{t('ruling.withdrawn')}</StatusBadge>
                ) : fatwa.reviewState !== null ? (
                  <StatusBadge tone="neutral">
                    {t(`reviewStateName.${fatwa.reviewState}`)}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="positive">{t('ruling.publicNow')}</StatusBadge>
                )}
              </DetailRow>
              {fatwa.firstPublishedAt === null ? null : (
                <DetailRow term={t('published.firstPublished')}>
                  <DateText date={fatwa.firstPublishedAt} locale={locale} />
                </DetailRow>
              )}
              <DetailRow term={t('version')}>{fatwa.version}</DetailRow>
            </dl>

            <DataTable
              caption={t('ruling.revisions')}
              columns={[t('revision.number'), t('revision.created'), t('revision.state')]}
            >
              {[...fatwa.revisions]
                .sort((a, b) => b.number - a.number)
                .map((revision) => (
                  <DataRow key={revision.id}>
                    <DataCell>{revision.number}</DataCell>
                    <DataCell>
                      <DateText date={revision.createdAt} locale={locale} time />
                    </DataCell>
                    <DataCell wrap>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {revision.publishedAt === null ? (
                          t('revision.notPublished')
                        ) : (
                          <>
                            {t('revision.published')}{' '}
                            <DateText date={revision.publishedAt} locale={locale} />
                          </>
                        )}
                        {revision.id === fatwa.pendingRevisionId ? (
                          <StatusBadge tone="neutral">
                            {t('revision.pending')}
                          </StatusBadge>
                        ) : null}
                        {revision.id === fatwa.publishedRevisionId &&
                        fatwa.withdrawnAt === null ? (
                          <StatusBadge tone="positive">
                            {t('revision.current')}
                          </StatusBadge>
                        ) : null}
                      </span>
                    </DataCell>
                  </DataRow>
                ))}
            </DataTable>
          </>
        )}
      </section>

      {returnNotes.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="fatwa-notes">
          <h2 id="fatwa-notes" className="text-lg font-semibold tracking-tight">
            {t('ruling.notes')}
          </h2>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('ruling.notesHelp')}
          </p>
          <ul className="flex flex-col gap-3">
            {[...returnNotes]
              .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())
              .map((note) => (
                <Panel key={`${note.revisionId}-${note.decidedAt.toISOString()}`} as="li">
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-[color:var(--color-foreground-muted)]">
                      {t('ruling.noteFor', {
                        number: revisionNumber.get(note.revisionId) ?? 0,
                      })}{' '}
                      · <DateText date={note.decidedAt} locale={locale} time />
                    </p>
                    <WrittenText text={note.note} />
                  </div>
                </Panel>
              ))}
          </ul>
        </section>
      )}

      {published === null || !isCorrection || fatwa?.withdrawnAt !== null ? null : (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('ruling.currentPublished')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('ruling.currentPublishedHelp')}
            </p>
            <RevisionView
              revision={published}
              categories={names}
              topics={topics}
              languages={languages}
              copy={copy}
            />
          </div>
        </Panel>
      )}

      {fatwa?.withdrawnAt != null ? (
        <Alert tone="warning">{t('ruling.withdrawnNotice')}</Alert>
      ) : fatwa?.reviewState === 'in_review' ? (
        <Alert tone="info">{t('ruling.inReviewNotice')}</Alert>
      ) : null}

      {!editable ? null : (
        <section className="flex flex-col gap-4" aria-labelledby="fatwa-draft">
          <h2 id="fatwa-draft" className="text-lg font-semibold tracking-tight">
            {isCorrection ? t('draft.correctionHeading') : t('draft.heading')}
          </h2>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('draft.help')}
          </p>

          <TopicSearch query={topicQuery} copy={copy} />

          {activeCategories.length === 0 ? (
            <Alert tone="warning">{t('draft.noCategories')}</Alert>
          ) : (
            <ActionForm
              action={saveFatwaDraft}
              submitLabel={t('draft.submit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
              preserveInput
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="questionId" value={questionId} />
              <input type="hidden" name="version" value={String(fatwa?.version ?? 0)} />

              {isCorrection && fatwa !== null ? (
                <p className="text-sm">
                  <input type="hidden" name="slug" value={fatwa.slug} />
                  {t('draft.slug')}: <span dir="ltr">{fatwa.slug}</span>
                  <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                    {t('draft.slugFixed')}
                  </span>
                </p>
              ) : (
                <Field
                  id="fatwa-draft-slug"
                  label={t('draft.slug')}
                  help={t('draft.slugHelp')}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name="slug"
                      required
                      pattern={SLUG_PATTERN}
                      maxLength={120}
                      dir="ltr"
                      defaultValue={fatwa?.slug ?? ''}
                    />
                  )}
                </Field>
              )}

              <Field
                id="fatwa-draft-title"
                label={t('draft.title')}
                help={t('draft.titleHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name="title"
                    required
                    maxLength={FATWA_LIMITS.title}
                    dir="auto"
                    defaultValue={start?.title ?? ''}
                  />
                )}
              </Field>

              <div className="flex flex-col gap-2">
                <Alert tone="warning">{t('draft.publicQuestionInstruction')}</Alert>
                <Field
                  id="fatwa-draft-public-question"
                  label={t('draft.publicQuestion')}
                  help={t('draft.publicQuestionHelp', {
                    min: FATWA_LIMITS.publicQuestionMin,
                    max: FATWA_LIMITS.publicQuestionMax,
                  })}
                >
                  {(props) => (
                    <TextArea
                      {...props}
                      name="publicQuestion"
                      required
                      rows={6}
                      minLength={FATWA_LIMITS.publicQuestionMin}
                      maxLength={FATWA_LIMITS.publicQuestionMax}
                      dir="auto"
                      defaultValue={start?.publicQuestion ?? ''}
                    />
                  )}
                </Field>
              </div>

              <Field
                id="fatwa-draft-ruling"
                label={t('draft.ruling')}
                help={t('draft.rulingHelp', {
                  min: FATWA_LIMITS.rulingMin,
                  max: FATWA_LIMITS.rulingMax,
                })}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name="ruling"
                    required
                    rows={16}
                    minLength={FATWA_LIMITS.rulingMin}
                    maxLength={FATWA_LIMITS.rulingMax}
                    dir="auto"
                    defaultValue={start?.ruling ?? ''}
                  />
                )}
              </Field>

              <Field
                id="fatwa-draft-language"
                label={t('draft.language')}
                help={t('draft.languageHelp')}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="language"
                    required
                    defaultValue={
                      choices.languages.some(
                        (language) => language.code === start?.language,
                      )
                        ? (start?.language ?? '')
                        : ''
                    }
                  >
                    <option value="">{t('draft.languageChoose')}</option>
                    {choices.languages.map((language) => (
                      <option key={language.code} value={language.code}>
                        {`${language.name} (${language.code})`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                id="fatwa-draft-category"
                label={t('category')}
                help={t('draft.categoryHelp')}
              >
                {(props) => (
                  <Select
                    {...props}
                    name="categoryId"
                    required
                    defaultValue={
                      activeCategories.some((category) => category.id === defaultCategory)
                        ? defaultCategory
                        : ''
                    }
                  >
                    <option value="">{t('triage.choose')}</option>
                    {activeCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {names.get(category.id)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <fieldset
                className="flex flex-col gap-2"
                aria-describedby="fatwa-draft-topics-help"
              >
                <legend className="text-sm font-medium">{t('draft.topics')}</legend>
                <p
                  id="fatwa-draft-topics-help"
                  className="text-sm text-[color:var(--color-foreground-muted)]"
                >
                  {t('draft.topicsHelp', { max: FATWA_LIMITS.topicsPerRevision })}
                </p>
                {dropped > 0 ? (
                  <p className="text-sm">
                    {t('draft.topicsDropped', { count: dropped })}
                  </p>
                ) : null}
                {offeredTopics.length === 0 ? (
                  <p className="text-sm">{t('draft.topicsEmpty')}</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {offeredTopics.map((topic) => (
                      <li key={topic.id} className="flex items-start gap-2 text-sm">
                        <input
                          id={`fatwa-topic-${topic.id}`}
                          type="checkbox"
                          name="topicIds"
                          value={topic.id}
                          defaultChecked={chosen.includes(topic.id)}
                          className="mt-1"
                        />
                        <label htmlFor={`fatwa-topic-${topic.id}`} dir="auto">
                          {topic.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              {isCorrection ? (
                <Field
                  id="fatwa-draft-correction"
                  label={t('draft.correctionReason')}
                  help={t('draft.correctionReasonHelp')}
                >
                  {(props) => (
                    <TextArea
                      {...props}
                      name="correctionReason"
                      required
                      rows={3}
                      maxLength={FATWA_LIMITS.correctionReason}
                      dir="auto"
                      defaultValue={pending?.correctionReason ?? ''}
                    />
                  )}
                </Field>
              ) : null}
            </ActionForm>
          )}
        </section>
      )}

      {fatwa !== null &&
      fatwa.reviewState === 'drafting' &&
      fatwa.withdrawnAt === null &&
      pending !== null ? (
        <section className="flex flex-col gap-4" aria-labelledby="fatwa-submit">
          <h2 id="fatwa-submit" className="text-lg font-semibold tracking-tight">
            {t('submitReview.heading')}
          </h2>
          <ActionForm
            action={submitFatwaForReview}
            submitLabel={t('submitReview.submit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            tone="secondary"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="fatwaId" value={fatwa.id} />
            <input type="hidden" name="version" value={String(fatwa.version)} />
            <input type="hidden" name="revisionId" value={pending.id} />
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('submitReview.help', { number: pending.number })}
            </p>
          </ActionForm>
        </section>
      ) : null}
    </main>
  );
}
