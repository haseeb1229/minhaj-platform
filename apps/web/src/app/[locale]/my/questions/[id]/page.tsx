import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { fatwaRuntime } from '@/composition/fatwa';
import { FatwaDate } from '@/components/fatwa/parts';
import { readQuestionId, rulingHref } from '@/components/fatwa/presentation';
import { DetailRow, PageHeading, Panel, StatusBadge, TextLink } from '@/components/ui';
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
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

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
    valid === null ? `/${locale}/my/questions` : `/${locale}/my/questions/${valid}`,
  );
  if (valid === null) notFound();
  const question = await fatwaRuntime().ask.question(
    { accountId: session.account.id },
    valid,
  );
  if (question === null) notFound();
  const t = await getTranslations({ locale, namespace: 'fatwa' });

  return (
    <main className="flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('my.questionTitle')}</PageHeading>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('my.statusLabel')}>
            <StatusBadge tone={question.status === 'answered' ? 'positive' : 'neutral'}>
              {t(`my.status.${question.status}`)}
            </StatusBadge>
          </DetailRow>
          <DetailRow term={t('my.submitted')}>
            <FatwaDate value={question.submittedAt} locale={locale} />
          </DetailRow>
        </dl>
        <p className="mt-3 text-sm text-[color:var(--color-foreground-muted)]">
          {t(`my.statusNote.${question.status}`)}
        </p>
      </Panel>

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
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('my.erased')}
          </p>
        ) : (
          <p className="whitespace-pre-wrap wrap-anywhere" dir="auto">
            {question.body}
          </p>
        )}
      </section>

      <p>
        <TextLink href={`/${locale}/my/questions`}>{t('my.back')}</TextLink>
      </p>
    </main>
  );
}
