import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import { DetailRow, EmptyState, PageHeading, Panel } from '@/components/ui';
import { Contributors, HadithFrame, hadithTrail, languageOf } from './parts';

/**
 * `/hadith/commentary` — the public commentary works (ROUTE_MAP.md §3.4).
 *
 * EACH WORK IS ITS OWN THING, AND NONE IS PRIVILEGED. A row names the work, its
 * language, its contributors, the attribution and the registered source its
 * editors gave — never a claim the source did not make. Its entries are read
 * on each citation page, beside the original text and never in place of it.
 */
export async function CommentaryPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const [works, languages] = await Promise.all([
    hadithReadRuntime().reader.commentaries(),
    contentLanguages(),
  ]);
  const names = await referenceNames(
    {
      personIds: works.flatMap((work) => work.contributors.map((c) => c.personId)),
      topicIds: [],
    },
    locale,
  );
  const title = t('sections.commentary');

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.commentary')}
        </p>
      </div>
      {works.length === 0 ? (
        <EmptyState>{t('worksEmpty.commentary')}</EmptyState>
      ) : (
        <ul aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {works.map((work) => {
            const language = languageOf(languages, work.languageCode);
            return (
              <Panel key={work.id} as="li">
                <article
                  id={`commentary-${work.slug}`}
                  aria-labelledby={`commentary-name-${work.slug}`}
                  className="flex min-w-0 flex-col gap-2"
                >
                  <h2
                    id={`commentary-name-${work.slug}`}
                    className="text-lg font-semibold wrap-anywhere"
                    dir="auto"
                  >
                    {work.name}
                  </h2>
                  {work.description === null ? null : (
                    <p className="text-sm whitespace-pre-wrap wrap-anywhere" dir="auto">
                      {work.description}
                    </p>
                  )}
                  <Contributors
                    locale={locale}
                    contributors={work.contributors}
                    names={names}
                    t={t}
                  />
                  <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                    <DetailRow term={t('work.language')}>
                      <span lang={language.code} dir={language.direction}>
                        {language.name}
                      </span>
                    </DetailRow>
                    <DetailRow term={t('work.entries')}>
                      {t('work.entryCount', { count: work.entryCount })}
                    </DetailRow>
                    {work.attribution === null ? null : (
                      <DetailRow term={t('work.attribution')}>
                        <span dir="auto">{work.attribution}</span>
                      </DetailRow>
                    )}
                    <DetailRow term={t('fact.source')}>
                      <span dir="auto">{work.sourceSystemTitle}</span>
                    </DetailRow>
                  </dl>
                </article>
              </Panel>
            );
          })}
        </ul>
      )}
    </HadithFrame>
  );
}
