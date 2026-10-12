import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability, PublicHadithScience } from '@minhaj/contracts/hadith';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { contentLanguages } from '@/composition/public-references';
import {
  Alert,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  TextLink,
} from '@/components/ui';
import { HadithFrame, hadithTrail, languageOf } from './parts';
import {
  hadithPath,
  sciencePathOf,
  scienceTextFor,
  scienceTitleFor,
} from './presentation';

/**
 * `/hadith/sciences` and `/hadith/sciences/{slug}` — study material
 * (ROUTE_MAP.md §3.4).
 *
 * GUIDANCE, NOT AUTHORITY. A study page is plain text an editor published from
 * a registered source, in the languages that source supplied; it is never a
 * canonical record and never a grading. Shown in another language than the
 * interface's, it says so rather than passing itself off as a translation.
 */

export async function SciencesPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const [sciences, languages] = await Promise.all([
    hadithReadRuntime().reader.sciences(),
    contentLanguages(),
  ]);
  const title = t('sections.sciences');

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.sciences')}
        </p>
      </div>
      {sciences.length === 0 ? (
        <EmptyState>{t('worksEmpty.sciences')}</EmptyState>
      ) : (
        <ol aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sciences.map((science) => {
            const shown = scienceTitleFor(science, locale);
            if (shown === null) return null;
            const language = languageOf(languages, shown.languageCode);
            return (
              <Panel key={science.slug} as="li">
                <h2
                  className="text-lg font-semibold wrap-anywhere"
                  lang={language.code}
                  dir={language.direction}
                >
                  <TextLink href={`/${locale}${sciencePathOf(science.slug)}`}>
                    {shown.title}
                  </TextLink>
                </h2>
              </Panel>
            );
          })}
        </ol>
      )}
    </HadithFrame>
  );
}

export async function SciencePage({
  locale,
  availability,
  science,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly science: PublicHadithScience;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const languages = await contentLanguages();
  const shown = scienceTextFor(science, locale);
  const title = shown?.text.title ?? science.slug;
  const language = languageOf(languages, shown?.text.languageCode ?? 'und');

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[
        parts.home,
        parts.hadith,
        { href: hadithPath(locale, 'sciences'), text: t('sections.sciences') },
        { text: title },
      ]}
    >
      <article aria-labelledby="science-heading" className="flex min-w-0 flex-col gap-6">
        {shown?.fallback === true ? (
          <Alert tone="info">{t('scienceFallback', { language: language.name })}</Alert>
        ) : null}
        <div
          lang={language.code}
          dir={language.direction}
          className="flex flex-col gap-4"
        >
          <h1
            id="science-heading"
            className="text-3xl font-semibold tracking-tight wrap-anywhere"
          >
            {title}
          </h1>
          {shown === null ? null : (
            // The body exactly as stored: every line break kept by CSS, no
            // paragraph re-splitting or trimming.
            <p className="max-w-[var(--measure-prose)] whitespace-pre-wrap wrap-anywhere">
              {shown.text.body}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {science.attribution === null ? null : (
            <DetailRow term={t('work.attribution')}>
              <span dir="auto">{science.attribution}</span>
            </DetailRow>
          )}
          <DetailRow term={t('fact.source')}>
            <span dir="auto">{science.sourceSystemTitle}</span>
          </DetailRow>
        </dl>
      </article>
    </HadithFrame>
  );
}
