import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { FatwaOwnerStatus } from '@minhaj/contracts/fatwa';

import { fatwaRuntime } from '@/composition/fatwa';
import { FatwaDate } from '@/components/fatwa/parts';
import { readQuestionId, rulingHref } from '@/components/fatwa/presentation';
import { DetailRow, Panel, StatusBadge, TextLink } from '@/components/ui';
import { MyPage } from '@/components/my/frame';
import { myPageMetadata } from '@/components/my/metadata';
import { myTrail } from '@/components/my/sections';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../../guard';

/**
 * One of the asker's OWN questions (ROUTE_MAP.md §5.1; Fatwa-owned).
 *
 * SOMEBODY ELSE'S ID IS A 404 — the same answer an id that does not exist
 * gets, because Fatwa's owner query filters by the signed-in account itself.
 * Nothing on this page says who handles the question or how far review has
 * gone: the asker sees a coarse status, their own words while they are kept,
 * and — once it is public — the published ruling, whose question is a
 * separately written, anonymised statement rather than these words.
 *
 * MY MINHAJ PART 2: the trail (My Minhaj / My questions / Your question) and
 * the coarse status as three steps — received, being answered, answered — or
 * the one ending it had instead. The steps say only what the coarse status
 * already says; no stage of review is disclosed.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'question');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

/** The asker's three steps, in order; a declined or closed question ends after the first two. */
const STEPS = ['received', 'in_progress', 'answered'] as const;

/** How far along the three steps a coarse status stands. */
function reached(status: FatwaOwnerStatus): number {
  if (status === 'received') return 0;
  if (status === 'answered') return 2;
  return 1;
}

export default async function MyQuestionPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const valid = readQuestionId(id);
  const session = await requireActiveSession(
    locale,
    valid === null
      ? localizedPath(locale, '/my/questions')
      : localizedPath(locale, `/my/questions/${valid}`),
  );
  if (valid === null) notFound();
  const question = await fatwaRuntime().ask.question(
    { accountId: session.account.id },
    valid,
  );
  if (question === null) notFound();
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const ended = question.status === 'declined' || question.status === 'closed';
  const at = reached(question.status);

  return (
    <MyPage
      title={t('my.questionTitle')}
      measure="reading"
      trail={{
        label: my('trail.label'),
        crumbs: myTrail(locale, my('trail.home'), [
          { path: '/questions', text: my('trail.questions') },
          { text: t('my.questionTitle') },
        ]),
      }}
    >
      <Panel>
        <dl className="divide-y divide-border">
          <DetailRow term={t('my.statusLabel')}>
            <StatusBadge tone={question.status === 'answered' ? 'positive' : 'neutral'}>
              {t(`my.status.${question.status}`)}
            </StatusBadge>
          </DetailRow>
          <DetailRow term={t('my.submitted')}>
            <FatwaDate value={question.submittedAt} locale={locale} />
          </DetailRow>
        </dl>
        <p className="mt-3 text-sm text-foreground-muted">
          {t(`my.statusNote.${question.status}`)}
        </p>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="question-steps">
        <h2 id="question-steps" className="text-lg font-semibold">
          {my('questionPage.stepsHeading')}
        </h2>
        <ol className="flex flex-col gap-2">
          {STEPS.map((step, index) => {
            const state = ended
              ? index === 0
                ? 'done'
                : index === 1
                  ? 'ended'
                  : 'none'
              : index < at || (index === at && step === 'answered')
                ? 'done'
                : index === at
                  ? 'now'
                  : 'next';
            if (state === 'none') return null;
            return (
              <li
                key={step}
                aria-current={state === 'now' ? 'step' : undefined}
                className={`flex min-w-0 items-start gap-3 rounded-control px-3 py-2 text-sm ${
                  state === 'now' ? 'bg-surface-sunken font-semibold' : ''
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                    state === 'done'
                      ? 'bg-action'
                      : state === 'now' || state === 'ended'
                        ? 'bg-accent'
                        : 'border border-border-strong'
                  }`}
                />
                <span className="flex min-w-0 flex-col">
                  <span>
                    {state === 'ended'
                      ? t(`my.status.${question.status}`)
                      : my(`questionPage.steps.${step}`)}
                  </span>
                  <span className="text-caption font-normal text-foreground-muted">
                    {my(`questionPage.state.${state}`)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {question.answerSlug === null ? null : (
        <section className="flex flex-col gap-2" aria-labelledby="question-answer">
          <h2 id="question-answer" className="text-lg font-semibold">
            {t('my.answered')}
          </h2>
          <p className="text-sm">{t('my.answeredNote')}</p>
          <p>
            <TextLink href={rulingHref(locale, question.answerSlug)}>
              {t('my.answeredLink')}
            </TextLink>
          </p>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="question-words">
        <h2 id="question-words" className="text-lg font-semibold">
          {t('my.yourWords')}
        </h2>
        {question.body === null ? (
          <p className="text-sm text-foreground-muted">{t('my.erased')}</p>
        ) : (
          <p
            className="rounded-panel bg-surface-sunken px-5 py-4 whitespace-pre-wrap wrap-anywhere"
            dir="auto"
          >
            {question.body}
          </p>
        )}
      </section>
    </MyPage>
  );
}
