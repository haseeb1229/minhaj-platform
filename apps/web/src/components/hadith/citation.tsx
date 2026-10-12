import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability, PublicHadith } from '@minhaj/contracts/hadith';

import { contentLanguages, referenceNames } from '@/composition/public-references';
import { BreadcrumbData } from '@/components/media/parts';
import { DetailRow, Panel, TextLink } from '@/components/ui';
import {
  Contributors,
  HadithFrame,
  OriginalText,
  SourcedText,
  hadithTrail,
  languageOf,
} from './parts';
import {
  bookPathOf,
  chapterPathOf,
  citationTrail,
  collectionPath,
  hadithPath,
  hadithTopicPath,
} from './presentation';
import { hadithStructuredLocales } from './read';
import {
  CollectionTitle,
  StructureTitle,
  collectionText,
  structureText,
} from './structure';

/**
 * `/hadith/{collectionSlug}/{hadithNumber}` — THE CANONICAL CITATION of one
 * Hadith (ROUTE_MAP.md §2.1, §3.4).
 *
 * ONLY GENUINE, CURRENT-PUBLIC FACTS. The original text exactly as its source
 * gives it; the source's own reference; the edition and source system it was
 * taken from; its book and chapter; the chain AS GIVEN IN THE SOURCE; each
 * grading AS GIVEN IN THE SOURCE with its grader and published reference; the
 * public translations and commentary, each a separate, attributed work; and
 * the topics it is classified under. Nothing is inferred, ranked, coloured or
 * summarised: there is no badge, no "authentic", no grade vocabulary and no
 * narrator link (PRODUCT_SCOPE.md §4.4).
 *
 * TOLD APART WITHOUT BEING SEEN. Each part is its own headed section, and each
 * text its own labelled group in its own language and direction, so a screen
 * reader distinguishes the original, a translation, the chain and a grading.
 */
export async function CitationPage({
  locale,
  availability,
  hadith,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly hadith: PublicHadith;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const [languages, names] = await Promise.all([
    contentLanguages(),
    referenceNames(
      {
        personIds: hadith.translations.flatMap((translation) =>
          translation.contributors.map((contributor) => contributor.personId),
        ),
        topicIds: hadith.topicIds,
      },
      locale,
    ),
  ]);
  const collection = { slug: hadith.collection.slug, names: hadith.collection.names };
  const collectionName = collectionText(collection, locale);
  const heading = t('citationName', {
    collection: collectionName,
    number: hadith.number,
  });
  const bookPath = `/${locale}${bookPathOf(collection.slug, hadith.book.slug)}`;
  const chapterPath =
    hadith.chapter === null
      ? null
      : `/${locale}${chapterPathOf(collection.slug, hadith.book.slug, hadith.chapter.slug)}`;
  const trail = citationTrail({
    locale,
    home: parts.home.text,
    hadith: parts.hadith.text,
    collection: { slug: collection.slug, name: collectionName },
    book: { slug: hadith.book.slug, name: structureText(hadith.book, locale, t, 'book') },
    chapter:
      hadith.chapter === null
        ? null
        : {
            slug: hadith.chapter.slug,
            name: structureText(hadith.chapter, locale, t, 'chapter'),
          },
    citation: { number: hadith.number, name: heading },
  });
  const topics = hadith.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[
        ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
        { text: heading },
      ]}
    >
      <article aria-labelledby="hadith-heading" className="flex min-w-0 flex-col gap-8">
        <h1
          id="hadith-heading"
          className="text-3xl font-semibold tracking-tight wrap-anywhere"
        >
          <CollectionTitle collection={collection} locale={locale} />{' '}
          {t('number', { number: hadith.number })}
        </h1>

        <section className="flex flex-col gap-3" aria-labelledby="hadith-original">
          <h2 id="hadith-original" className="text-lg font-semibold">
            {t('original')}
          </h2>
          <div className="max-w-[var(--measure-prose)] min-w-0">
            <OriginalText
              id="hadith-original-text"
              label={t('originalOf', { citation: heading })}
              text={hadith.text}
              language={languageOf(languages, hadith.textLanguage)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="hadith-facts">
          <h2 id="hadith-facts" className="text-lg font-semibold">
            {t('facts')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <DetailRow term={t('fact.citation')}>
              <span dir="ltr">
                {hadith.collection.slug}/{String(hadith.number)}
              </span>
            </DetailRow>
            <DetailRow term={t('fact.sourceReference')}>
              <span dir="auto" className="whitespace-pre-wrap">
                {hadith.sourceReference}
              </span>
            </DetailRow>
            <DetailRow term={t('fact.collection')}>
              <TextLink href={collectionPath(locale, collection.slug)}>
                <CollectionTitle collection={collection} locale={locale} />
              </TextLink>
            </DetailRow>
            <DetailRow term={t('fact.edition')}>
              <span dir="auto">{hadith.attribution.editionTitle}</span>{' '}
              <span dir="ltr">({hadith.attribution.editionCode})</span>
            </DetailRow>
            <DetailRow term={t('fact.source')}>
              <span dir="auto">{hadith.attribution.sourceSystemTitle}</span>
            </DetailRow>
            <DetailRow term={t('fact.book')}>
              <TextLink href={bookPath}>
                <StructureTitle
                  structure={hadith.book}
                  locale={locale}
                  t={t}
                  kind="book"
                />
              </TextLink>{' '}
              <span className="text-[color:var(--color-foreground-muted)]">
                (<span dir="auto">{hadith.book.reference}</span>)
              </span>
            </DetailRow>
            {hadith.chapter === null || chapterPath === null ? null : (
              <DetailRow term={t('fact.chapter')}>
                <TextLink href={chapterPath}>
                  <StructureTitle
                    structure={hadith.chapter}
                    locale={locale}
                    t={t}
                    kind="chapter"
                  />
                </TextLink>{' '}
                <span className="text-[color:var(--color-foreground-muted)]">
                  (<span dir="auto">{hadith.chapter.reference}</span>)
                </span>
              </DetailRow>
            )}
          </dl>
        </section>

        {hadith.chain === null || hadith.chainLanguage === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="hadith-chain">
            <h2 id="hadith-chain" className="text-lg font-semibold">
              {t('chain')}
            </h2>
            <div className="max-w-[var(--measure-prose)] min-w-0">
              <SourcedText
                id="hadith-chain-text"
                label={t('chainOf', { citation: heading })}
                text={hadith.chain}
                language={languageOf(languages, hadith.chainLanguage)}
              />
            </div>
          </section>
        )}

        {hadith.gradings.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="hadith-gradings">
            <h2 id="hadith-gradings" className="text-lg font-semibold">
              {t('gradings.heading')}
            </h2>
            <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
              {t('gradings.note')}
            </p>
            <ol aria-labelledby="hadith-gradings" className="flex flex-col gap-3">
              {[...hadith.gradings]
                .sort((a, b) => a.position - b.position)
                .map((grading) => {
                  const label = languageOf(languages, grading.labelLanguage);
                  return (
                    <li key={grading.position}>
                      <article
                        aria-label={t('gradings.item', { grader: grading.grader })}
                        className="min-w-0 border-s-2 border-[color:var(--color-border)] ps-4"
                      >
                        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-3">
                          <DetailRow term={t('gradings.grader')}>
                            <span dir="auto">{grading.grader}</span>
                          </DetailRow>
                          <DetailRow term={t('gradings.label')}>
                            <span lang={label.code} dir={label.direction}>
                              {grading.label}
                            </span>
                          </DetailRow>
                          <DetailRow term={t('gradings.reference')}>
                            <span dir="auto">{grading.reference}</span>
                          </DetailRow>
                        </dl>
                      </article>
                    </li>
                  );
                })}
            </ol>
          </section>
        )}

        {hadith.translations.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="hadith-translations">
            <h2 id="hadith-translations" className="text-lg font-semibold">
              {t('translations.heading')}
            </h2>
            <ul className="flex flex-col gap-4">
              {hadith.translations.map((translation) => {
                const language = languageOf(languages, translation.languageCode);
                const label = t('translations.item', { language: language.name });
                return (
                  <Panel key={translation.id} as="li">
                    <article aria-label={label} className="flex min-w-0 flex-col gap-3">
                      <h3 className="text-base font-semibold">
                        {t('translations.title')}
                        {' · '}
                        <span lang={language.code} dir={language.direction}>
                          {language.name}
                        </span>
                      </h3>
                      <div className="max-w-[var(--measure-prose)] min-w-0">
                        <SourcedText
                          id={`hadith-translation-${translation.id}`}
                          label={label}
                          text={translation.text}
                          language={language}
                        />
                      </div>
                      <Contributors
                        locale={locale}
                        contributors={translation.contributors}
                        names={names}
                        t={t}
                      />
                      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                        {translation.attribution === null ? null : (
                          <DetailRow term={t('work.attribution')}>
                            <span dir="auto">{translation.attribution}</span>
                          </DetailRow>
                        )}
                        <DetailRow term={t('fact.source')}>
                          <span dir="auto">{translation.sourceSystemTitle}</span>
                        </DetailRow>
                      </dl>
                    </article>
                  </Panel>
                );
              })}
            </ul>
          </section>
        )}

        {hadith.commentary.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="hadith-commentary">
            <h2 id="hadith-commentary" className="text-lg font-semibold">
              {t('sections.commentary')}
            </h2>
            <ul className="flex flex-col gap-4">
              {hadith.commentary.map((entry) => {
                const language = languageOf(languages, entry.languageCode);
                const label = t('commentaryOf', { name: entry.name });
                return (
                  <Panel key={entry.commentaryId} as="li">
                    <article aria-label={label} className="flex min-w-0 flex-col gap-3">
                      <h3 className="text-base font-semibold wrap-anywhere" dir="auto">
                        <TextLink
                          href={`${hadithPath(locale, 'commentary')}#commentary-${encodeURIComponent(entry.slug)}`}
                        >
                          {entry.name}
                        </TextLink>
                      </h3>
                      <div className="max-w-[var(--measure-prose)] min-w-0">
                        <SourcedText
                          id={`hadith-commentary-${entry.commentaryId}`}
                          label={label}
                          text={entry.text}
                          language={language}
                        />
                      </div>
                      {entry.attribution === null ? null : (
                        <p
                          className="text-xs wrap-anywhere text-[color:var(--color-foreground-muted)]"
                          dir="auto"
                        >
                          {entry.attribution}
                        </p>
                      )}
                    </article>
                  </Panel>
                );
              })}
            </ul>
          </section>
        )}

        {topics.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="hadith-topics">
            <h2 id="hadith-topics" className="text-lg font-semibold">
              {t('topicList')}
            </h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {topics.map((topic) => (
                <li key={topic.slug} className="min-w-0 wrap-anywhere">
                  <TextLink href={hadithTopicPath(locale, topic.slug)}>
                    <span dir="auto">{topic.name}</span>
                  </TextLink>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <BreadcrumbData
        contentLocales={hadithStructuredLocales(availability)}
        trail={trail}
      />
    </HadithFrame>
  );
}
