import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  FATWA_LIMITS,
  FATWA_PAGE_SIZE,
  FATWA_PERMISSIONS,
  type FatwaSummaryPage,
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
  StatusBadge,
  TextArea,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset } from '../shared';
import { publishFatwaRevision, returnFatwaRevision, withdrawFatwa } from './actions';
import {
  actorOf,
  answererNames,
  categoryNames,
  ConfirmField,
  DateText,
  DetailHeading,
  FatwaPublicationStepUp,
  fatwaCopy,
  languageNames,
  Pager,
  recordTarget,
  RevisionView,
  topicNames,
  WrittenText,
  type Copy,
  type ListParams,
} from './shared';

/**
 * The scholar-review and published screens (ROUTE_MAP.md §7:
 * `/admin/fatwa/review`, `/admin/fatwa/published`), Phase 20 — under
 * `fatwa.publish`.
 *
 * THE REVIEWER SEES THE WHOLE REVISION, AND WHAT IT REPLACES. The pending
 * revision is shown in full — title, public question, ruling, language,
 * category, topics and correction reason — and, for a correction, the revision
 * readers see now beside it. The private question is shown for checking the
 * anonymised public question against it; reading it is recorded, and the asker
 * is never shown.
 *
 * PUBLICATION IS DELIBERATE. It needs an explicit confirmation and a live
 * `fatwa-publication` step-up grant, both re-checked server-side. The author of
 * a revision cannot publish it: the form is not offered to them, and the
 * database refuses them anyway.
 */

function SummaryTable({
  page,
  base,
  locale,
  caption,
  copy,
  published,
}: {
  readonly page: FatwaSummaryPage;
  readonly base: string;
  readonly locale: Locale;
  readonly caption: string;
  readonly copy: Copy;
  readonly published: boolean;
}) {
  const { t } = copy;
  return (
    <DataTable
      caption={caption}
      columns={[
        t('draft.title'),
        t('draft.slug'),
        published ? t('published.firstPublished') : t('ruling.status'),
        published ? t('ruling.status') : t('updated'),
      ]}
    >
      {page.items.map((row) => (
        <DataRow key={row.id}>
          <DataCell wrap>
            <TextLink href={`${base}/${row.id}`}>
              <span dir="auto">{row.title}</span>
            </TextLink>
          </DataCell>
          <DataCell wrap>
            <span dir="ltr" className="wrap-anywhere">
              {row.slug}
            </span>
          </DataCell>
          {published ? (
            <>
              <DataCell>
                {row.firstPublishedAt === null ? (
                  t('none')
                ) : (
                  <DateText date={row.firstPublishedAt} locale={locale} />
                )}
              </DataCell>
              <DataCell wrap>
                <span className="inline-flex flex-wrap gap-2">
                  {row.withdrawnAt === null ? (
                    <StatusBadge tone="positive">{t('ruling.publicNow')}</StatusBadge>
                  ) : (
                    <StatusBadge tone="caution">{t('ruling.withdrawn')}</StatusBadge>
                  )}
                  {row.reviewState === null ? null : (
                    <StatusBadge tone="neutral">
                      {t(`reviewStateName.${row.reviewState}`)}
                    </StatusBadge>
                  )}
                </span>
              </DataCell>
            </>
          ) : (
            <>
              <DataCell>
                {row.firstPublishedAt === null ? (
                  <StatusBadge tone="neutral">{t('review.firstPublication')}</StatusBadge>
                ) : (
                  <StatusBadge tone="caution">{t('review.correction')}</StatusBadge>
                )}
              </DataCell>
              <DataCell>
                <DateText date={row.updatedAt} locale={locale} />
              </DataCell>
            </>
          )}
        </DataRow>
      ))}
    </DataTable>
  );
}

/* ===========================================================================
 * The review queue
 * ========================================================================= */

export async function ReviewQueueScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/fatwa/review`;
  const context = await requireAdminPage(locale, FATWA_PERMISSIONS.publish, base);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const offset = pageOffset(query, FATWA_PAGE_SIZE);
  const page = await fatwaRuntime().workflow.reviewQueue(actorOf(context), offset);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.review')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.review')}
      </p>
      {page.items.length === 0 ? (
        <EmptyState>{t('review.empty')}</EmptyState>
      ) : (
        <SummaryTable
          page={page}
          base={base}
          locale={locale}
          caption={t('surface.review')}
          copy={copy}
          published={false}
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
 * One ruling under review
 * ========================================================================= */

export async function ReviewScreen({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly fatwaId: string }>;
}) {
  const locale = await requireLocale(params);
  const fatwaId = recordTarget((await params).fatwaId);
  const list = `/${locale}/admin/fatwa/review`;
  const context = await requireAdminPage(
    locale,
    FATWA_PERMISSIONS.publish,
    `${list}/${fatwaId}`,
  );
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;

  const fatwa = await workflow.reviewFatwa(actor, fatwaId);
  if (fatwa === null) notFound();
  const pending = fatwa.revisions.find(
    (revision) => revision.id === fatwa.pendingRevisionId,
  );
  if (pending === undefined) notFound();
  const previous =
    fatwa.revisions.find((revision) => revision.id === fatwa.publishedRevisionId) ?? null;

  // The private question, recorded as a data access, only while under review.
  const canNameAnswerers = context.authorization.can(FATWA_PERMISSIONS.receive);
  const [question, categories, languages, topics, answerers] = await Promise.all([
    workflow.reviewQuestion(actor, fatwaId),
    workflow.categories(actor),
    languageNames(),
    topicNames([...pending.topicIds, ...(previous?.topicIds ?? [])], locale),
    canNameAnswerers ? workflow.answerers(actor) : Promise.resolve([]),
  ]);
  const names = categoryNames(categories, locale);
  const selfAuthored = pending.authorId === actor.accountId;
  const drafter = selfAuthored
    ? t('review.drafterYou')
    : (answererNames(answerers).get(pending.authorId) ?? t('review.drafterUnknown'));

  return (
    <main className="flex flex-col gap-8">
      <DetailHeading back={list} copy={copy}>
        <span dir="auto">{pending.title}</span>
      </DetailHeading>

      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow term={t('draft.slug')}>
          <span dir="ltr">{fatwa.slug}</span>
        </DetailRow>
        <DetailRow term={t('review.drafter')}>
          <span dir="auto">{drafter}</span>
        </DetailRow>
        <DetailRow term={t('revision.created')}>
          <DateText date={pending.createdAt} locale={locale} time />
        </DetailRow>
        <DetailRow term={t('ruling.status')}>
          {previous === null ? (
            <StatusBadge tone="neutral">{t('review.firstPublication')}</StatusBadge>
          ) : (
            <StatusBadge tone="caution">{t('review.correction')}</StatusBadge>
          )}
        </DetailRow>
        <DetailRow term={t('version')}>{fatwa.version}</DetailRow>
      </dl>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>
            {t('review.pending', { number: pending.number })}
          </SectionHeading>
          <RevisionView
            revision={pending}
            categories={names}
            topics={topics}
            languages={languages}
            copy={copy}
          />
        </div>
      </Panel>

      {previous === null ? null : (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>
              {t('review.comparison', { number: previous.number })}
            </SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('review.comparisonHelp')}
            </p>
            <RevisionView
              revision={previous}
              categories={names}
              topics={topics}
              languages={languages}
              copy={copy}
            />
          </div>
        </Panel>
      )}

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('question.private')}</SectionHeading>
          {question === null ? (
            <p className="text-sm">{t('question.unavailable')}</p>
          ) : (
            <>
              <Alert tone="info">{t('review.questionNotice')}</Alert>
              <WrittenText text={question.body} />
            </>
          )}
        </div>
      </Panel>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-return">
        <h2 id="fatwa-return" className="text-lg font-semibold tracking-tight">
          {t('review.return')}
        </h2>
        <ActionForm
          action={returnFatwaRevision}
          submitLabel={t('review.returnSubmit')}
          pendingLabel={t('pending')}
          messages={copy.messages}
          tone="secondary"
          preserveInput
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="fatwaId" value={fatwa.id} />
          <input type="hidden" name="version" value={String(fatwa.version)} />
          <input type="hidden" name="revisionId" value={pending.id} />
          <Field
            id="fatwa-return-note"
            label={t('review.returnNote')}
            help={t('review.returnNoteHelp')}
          >
            {(props) => (
              <TextArea
                {...props}
                name="note"
                required
                rows={4}
                maxLength={FATWA_LIMITS.returnNote}
                dir="auto"
              />
            )}
          </Field>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-publish">
        <h2 id="fatwa-publish" className="text-lg font-semibold tracking-tight">
          {t('review.publish')}
        </h2>
        {selfAuthored ? (
          <Alert tone="warning">{t('review.selfAuthored')}</Alert>
        ) : (
          <>
            <FatwaPublicationStepUp locale={locale} />
            <ActionForm
              action={publishFatwaRevision}
              submitLabel={t('review.publishSubmit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="fatwaId" value={fatwa.id} />
              <input type="hidden" name="version" value={String(fatwa.version)} />
              <input type="hidden" name="revisionId" value={pending.id} />
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('review.publishHelp')}
              </p>
              <ConfirmField
                id="fatwa-publish-confirm"
                label={t('review.publishConfirm')}
              />
            </ActionForm>
          </>
        )}
      </section>
    </main>
  );
}

/* ===========================================================================
 * Published rulings
 * ========================================================================= */

export async function PublishedListScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/fatwa/published`;
  const context = await requireAdminPage(locale, FATWA_PERMISSIONS.publish, base);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const offset = pageOffset(query, FATWA_PAGE_SIZE);
  const page = await fatwaRuntime().workflow.published(actorOf(context), offset);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.published')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.published')}
      </p>
      {page.items.length === 0 ? (
        <EmptyState>{t('published.empty')}</EmptyState>
      ) : (
        <SummaryTable
          page={page}
          base={base}
          locale={locale}
          caption={t('surface.published')}
          copy={copy}
          published
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

export async function PublishedScreen({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly fatwaId: string }>;
}) {
  const locale = await requireLocale(params);
  const fatwaId = recordTarget((await params).fatwaId);
  const list = `/${locale}/admin/fatwa/published`;
  const context = await requireAdminPage(
    locale,
    FATWA_PERMISSIONS.publish,
    `${list}/${fatwaId}`,
  );
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const workflow = fatwaRuntime().workflow;

  const fatwa = await workflow.publishedFatwa(actor, fatwaId);
  if (fatwa === null) notFound();

  // The visible public history: every published revision, newest first.
  const history = fatwa.revisions
    .filter((revision) => revision.publishedAt !== null)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const current = history.find((revision) => revision.id === fatwa.publishedRevisionId);
  const title = current?.title ?? history[0]?.title ?? fatwa.slug;
  const withdrawals = fatwa.notes.filter((note) => note.decision === 'withdrawn');
  const isPublic = fatwa.publishedRevisionId !== null && fatwa.withdrawnAt === null;

  const [categories, languages, topics] = await Promise.all([
    workflow.categories(actor),
    languageNames(),
    topicNames(
      history.flatMap((revision) => revision.topicIds),
      locale,
    ),
  ]);
  const names = categoryNames(categories, locale);

  return (
    <main className="flex flex-col gap-8">
      <DetailHeading back={list} copy={copy}>
        <span dir="auto">{title}</span>
      </DetailHeading>

      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow term={t('draft.slug')}>
          <span dir="ltr">{fatwa.slug}</span>
        </DetailRow>
        <DetailRow term={t('ruling.status')}>
          {isPublic ? (
            <StatusBadge tone="positive">{t('ruling.publicNow')}</StatusBadge>
          ) : (
            <StatusBadge tone="caution">{t('ruling.withdrawn')}</StatusBadge>
          )}
        </DetailRow>
        {fatwa.firstPublishedAt === null ? null : (
          <DetailRow term={t('published.firstPublished')}>
            <DateText date={fatwa.firstPublishedAt} locale={locale} />
          </DetailRow>
        )}
        {fatwa.withdrawnAt === null ? null : (
          <DetailRow term={t('published.withdrawnAt')}>
            <DateText date={fatwa.withdrawnAt} locale={locale} time />
          </DetailRow>
        )}
        <DetailRow term={t('version')}>{fatwa.version}</DetailRow>
      </dl>

      {isPublic ? (
        <p className="text-sm">
          <TextLink href={`/${locale}/fatwa/${fatwa.slug}`}>
            {t('published.view')}
          </TextLink>
        </p>
      ) : null}

      {fatwa.reviewState === null ? null : (
        <Alert tone="info">
          {t('published.correctionInProgress', {
            stage: t(`reviewStateName.${fatwa.reviewState}`),
          })}{' '}
          {fatwa.reviewState === 'in_review' ? (
            <TextLink href={`/${locale}/admin/fatwa/review/${fatwa.id}`}>
              {t('published.openReview')}
            </TextLink>
          ) : null}
        </Alert>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="fatwa-history">
        <h2 id="fatwa-history" className="text-lg font-semibold tracking-tight">
          {t('published.history')}
        </h2>
        <ol className="flex flex-col gap-4">
          {history.map((revision, index) => (
            <Panel key={revision.id} as="li">
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {t('published.historyEntry', { sequence: history.length - index })}
                  </span>
                  {revision.publishedAt === null ? null : (
                    <DateText date={revision.publishedAt} locale={locale} time />
                  )}
                  {revision.id === fatwa.publishedRevisionId && isPublic ? (
                    <StatusBadge tone="positive">{t('revision.current')}</StatusBadge>
                  ) : null}
                </p>
                <RevisionView
                  revision={revision}
                  categories={names}
                  topics={topics}
                  languages={languages}
                  copy={copy}
                />
              </div>
            </Panel>
          ))}
        </ol>
      </section>

      {withdrawals.length === 0 ? null : (
        <section className="flex flex-col gap-3" aria-labelledby="fatwa-withdrawals">
          <h2 id="fatwa-withdrawals" className="text-lg font-semibold tracking-tight">
            {t('published.withdrawals')}
          </h2>
          <ul className="flex flex-col gap-3">
            {withdrawals.map((note) => (
              <Panel key={`${note.revisionId}-${note.decidedAt.toISOString()}`} as="li">
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[color:var(--color-foreground-muted)]">
                    <DateText date={note.decidedAt} locale={locale} time />
                  </p>
                  <WrittenText text={note.note} />
                </div>
              </Panel>
            ))}
          </ul>
        </section>
      )}

      {isPublic ? (
        <section className="flex flex-col gap-4" aria-labelledby="fatwa-withdraw">
          <h2 id="fatwa-withdraw" className="text-lg font-semibold tracking-tight">
            {t('published.withdraw')}
          </h2>
          <FatwaPublicationStepUp locale={locale} />
          <ActionForm
            action={withdrawFatwa}
            submitLabel={t('published.withdrawSubmit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            tone="destructive"
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="fatwaId" value={fatwa.id} />
            <input type="hidden" name="version" value={String(fatwa.version)} />
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('published.withdrawHelp')}
            </p>
            <Field
              id="fatwa-withdraw-reason"
              label={t('published.withdrawReason')}
              help={t('published.withdrawReasonHelp')}
            >
              {(props) => (
                <TextArea
                  {...props}
                  name="reason"
                  required
                  rows={3}
                  maxLength={FATWA_LIMITS.withdrawalReason}
                  dir="auto"
                />
              )}
            </Field>
            <ConfirmField
              id="fatwa-withdraw-confirm"
              label={t('published.withdrawConfirm')}
            />
          </ActionForm>
        </section>
      ) : null}
    </main>
  );
}
