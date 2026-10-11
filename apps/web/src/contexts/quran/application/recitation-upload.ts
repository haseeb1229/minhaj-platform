import 'server-only';

import type { StorageServicePort } from '@minhaj/contracts/platform';
import {
  RECITATION_AUDIO_MEDIA_TYPES,
  RECITATION_UPLOAD_MAX_BYTES,
  quranIdSchema,
  quranVersionSchema,
  type QuranActor,
  type QuranAuthorityPort,
  type QuranPersistencePort,
  type RecitationDetail,
} from '@minhaj/contracts/quran';

import { QuranRefusal, asRefusal, storageRefusal } from '../domain/refusal.ts';

/**
 * Uploading one recitation segment's audio — Quran's half of a two-owner
 * operation, by the same rules as every storage-backed upload on the platform.
 *
 * STORAGE HOLDS THE BYTES; QURAN RECORDS WHICH BYTES A SEGMENT IS. The file is
 * streamed straight into `StorageServicePort.store`, which alone generates the
 * key, measures and hashes the bytes, sniffs what they really are, quarantines
 * them and asks the malware scanner — none of which Quran can switch off or see
 * past. Only when Storage answers `clean` does Quran record the relation, under
 * the version the operator uploaded against.
 *
 * A RECITATION IS NOT AN AUDIOTRACK. The accepted format and the ceiling are
 * Quran's own constants, and nothing here reaches Media: no AudioTrack can be
 * attached as a segment, and no segment becomes a Media record.
 *
 * FILESYSTEM AND SQL ARE NOT ONE TRANSACTION, and every crash window serves
 * nothing: before the relation is written the stored asset is referenced by no
 * segment, and both serving policies allow only the asset RECORDED against that
 * exact segment — so it is a wasted file, never an exposure. A replacement
 * writes the new relation in one conditional update and leaves the previous
 * asset untouched, so a failed replacement never costs the last good file.
 *
 * NOT A DOOR AROUND AUTHORISATION. `quran.administer` is re-read LIVE before a
 * byte is accepted, and the Recitation, its version and the segment are all
 * checked BEFORE a byte is stored — so a stale form or a guessed segment costs
 * no storage and no scan — and the attachment re-checks the version inside its
 * own transaction.
 */

export interface RecitationFileDescription {
  /** What the browser SAID the type was. It can only refuse, never admit. */
  readonly declaredMediaType: string | null;
  /** The original filename, for display only. It never reaches a path. */
  readonly displayName: string | null;
}

export function createRecitationUpload(deps: {
  readonly persistence: QuranPersistencePort;
  readonly authority: QuranAuthorityPort;
  readonly storage: () => Promise<StorageServicePort>;
}) {
  return {
    async uploadSegmentAudio(
      actor: QuranActor,
      recitationId: string,
      segmentId: string,
      expectedVersion: number,
      bytes: AsyncIterable<Uint8Array>,
      file: RecitationFileDescription,
    ): Promise<RecitationDetail> {
      if (
        typeof actor?.accountId !== 'string' ||
        actor.accountId === '' ||
        !(await deps.authority.permits(actor.accountId, 'quran.administer'))
      )
        throw new QuranRefusal('denied');

      const id = quranIdSchema.safeParse(recitationId);
      const segment = quranIdSchema.safeParse(segmentId);
      const version = quranVersionSchema.safeParse(expectedVersion);
      if (!id.success || !segment.success || !version.success)
        throw new QuranRefusal('invalid');

      const current = await deps.persistence.recitation(id.data).catch(asRefusal);
      if (current === null) throw new QuranRefusal('not-found');
      if (current.version !== version.data) throw new QuranRefusal('conflict');
      if (!current.segments.some((entry) => entry.id === segment.data))
        throw new QuranRefusal('not-found');

      const storage = await deps.storage();
      const stored = await storage.store(bytes, {
        allowedMediaTypes: [...RECITATION_AUDIO_MEDIA_TYPES],
        maxBytes: RECITATION_UPLOAD_MAX_BYTES,
        declaredMediaType: file.declaredMediaType,
        displayName: file.displayName,
      });

      if (stored.state === 'rejected')
        throw new QuranRefusal(storageRefusal(stored.rejection));

      // ONLY A CLEAN ASSET IS RECORDED. A file still in quarantine — the scanner
      // unreachable, or not yet done — is not audio this segment has, and the
      // operator is told so rather than shown a segment that cannot play.
      if (stored.state !== 'clean') throw new QuranRefusal('not-cleared');

      return deps.persistence
        .attachSegmentAsset({
          actorId: actor.accountId,
          id: id.data,
          expectedVersion: version.data,
          segmentId: segment.data,
          assetId: stored.id,
        })
        .catch(asRefusal);
    },
  };
}
