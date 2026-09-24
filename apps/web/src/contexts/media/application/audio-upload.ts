import 'server-only';

import {
  AUDIO_MEDIA_TYPES,
  AUDIO_UPLOAD_MAX_BYTES,
  mediaIdSchema,
  mediaVersionSchema,
  type AudioTrackRecord,
  type MediaActor,
  type MediaAuthorityPort,
  type MediaPersistencePort,
} from '@minhaj/contracts/media';
import type { AssetRejection, StorageServicePort } from '@minhaj/contracts/platform';

import { MediaRefusal } from './refusal.ts';

/**
 * Uploading a track's audio file — Media's half of a two-owner operation
 * (DELIVERY_PLAN.md Phase 11: "storage-backed asset lifecycle through Phase 7").
 *
 * STORAGE HOLDS THE BYTES; MEDIA RECORDS WHICH BYTES A TRACK IS. The file is
 * streamed straight into `StorageServicePort.store`, which alone generates the
 * key, measures and hashes the bytes, sniffs what they really are, quarantines
 * them and asks the malware scanner — none of which Media can switch off or see
 * past. Only when Storage answers `clean` does Media record the relation, under
 * the version the operator uploaded against.
 *
 * FILESYSTEM AND SQL ARE NOT ONE TRANSACTION, and nothing here pretends they
 * are. Every crash window leaves a state that serves nothing:
 *
 *   - before the relation is written, a stored asset is referenced by no track,
 *     and the serving policy allows only the asset RECORDED against a track —
 *     so it is a wasted file, never an exposure;
 *   - the relation is written only after a `clean` answer, so a track never
 *     names bytes that were not stored, scanned and cleared;
 *   - a replacement writes the new relation in one conditional update and leaves
 *     the previous asset untouched, so a failed replacement never costs the last
 *     good file.
 *
 * Orphaned uploaded bytes are the deliberate price: deleting an asset on a
 * failure path risks deleting the wrong authoritative one, and Storage's own
 * bounded reconciliation owns Storage's resources.
 *
 * NOT A DOOR AROUND AUTHORISATION. `media.administer` is re-read LIVE before a
 * byte is accepted, the track and its version are checked BEFORE a byte is
 * stored (so a stale form costs no storage and no scan), and the attachment
 * re-checks the version inside its own transaction.
 */

/** Storage's refusal, in the words the operator's screen has. */
function refusalOf(rejection: AssetRejection | null): string {
  if (rejection === 'too-large') return 'too-large';
  // A scanner's verdict is Storage's to record, not this screen's to display: an
  // infected or unscannable file is "not cleared", like one still in quarantine.
  if (rejection === 'infected' || rejection === 'unscannable') return 'not-cleared';
  return 'unsupported';
}

export interface AudioFileDescription {
  /** What the browser SAID the type was. It can only refuse, never admit. */
  readonly declaredMediaType: string | null;
  /** The original filename, for display only. It never reaches a path. */
  readonly displayName: string | null;
}

export function createAudioUpload(deps: {
  readonly persistence: MediaPersistencePort;
  readonly authority: MediaAuthorityPort;
  readonly storage: () => Promise<StorageServicePort>;
}) {
  return {
    async uploadAudio(
      actor: MediaActor,
      trackId: string,
      expectedVersion: number,
      bytes: AsyncIterable<Uint8Array>,
      file: AudioFileDescription,
    ): Promise<AudioTrackRecord> {
      if (
        !actor?.accountId ||
        !(await deps.authority.permits(actor.accountId, 'media.administer'))
      )
        throw new MediaRefusal('denied');

      const id = mediaIdSchema.parse(trackId);
      const version = mediaVersionSchema.parse(expectedVersion);

      const current = await deps.persistence.audioTrack(id);
      if (current === null) throw new MediaRefusal('not-found');
      if (current.version !== version) throw new MediaRefusal('conflict');

      const storage = await deps.storage();
      const stored = await storage.store(bytes, {
        allowedMediaTypes: [...AUDIO_MEDIA_TYPES],
        maxBytes: AUDIO_UPLOAD_MAX_BYTES,
        declaredMediaType: file.declaredMediaType,
        displayName: file.displayName,
      });

      if (stored.state === 'rejected')
        throw new MediaRefusal(refusalOf(stored.rejection));

      // ONLY A CLEAN ASSET IS ATTACHED. A file still in quarantine — the scanner
      // unreachable, or not yet done — is not a file this track has, and the
      // operator is told so rather than shown a track that cannot play.
      if (stored.state !== 'clean') throw new MediaRefusal('not-cleared');

      return deps.persistence.attachAudioAsset({
        actorId: actor.accountId,
        trackId: id,
        expectedVersion: version,
        assetId: stored.id,
      });
    },
  };
}
