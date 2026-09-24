/**
 * Media — THE public interface (bounded context #8, DOMAIN_MODEL.md §11).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends on
 * the ports in `@minhaj/contracts/media` and is handed their implementations by
 * Layer 4.
 *
 * PHASE 10 DELIVERED VIDEO, SERIES AND PLAYLIST; PHASE 11 DELIVERS NON-QURAN
 * AUDIO — AudioTrack and AudioSeries, their file upload through Storage, and
 * the policy that decides when a track's bytes may be heard. PHASE 12 DELIVERS
 * PHOTOGRAPHS AND GALLERIES — Photo, Gallery and GalleryItem, the image upload
 * through Storage, and the same two-allow policy for a Photo's image.
 */
export { createMediaService } from './application/service.ts';
export { mediaFailure } from './application/refusal.ts';
export { createMediaReadService } from './application/read-service.ts';
export {
  createAudioSearchSource,
  createVideoSearchSource,
} from './application/search-projection.ts';
export { createAudioUpload } from './application/audio-upload.ts';
export { createPhotoUpload } from './application/photo-upload.ts';
export {
  createAudioAssetPolicy,
  createPhotoAssetPolicy,
} from './application/asset-policy.ts';
