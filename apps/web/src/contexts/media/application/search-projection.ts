import type {
  AudioSearchRecord,
  MediaLabel,
  MediaPublicReaderPort,
  VideoSearchRecord,
} from '@minhaj/contracts/media';
import type { SearchDocumentSource, SearchScopeSource } from '@minhaj/contracts/search';

/**
 * Media's search projections — one scope per public Video (DELIVERY_PLAN.md
 * Phase 10: "search projection and filters") and, from Phase 11, one per public
 * AudioTrack, built by the SAME rules.
 *
 * ONE DOCUMENT PER DESCRIPTIVE LABEL, each tokenised in its own language and
 * every one carrying the Video's genuine CONTENT language, so "Urdu videos"
 * finds an Urdu lecture whichever label matched, and an English title never
 * makes it English.
 *
 * THE TRANSCRIPT, where the organisation holds one, is matched only in the
 * document written in the content language — text tokenised by another
 * language's word breaker matches nothing reliably. When no label is in that
 * language, one more document carries it, titled by the primary label.
 *
 * WHAT IS NOT HERE. No provider identifier, no embed or watch address, no
 * availability and no speaker name: a speaker is found as a Person result, and
 * putting names into Videos would make every People edit re-project Media.
 * For an AudioTrack likewise no asset identifier, no storage key and nothing
 * about its file. The result links to the CURRENT address, resolved at query
 * time.
 */

function primarySubtag(code: string): string {
  return (code.split('-')[0] ?? code).toLowerCase();
}

function documents(
  kind: 'video' | 'audio',
  record: VideoSearchRecord | AudioSearchRecord,
): SearchDocumentSource[] {
  const contentSubtag = primarySubtag(record.languageCode);
  const transcript = record.transcript ?? '';

  const document = (
    label: MediaLabel,
    textLanguage: string,
    carriesTranscript: boolean,
  ): SearchDocumentSource => ({
    kind,
    resourceId: record.id,
    textLanguage,
    contentLanguage: record.languageCode,
    title: label.title,
    summary: label.description,
    body: carriesTranscript ? transcript : '',
    year: record.year,
    topicIds: [...record.topicIds],
  });

  const labelled = record.labels.map((label) =>
    document(label, label.locale, label.locale === contentSubtag),
  );

  const primary =
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0];
  if (
    transcript === '' ||
    primary === undefined ||
    record.labels.some((label) => label.locale === contentSubtag)
  )
    return labelled;

  return [...labelled, document(primary, record.languageCode, true)];
}

export function createVideoSearchSource(
  reader: MediaPublicReaderPort,
): SearchScopeSource {
  return {
    async project(id) {
      const record = await reader.searchVideo(id);
      return record === null
        ? null
        : { stamp: record.stamp, documents: documents('video', record) };
    },
    list: (input) => reader.searchVideos(input),
  };
}

export function createAudioSearchSource(
  reader: MediaPublicReaderPort,
): SearchScopeSource {
  return {
    async project(id) {
      const record = await reader.searchAudio(id);
      return record === null
        ? null
        : { stamp: record.stamp, documents: documents('audio', record) };
    },
    list: (input) => reader.searchAudioTracks(input),
  };
}
