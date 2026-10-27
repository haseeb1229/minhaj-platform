import { getTranslations } from 'next-intl/server';

import { FATWA_PAGE_SIZE } from '@minhaj/contracts/fatwa';

import { fatwaRuntime } from '@/composition/fatwa';
import { FatwaDate } from '@/components/fatwa/parts';
import {
  offsetHref,
  ownQuestionHref,
  readFatwaOffset,
} from '@/components/fatwa/presentation';
import { pageLinks } from '@/components/hadith/presentation';
import { Pagination } from '@/components/media/parts';
import { ActionLink, EmptyState, Panel, StatusBadge, TextLink } from '@/components/ui';
import { WorkspacePage } from '@/components/workspace/parts';
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
 */
export const metadata = { robots: { index: false, follow: false } };

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
  const session = await requireActiveSession(locale, `/${locale}/my/questions`);
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const page = await fatwaRuntime().ask.questions(
    { accountId: session.account.id },
    readFatwaOffset(await searchParams),
  );
  const path = `/${locale}/my/questions`;
  const links = pageLinks(page.offset, FATWA_PAGE_SIZE, page.total);

  return (
    <WorkspacePage
      title={t('my.title')}
      description={<p>{t('my.description')}</p>}
      action={
        <ActionLink href={`/${locale}/my/questions/ask`}>{t('sections.ask')}</ActionLink>
      }
      measure="reading"
    >
      {page.items.length === 0 ? (
        <EmptyState>{t('my.empty')}</EmptyState>
      ) : (
        <ol aria-label={t('my.list')} className="flex flex-col gap-3">
          {page.items.map((question) => (
            <Panel key={question.id} as="li">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TextLink href={ownQuestionHref(locale, question.id)}>
                  {t('my.submitted')}:{' '}
                  <FatwaDate value={question.submittedAt} locale={locale} />
                </TextLink>
                <StatusBadge
                  tone={question.status === 'answered' ? 'positive' : 'neutral'}
                >
                  {t(`my.status.${question.status}`)}
                </StatusBadge>
              </div>
            </Panel>
          ))}
        </ol>
      )}

      <Pagination
        label={t('my.list')}
        previous={links.previous === null ? null : offsetHref(path, links.previous)}
        next={links.next === null ? null : offsetHref(path, links.next)}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />

      <p>
        <TextLink href={`/${locale}/my`}>{t('my.account')}</TextLink>
      </p>
    </WorkspacePage>
  );
}
