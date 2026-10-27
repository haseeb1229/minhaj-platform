import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability, PublicFatwa } from '@minhaj/contracts/fatwa';

import { contentLanguages, referenceNames } from '@/composition/public-references';
import { BreadcrumbData } from '@/components/media/parts';
import { Alert, DetailRow, MetaRow, TextLink, TopicChips } from '@/components/ui';
import { categoryLabels } from './list';
import { FatwaDate, FatwaFrame, fatwaTrail } from './parts';
import { FatwaHistory } from './history';
import {
  categoryHref,
  fatwaContentLocales,
  fatwaSectionPath,
  fatwaTextDirection,
  rulingHref,
} from './presentation';
import { fatwaStructuredLocales } from './read';

/**
 * `/fatwa/{slug}` — THE CANONICAL PUBLISHED RULING (ROUTE_MAP.md §2.1, §3.8).
 *
 * WHAT IS SHOWN, AND WHAT CANNOT BE. The current published revision's title,
 * its SEPARATELY WRITTEN anonymised public question — labelled as exactly that
 * — and the ruling, each marked with the ruling's own language and direction
 * and rendered exactly as published (line breaks kept, nothing rewritten). The
 * reader this page reads through has no method that returns a private
 * question, an asker, an assignment or an account, so none of them can appear.
 *
 * ATTRIBUTION ONLY WHERE IT IS TRUE AND PUBLIC. The person who answered and
 * the person who published are named only when each has a PUBLISHED People
 * profile; otherwise nothing is said about them, never an account name.
 *
 * CORRECTIONS ARE VISIBLE. A corrected ruling says when, and why, at the top,
 * and keeps every earlier published version readable below.
 *
 * READ AS A PUBLICATION. The header carries the title and one line of facts;
 * the question sits in its own quieter panel, the ruling follows at reading
 * size in a bounded measure, and everything about where the ruling comes
 * from — category, dates, language, attribution — is gathered in one source
 * panel beside it. Related links are only those this page has already read.
 *
 * ONLY A BREADCRUMB IS CLAIMED to a search engine — never `FAQPage` or
 * `Article` — and only on the ruling's own canonical-language page of an
 * approved, indexable deployment (ROUTE_MAP.md §9.6).
 */
export async function FatwaRulingPage({
  locale,
  availability,
  fatwa,
}: {
  readonly locale: Locale;
  readonly availability: FatwaAvailability;
  readonly fatwa: PublicFatwa;
}) {
  const t = await getTranslations({ locale, namespace: 'fatwa' });
  const parts = await fatwaTrail(locale);
  const { current } = fatwa;
  const personIds = [fatwa.answeredByPersonId, fatwa.publishedByPersonId].filter(
    (id): id is string => id !== null,
  );
  const [names, categories, languages] = await Promise.all([
    referenceNames({ personIds, topicIds: fatwa.topicIds }, locale),
    categoryLabels(locale),
    contentLanguages(),
  ]);
  const category = categories.get(fatwa.categoryId);
  const direction = fatwaTextDirection(current.language);
  const corrected = fatwa.previous.length > 0;
  const languageName = languages.get(current.language)?.name ?? current.language;
  const topics = fatwa.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [{ id, ...topic }];
  });
  const answeredBy =
    fatwa.answeredByPersonId === null
      ? undefined
      : names.people.get(fatwa.answeredByPersonId);
  const publishedBy =
    fatwa.publishedByPersonId === null
      ? undefined
      : names.people.get(fatwa.publishedByPersonId);

  // The breadcrumb is claimed on the ruling's own-language page only — the
  // canonical one — and only when the page may be indexed at all.
  const structured = fatwaStructuredLocales(
    availability,
    fatwaContentLocales(current.language),
  ).filter((entry) => entry === locale);

  const published = <FatwaDate value={fatwa.firstPublishedAt} locale={locale} />;
  const correctedOn = corrected ? (
    <FatwaDate value={current.publishedAt} locale={locale} />
  ) : null;
  const languageLabel = (
    <span lang={current.language} dir={direction}>
      {languageName}
    </span>
  );

  return (
    <FatwaFrame
      locale={locale}
      availability={availability}
      trail={[
        parts.home,
        parts.fatwa,
        ...(category === undefined
          ? []
          : [{ href: categoryHref(locale, category.slug), text: category.name }]),
        { text: current.title },
      ]}
      heading={{
        title: (
          <span className="wrap-anywhere" lang={current.language} dir={direction}>
            {current.title}
          </span>
        ),
        meta: (
          <MetaRow
            items={[
              category === undefined ? null : category.name,
              <>
                {t('ruling.firstPublished')}: {published}
              </>,
              correctedOn === null ? null : (
                <>
                  {t('ruling.corrected')}: {correctedOn}
                </>
              ),
              languageLabel,
            ]}
          />
        ),
        extra:
          (corrected && current.correctionReason !== null) ||
          current.language !== locale ? (
            <div className="flex flex-col gap-3 pt-1">
              {corrected && current.correctionReason !== null ? (
                <p
                  className="max-w-[var(--measure-prose)] rounded-[var(--radius-control)] border-s-4 border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 text-sm whitespace-pre-wrap wrap-anywhere"
                  dir="auto"
                >
                  <span className="font-semibold">{t('ruling.correctionReason')}:</span>{' '}
                  {current.correctionReason}
                </p>
              ) : null}
              {current.language === locale ? null : (
                <Alert tone="info">
                  {t('ruling.languageNotice', { language: languageName })}
                </Alert>
              )}
            </div>
          ) : undefined,
      }}
    >
      <BreadcrumbData
        contentLocales={structured}
        trail={[
          { name: parts.home.text, path: parts.home.href },
          { name: parts.fatwa.text, path: parts.fatwa.href },
          ...(category === undefined
            ? []
            : [{ name: category.name, path: categoryHref(locale, category.slug) }]),
          { name: current.title, path: rulingHref(locale, fatwa.slug) },
        ]}
      />

      <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-10">
          <section
            className="flex max-w-[var(--measure-prose)] min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] p-5"
            aria-labelledby="fatwa-question"
          >
            <h2 id="fatwa-question" className="text-subheading font-semibold">
              {t('ruling.question')}
            </h2>
            <p className="text-caption text-[color:var(--color-foreground-muted)]">
              {t('ruling.questionNote')}
            </p>
            <p
              className="whitespace-pre-wrap wrap-anywhere"
              lang={current.language}
              dir={direction}
            >
              {current.publicQuestion}
            </p>
          </section>

          <section
            className="flex max-w-[var(--measure-prose)] min-w-0 flex-col gap-3"
            aria-labelledby="fatwa-ruling"
          >
            <h2 id="fatwa-ruling" className="text-heading font-semibold">
              {t('ruling.answer')}
            </h2>
            <p
              className="text-lede whitespace-pre-wrap wrap-anywhere"
              lang={current.language}
              dir={direction}
            >
              {current.ruling}
            </p>
          </section>

          {topics.length === 0 ? null : (
            <section className="flex flex-col gap-3" aria-labelledby="fatwa-topics">
              <h2 id="fatwa-topics" className="text-subheading font-semibold">
                {t('ruling.topics')}
              </h2>
              <TopicChips
                label={t('ruling.topics')}
                topics={topics.map((topic) => ({
                  href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
                  text: topic.name,
                }))}
              />
            </section>
          )}

          <FatwaHistory
            locale={locale}
            current={current}
            previous={fatwa.previous}
            t={t}
          />
        </div>

        <aside aria-labelledby="fatwa-provenance" className="min-w-0">
          <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]">
            <h2 id="fatwa-provenance" className="text-subheading font-semibold">
              {t('ruling.provenance')}
            </h2>
            <dl className="flex flex-col divide-y divide-[color:var(--color-border)]">
              {category === undefined ? null : (
                <DetailRow term={t('ruling.category')}>
                  <TextLink href={categoryHref(locale, category.slug)}>
                    {category.name}
                  </TextLink>
                </DetailRow>
              )}
              <DetailRow term={t('ruling.firstPublished')}>{published}</DetailRow>
              {correctedOn === null ? null : (
                <DetailRow term={t('ruling.corrected')}>{correctedOn}</DetailRow>
              )}
              <DetailRow term={t('ruling.language')}>{languageLabel}</DetailRow>
              {answeredBy === undefined ? null : (
                <DetailRow term={t('ruling.answeredBy')}>
                  <span dir="auto">
                    <TextLink
                      href={`/${locale}/people/${encodeURIComponent(answeredBy.slug)}`}
                    >
                      {answeredBy.name}
                    </TextLink>
                  </span>
                </DetailRow>
              )}
              {publishedBy === undefined ? null : (
                <DetailRow term={t('ruling.publishedBy')}>
                  <span dir="auto">
                    <TextLink
                      href={`/${locale}/people/${encodeURIComponent(publishedBy.slug)}`}
                    >
                      {publishedBy.name}
                    </TextLink>
                  </span>
                </DetailRow>
              )}
            </dl>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('ruling.provenanceNote')}
            </p>
            <p className="flex flex-col gap-1 text-sm">
              <a
                href={fatwaSectionPath(locale, 'how-it-works')}
                className="inline-flex min-h-11 items-center font-medium text-[color:var(--color-action)] underline underline-offset-2"
              >
                {t('unavailable.howItWorks')}
              </a>
              <a
                href={fatwaSectionPath(locale)}
                className="inline-flex min-h-11 items-center font-medium text-[color:var(--color-action)] underline underline-offset-2"
              >
                {t('ruling.all')}
              </a>
            </p>
          </div>
        </aside>
      </div>
    </FatwaFrame>
  );
}
