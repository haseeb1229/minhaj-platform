import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  FATWA_MAX_OFFSET,
  FATWA_OWNER_STATUSES,
  FATWA_PAGE_SIZE,
  type FatwaOwnerStatus,
} from '@minhaj/contracts/fatwa';

import { fatwaRuntime } from '@/composition/fatwa';
import { appLogger } from '@/composition/logging';
import { FatwaDate } from '@/components/fatwa/parts';
import { ownQuestionHref } from '@/components/fatwa/presentation';
import { ActionLink, Alert, EmptyState, StatusBadge, TextLink } from '@/components/ui';
import { MyPage } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListFilters,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTrail } from '@/components/my/sections';
import { MySteps } from '@/components/my/summary-parts';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../guard';

/**
 * My questions — the asker's OWN questions, and nobody else's
 * (ROUTE_MAP.md §5.1; Fatwa-owned, delivered by Phase 20).
 *
 * KEYED BY THE SESSION. The list is read through Fatwa's owner capability with
 * the signed-in account's id, which the query itself filters by — no URL
 * parameter names whose questions these are.
 *
 * NO QUESTION TEXT IN THE LIST. Each row is a status, a date and a link by the
 * question's opaque id; the words are shown only on the question's own page,
 * to its asker.
 *
 * MY MINHAJ PART 2: the trail; the questions counted by the coarse status
 * the asker is told (`?status=`, Fatwa's own counts — never who handles a
 * question or how far review has gone); "Showing n–m of N"; numbered pages
 * (`?page=`, Fatwa's page of 20; the legacy `?offset=` and other spellings
 * are one redirect after the session is resolved, an unknown status is refused
 * in place and never widened); and a first-run page that says what asking does
 * — and, while the service is not taking questions, says so.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'questions');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyQuestionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/questions');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const spec: MyListSpec<FatwaOwnerStatus> = {
    path,
    param: 'status',
    filters: FATWA_OWNER_STATUSES,
    size: FATWA_PAGE_SIZE,
    offsetMax: FATWA_MAX_OFFSET,
  };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);

  const askPath = localizedPath(locale, '/my/questions/ask');
  const frame = {
    title: t('my.title'),
    description: <p>{t('my.description')}</p>,
    action: <ActionLink href={askPath}>{t('sections.ask')}</ActionLink>,
    measure: 'reading' as const,
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: my('trail.questions') }]),
    },
  };

  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );

  const view = asked.view;
  const actor = { accountId: session.account.id };
  const { ask } = fatwaRuntime();
  let read;
  try {
    read = await Promise.all([
      ask.questions(actor, myListOffset(view.page, spec), view.filter),
      ask.questionCounts(actor),
      ask.availability(),
    ]);
  } catch {
    // By operation name only: never an account, never a question's words.
    appLogger().error({ operation: 'fatwa-my-questions' }, 'My questions read failed.');
    return (
      <MyPage {...frame}>
        <Alert tone="error">{my('questionsPage.failure')}</Alert>
      </MyPage>
    );
  }
  const [page, counts, availability] = read;
  const total = FATWA_OWNER_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const range = myListRange(view.page, page.items.length, spec);
  const number = new Intl.NumberFormat(locale);

  return (
    <MyPage {...frame}>
      {availability.active ? null : <Alert tone="info">{t('ask.unavailable')}</Alert>}

      {total === 0 ? null : (
        <MyListFilters
          label={my('questionsPage.views')}
          spec={spec}
          current={view.filter}
          minimum={3}
          format={(count) => number.format(count)}
          items={[
            { value: null, text: my('list.allKinds'), count: total },
            ...FATWA_OWNER_STATUSES.map((status) => ({
              value: status,
              text: t(`my.status.${status}`),
              count: counts[status],
            })),
          ]}
        />
      )}

      {range === null ? null : (
        <MyListStatus>
          {my('count.questions', { ...range, total: page.total })}
        </MyListStatus>
      )}

      {page.items.length === 0 ? (
        total === 0 ? (
          <div className="flex flex-col gap-4">
            <EmptyState
              icon="message"
              title={my('questionsPage.emptyTitle')}
              {...(availability.active
                ? { action: { href: askPath, text: t('sections.ask') } }
                : {})}
            >
              {t('my.empty')}
            </EmptyState>
            <MySteps
              label={my('questionsPage.stepsLabel')}
              steps={(['ask', 'read', 'answer'] as const).map((key) => ({
                key,
                title: my(`questionsPage.steps.${key}.title`),
                body: my(`questionsPage.steps.${key}.body`),
              }))}
            />
            <p>
              <TextLink href={localizedPath(locale, '/fatwa/how-it-works')}>
                {t('sections.howItWorks')}
              </TextLink>
            </p>
          </div>
        ) : page.total === 0 ? (
          <EmptyState icon="list" action={{ href: path, text: my('list.all') }}>
            {my('questionsPage.noneOfStatus')}
          </EmptyState>
        ) : (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: view.filter })}
            firstText={my('list.first')}
          />
        )
      ) : (
        <ol aria-label={t('my.list')} className="flex flex-col border-t border-border">
          {page.items.map((question) => (
            <li
              key={question.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-4"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <TextLink href={ownQuestionHref(locale, question.id)}>
                  {t('my.submitted')}:{' '}
                  <FatwaDate value={question.submittedAt} locale={locale} />
                </TextLink>
                <span className="text-sm text-foreground-muted">
                  {t(`my.statusNote.${question.status}`)}
                </span>
              </span>
              <StatusBadge tone={question.status === 'answered' ? 'positive' : 'neutral'}>
                {t(`my.status.${question.status}`)}
              </StatusBadge>
            </li>
          ))}
        </ol>
      )}

      <MyListPager
        label={t('my.list')}
        spec={spec}
        view={view}
        total={page.total}
        locale={locale}
        words={{
          previous: t('previous'),
          next: t('next'),
          page: (number) => my('list.page', { page: number }),
        }}
      />
    </MyPage>
  );
}
