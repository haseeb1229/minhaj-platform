import type {
  LibraryPublicReaderPort,
  LibrarySearchRecord,
  ScholarlyKind,
  ScholarlyLabel,
  ScholarlySearchRecord,
} from '@minhaj/contracts/library';
import type { SearchDocumentSource, SearchScopeSource } from '@minhaj/contracts/search';

/**
 * Library's search projection — one scope per public Work (DELIVERY_PLAN.md
 * Phase 17: "Work, Edition and BookTranslation records").
 *
 * WHY ONE SCOPE. An Edition is public only while its Work is, and shares the
 * Work's title and topics. Projecting the Work and its Editions together means
 * a withdrawn Work withdraws its Editions in the same step rather than leaving
 * them to a second unit of work that could fail on its own.
 *
 * LOCALIZED METADATA IS NOT TRANSLATION (DOMAIN_MODEL.md §10.1). A Work
 * document per descriptive label, with NO content language — a Work has none.
 * Each published Edition is ONE document in its OWN content language, indexed
 * as `book-translation` when it is a genuine translation of another Edition
 * and as `edition` otherwise — never both, so one manifestation is one result.
 *
 * METADATA ONLY. No reader text, no file, no asset, no availability decision:
 * reading and downloading remain Library's and Storage's to authorise.
 */

function primarySubtag(code: string): string {
  return (code.split('-')[0] ?? code).toLowerCase();
}

/** The Work's descriptive label best suited to an Edition's own language. */
function labelFor(record: LibrarySearchRecord, languageCode: string) {
  return (
    record.labels.find((label) => label.locale === primarySubtag(languageCode)) ??
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0]
  );
}

function documentsOf(record: LibrarySearchRecord): SearchDocumentSource[] {
  const works = record.labels.map((label): SearchDocumentSource => ({
    kind: 'work',
    resourceId: record.id,
    textLanguage: label.locale,
    contentLanguage: null,
    title: label.title,
    summary: label.description,
    body: '',
    year: null,
    topicIds: [...record.topicIds],
  }));

  const editions = record.editions.map((edition): SearchDocumentSource => {
    const label = labelFor(record, edition.languageCode);
    const workTitle = label?.title ?? record.slug;
    return {
      kind: edition.isTranslation ? 'book-translation' : 'edition',
      resourceId: edition.id,
      textLanguage: edition.languageCode,
      contentLanguage: edition.languageCode,
      title: `${workTitle} — ${edition.label}`,
      summary: label?.description ?? '',
      body: [edition.publisher, edition.isbn].filter((part) => part !== null).join('\n'),
      year: edition.publicationYear,
      topicIds: [...record.topicIds],
    };
  });

  return [...works, ...editions];
}

export function createLibrarySearchSource(
  reader: LibraryPublicReaderPort,
): SearchScopeSource {
  return {
    async project(id) {
      const record = await reader.searchWork(id);
      return record === null
        ? null
        : { stamp: record.stamp, documents: documentsOf(record) };
    },
    list: (input) => reader.searchWorks(input),
  };
}

/* ===========================================================================
 * Phase 9 — one scope per Research, ResearchPaper, Publication, Magazine,
 * MagazineIssue and Encyclopedia
 * ========================================================================= */

/**
 * The documents for one public Phase-9 record.
 *
 * ONE DOCUMENT PER DESCRIPTIVE LABEL, each tokenised in its own language, and
 * every one of them carrying the record's genuine CONTENT language — so
 * "Urdu content" finds an Urdu paper whichever label matched, and an English
 * label never makes a paper English (DOMAIN_MODEL.md §10.1).
 *
 * THE RECORD'S OWN WORDS — abstract, context, readable text — are matched only
 * in the document written in its content language, because text tokenised by
 * another language's word breaker matches nothing reliably. When no label is in
 * that language, one more document carries them, titled by the primary label.
 *
 * AN ISSUE CARRIES ITS MAGAZINE'S TITLE in what is matched (never displayed), so
 * a visitor searching for the periodical's name finds its issues. That is why a
 * Magazine's own change re-projects its issues.
 */
function scholarlyDocuments(record: ScholarlySearchRecord): SearchDocumentSource[] {
  const contentLanguage = record.languageCode;
  const contentSubtag = contentLanguage === null ? null : primarySubtag(contentLanguage);
  const text = record.text.join('\n');
  const parentTitle = (locale: string): string =>
    (
      record.parentLabels.find((label) => label.locale === locale) ??
      record.parentLabels[0]
    )?.title ?? '';

  const document = (
    label: ScholarlyLabel,
    textLanguage: string,
    carriesText: boolean,
  ): SearchDocumentSource => ({
    kind: record.kind,
    resourceId: record.id,
    textLanguage,
    contentLanguage,
    title: label.title,
    summary:
      label.summary !== '' ? label.summary : carriesText ? (record.text[0] ?? '') : '',
    body: [parentTitle(label.locale), carriesText ? text : '']
      .filter((part) => part !== '')
      .join('\n'),
    year: record.publicationYear,
    topicIds: [...record.topicIds],
  });

  const labelled = record.labels.map((label) =>
    document(label, label.locale, label.locale === contentSubtag),
  );

  const primary =
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0];
  if (
    contentLanguage === null ||
    text === '' ||
    primary === undefined ||
    record.labels.some((label) => label.locale === contentSubtag)
  )
    return labelled;

  return [...labelled, document(primary, contentLanguage, true)];
}

export function createScholarlySearchSource(
  reader: LibraryPublicReaderPort,
  kind: ScholarlyKind,
): SearchScopeSource {
  return {
    async project(id) {
      const record = await reader.scholarlySearchRecord(kind, id);
      return record === null
        ? null
        : { stamp: record.stamp, documents: scholarlyDocuments(record) };
    },
    list: (input) => reader.scholarlySearchList(kind, input),
  };
}
