import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  FATWA_PAGE_SIZE,
  FATWA_PERMISSIONS,
  type StaffQuestionSummary,
} from '@minhaj/contracts/fatwa';

import { requireAdminPage } from '@/composition/authorization';
import { fatwaRuntime } from '@/composition/fatwa';
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
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset } from '../shared';
import {
  assignFatwaQuestion,
  declineFatwaQuestion,
  triageFatwaQuestion,
} from './actions';
import {
  actorOf,
  answererNames,
  assigneeLabel,
  categoryNames,
  ConfirmField,
  DateText,
  DetailHeading,
  fatwaCopy,
  Pager,
  recordTarget,
  shortReference,
  StageBadge,
  WrittenText,
  type Copy,
  type ListParams,
} from './shared';

/**
 * The intake screens (ROUTE_MAP.md §7: `/admin/fatwa/questions`,
 * `/admin/fatwa/assignment`), Phase 20 — all under `question.receive`.
 *
 * A LIST NEVER SHOWS A QUESTION. Rows carry the stage, the category, the
 * answerer's name and dates; the reader below them never selects the text. A
 * short opaque reference tells two rows apart, and the asker is not on any row.
 *
 * THE DETAIL IS AN AUDITED READ. Opening a question records that this account
 * read it, and the page says so before it shows the text. Triage, assignment
 * and declining each carry the question's expected version, so two triagers
 * cannot silently overwrite each other.
 */

function QuestionTable({
  rows,
  base,
  locale,
  categories,
  answerers,
  caption,
  copy,
}: {
  readonly rows: readonly StaffQuestionSummary[];
  readonly base: string;
  readonly locale: Locale;
  readonly categories: ReadonlyMap<string, string>;
  readonly answerers: ReadonlyMap<string, string>;
  readonly caption: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <DataTable
      caption={caption}
      columns={[
        t('question.reference'),
        t('stage'),
        t('category'),
        t('assignee'),
        t('submitted'),
      ]}
    >
      {rows.map((row) => (
        <DataRow key={row.id}>
          <DataCell>
            <TextLink href={`${base}/${row.id}`}>
              {t('question.open')}{' '}
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
                : (categories.get(row.categoryId) ?? t('categoryUnavailable'))}
            </span>
          </DataCell>
          <DataCell wrap>
            <span dir="auto">{assigneeLabel(row.assigneeId, answerers, copy)}</span>
          </DataCell>
          <DataCell>
            <DateText date={row.submittedAt} locale={locale} />
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

/* ===========================================================================
 * The intake list
 * ========================================================================= */

export async function QuestionsScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/fatwa/questions`;
  const context = await requireAdminPage(locale, FATWA_PERMISSIONS.receive, base);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;
  const offset = pageOffset(query, FATWA_PAGE_SIZE);

  const [page, categories, answerers] = await Promise.all([
    workflow.intake(actor, offset),
    workflow.categories(actor),
    workflow.answerers(actor),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.questions')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.questions')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('question.empty')}</EmptyState>
      ) : (
        <QuestionTable
          rows={page.items}
          base={base}
          locale={locale}
          categories={categoryNames(categories, locale)}
          answerers={answererNames(answerers)}
          caption={t('surface.questions')}
          copy={copy}
        />
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
 * Assignment — who is answering what
 * ========================================================================= */

export async function AssignmentScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/fatwa/assignment`;
  const context = await requireAdminPage(locale, FATWA_PERMISSIONS.receive, base);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;
  const offset = pageOffset(query, FATWA_PAGE_SIZE);

  // One page, scoped in SQL to questions an answerer holds now.
  const [page, categories, answerers] = await Promise.all([
    workflow.assignment(actor, offset),
    workflow.categories(actor),
    workflow.answerers(actor),
  ]);
  const rows = page.items;

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.assignment')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.assignment')}
      </p>

      {rows.length === 0 ? (
        <EmptyState>{t('assignment.empty')}</EmptyState>
      ) : (
        <QuestionTable
          rows={rows}
          base={`/${locale}/admin/fatwa/questions`}
          locale={locale}
          categories={categoryNames(categories, locale)}
          answerers={answererNames(answerers)}
          caption={t('surface.assignment')}
          copy={copy}
        />
      )}
      <Pager
        offset={offset}
        shown={rows.length}
        total={page.total}
        base={base}
        copy={copy}
      />
    </main>
  );
}

/* ===========================================================================
 * One question — the audited read, triage, assignment and declining
 * ========================================================================= */

export async function QuestionScreen({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/fatwa/questions`;
  const context = await requireAdminPage(
    locale,
    FATWA_PERMISSIONS.receive,
    `${list}/${id}`,
  );
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;

  // The read below is recorded as a data access; it is made only once the
  // route guard has passed, and the service and the query re-check the key.
  const question = await workflow.intakeQuestion(actor, id);
  if (question === null) notFound();

  const [categories, answerers] = await Promise.all([
    workflow.categories(actor),
    workflow.answerers(actor),
  ]);
  const names = categoryNames(categories, locale);
  // Re-filing under the category it already has is refused, so it is not offered.
  const offered = categories.filter(
    (category) => category.status === 'active' && category.id !== question.categoryId,
  );
  const assignable = answerers.filter(
    (answerer) => answerer.accountId !== question.assigneeId,
  );
  const inReview = question.stage === 'in_review';

  return (
    <main className="flex flex-col gap-8">
      <DetailHeading back={list} copy={copy}>
        {t('question.heading')}{' '}
        <span dir="ltr" className="text-base font-normal">
          {shortReference(question.id)}
        </span>
      </DetailHeading>

      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow term={t('stage')}>
          <StageBadge stage={question.stage} copy={copy} />
        </DetailRow>
        <DetailRow term={t('category')}>
          <span dir="auto">
            {question.categoryId === null
              ? t('categoryUnset')
              : (names.get(question.categoryId) ?? t('categoryUnavailable'))}
          </span>
        </DetailRow>
        <DetailRow term={t('assignee')}>
          <span dir="auto">
            {assigneeLabel(question.assigneeId, answererNames(answerers), copy)}
          </span>
        </DetailRow>
        <DetailRow term={t('submitted')}>
          <DateText date={question.submittedAt} locale={locale} time />
        </DetailRow>
        <DetailRow term={t('updated')}>
          <DateText date={question.updatedAt} locale={locale} time />
        </DetailRow>
        <DetailRow term={t('version')}>{question.version}</DetailRow>
      </dl>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('question.private')}</SectionHeading>
          <Alert tone="info">{t('question.accessNotice')}</Alert>
          <WrittenText text={question.body} />
        </div>
      </Panel>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-triage">
        <h2 id="fatwa-triage" className="text-lg font-semibold tracking-tight">
          {t('triage.heading')}
        </h2>
        {offered.length === 0 ? (
          <p className="text-sm">{t('triage.noCategories')}</p>
        ) : (
          <ActionForm
            action={triageFatwaQuestion}
            submitLabel={
              question.categoryId === null ? t('triage.submit') : t('triage.change')
            }
            pendingLabel={t('pending')}
            messages={copy.messages}
            tone="secondary"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={question.id} />
            <input type="hidden" name="version" value={String(question.version)} />
            <Field
              id="fatwa-triage-category"
              label={t('category')}
              help={t('triage.help')}
            >
              {(props) => (
                <Select {...props} name="categoryId" required defaultValue="">
                  <option value="">{t('triage.choose')}</option>
                  {offered.map((category) => (
                    <option key={category.id} value={category.id}>
                      {names.get(category.id)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </ActionForm>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-assign">
        <h2 id="fatwa-assign" className="text-lg font-semibold tracking-tight">
          {t('assign.heading')}
        </h2>
        {question.stage === 'submitted' ? (
          <p className="text-sm">{t('assign.needsCategory')}</p>
        ) : inReview ? (
          <p className="text-sm">{t('assign.inReview')}</p>
        ) : assignable.length === 0 ? (
          <p className="text-sm">{t('assign.noAnswerers')}</p>
        ) : (
          <ActionForm
            action={assignFatwaQuestion}
            submitLabel={
              question.assigneeId === null ? t('assign.submit') : t('assign.reassign')
            }
            pendingLabel={t('pending')}
            messages={copy.messages}
            tone="secondary"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={question.id} />
            <input type="hidden" name="version" value={String(question.version)} />
            <Field
              id="fatwa-assign-answerer"
              label={t('assignee')}
              help={t('assign.help')}
            >
              {(props) => (
                <Select {...props} name="assigneeId" required defaultValue="">
                  <option value="">{t('assign.choose')}</option>
                  {assignable.map((answerer) => (
                    <option key={answerer.accountId} value={answerer.accountId}>
                      {answerer.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </ActionForm>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-decline">
        <h2 id="fatwa-decline" className="text-lg font-semibold tracking-tight">
          {t('decline.heading')}
        </h2>
        {inReview ? (
          <p className="text-sm">{t('decline.inReview')}</p>
        ) : (
          <ActionForm
            action={declineFatwaQuestion}
            submitLabel={t('decline.submit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            tone="destructive"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={question.id} />
            <input type="hidden" name="version" value={String(question.version)} />
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('decline.help')}
            </p>
            <ConfirmField id="fatwa-decline-confirm" label={t('decline.confirm')} />
          </ActionForm>
        )}
      </section>
    </main>
  );
}
