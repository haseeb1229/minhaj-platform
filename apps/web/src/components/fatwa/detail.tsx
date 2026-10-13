import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { FatwaAvailability, PublicFatwa } from '@minhaj/contracts/fatwa';

import { contentLanguages, referenceNames } from '@/composition/public-references';
import { BreadcrumbData } from '@/components/media/parts';
import { Alert, PageHeading, TextLink } from '@/components/ui';
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

      <header className="flex min-w-0 flex-col gap-3">
        <PageHeading>
          <span className="wrap-anywhere" lang={current.language} dir={direction}>
            {current.title}
          </span>
        </PageHeading>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {category === undefined ? null : (
            <div className="flex gap-1">
              <dt className="text-[color:var(--color-foreground-muted)]">
                {t('ruling.category')}:
              </dt>
              <dd className="wrap-anywhere">
                <TextLink href={categoryHref(locale, category.slug)}>
                  {category.name}
                </TextLink>
              </dd>
            </div>
          )}
          <div className="flex gap-1">
            <dt className="text-[color:var(--color-foreground-muted)]">
              {t('ruling.firstPublished')}:
            </dt>
            <dd>
              <FatwaDate value={fatwa.firstPublishedAt} locale={locale} />
            </dd>
          </div>
          {corrected ? (
            <div className="flex gap-1">
              <dt className="text-[color:var(--color-foreground-muted)]">
                {t('ruling.corrected')}:
              </dt>
              <dd>
                <FatwaDate value={current.publishedAt} locale={locale} />
              </dd>
            </div>
          ) : null}
        </dl>
        {corrected && current.correctionReason !== null ? (
          <p className="text-sm whitespace-pre-wrap wrap-anywhere" dir="auto">
            <span className="font-semibold">{t('ruling.correctionReason')}:</span>{' '}
            {current.correctionReason}
          </p>
        ) : null}
        {current.language === locale ? null : (
          <Alert tone="info">
            {t('ruling.languageNotice', { language: languageName })}
          </Alert>
        )}
      </header>

      <section className="flex min-w-0 flex-col gap-2" aria-labelledby="fatwa-question">
        <h2 id="fatwa-question" className="text-lg font-semibold">
          {t('ruling.question')}
        </h2>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('ruling.questionNote')}
        </p>
        <p
          className="max-w-[var(--measure-prose)] whitespace-pre-wrap wrap-anywhere"
          lang={current.language}
          dir={direction}
        >
          {current.publicQuestion}
        </p>
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-labelledby="fatwa-ruling">
        <h2 id="fatwa-ruling" className="text-lg font-semibold">
          {t('ruling.answer')}
        </h2>
        <p
          className="max-w-[var(--measure-prose)] text-base leading-relaxed whitespace-pre-wrap wrap-anywhere"
          lang={current.language}
          dir={direction}
        >
          {current.ruling}
        </p>
      </section>

      {topics.length === 0 ? null : (
        <section className="flex flex-col gap-2" aria-labelledby="fatwa-topics">
          <h2 id="fatwa-topics" className="text-lg font-semibold">
            {t('ruling.topics')}
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {topics.map((topic) => (
              <li key={topic.id} className="wrap-anywhere">
                <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
                  {topic.name}
                </TextLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {answeredBy === undefined && publishedBy === undefined ? null : (
        <dl className="flex flex-col gap-1 text-sm">
          {answeredBy === undefined ? null : (
            <div className="flex flex-wrap gap-1">
              <dt className="text-[color:var(--color-foreground-muted)]">
                {t('ruling.answeredBy')}:
              </dt>
              <dd className="wrap-anywhere" dir="auto">
                <TextLink
                  href={`/${locale}/people/${encodeURIComponent(answeredBy.slug)}`}
                >
                  {answeredBy.name}
                </TextLink>
              </dd>
            </div>
          )}
          {publishedBy === undefined ? null : (
            <div className="flex flex-wrap gap-1">
              <dt className="text-[color:var(--color-foreground-muted)]">
                {t('ruling.publishedBy')}:
              </dt>
              <dd className="wrap-anywhere" dir="auto">
                <TextLink
                  href={`/${locale}/people/${encodeURIComponent(publishedBy.slug)}`}
                >
                  {publishedBy.name}
                </TextLink>
              </dd>
            </div>
          )}
        </dl>
      )}

      <FatwaHistory locale={locale} current={current} previous={fatwa.previous} t={t} />

      <p>
        <TextLink href={fatwaSectionPath(locale)}>{t('ruling.all')}</TextLink>
      </p>
    </FatwaFrame>
  );
}
