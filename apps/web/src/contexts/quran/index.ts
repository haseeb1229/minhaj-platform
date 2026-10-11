/**
 * Quran — THE public interface (bounded context #5, DOMAIN_MODEL.md §8).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends on
 * the ports in `@minhaj/contracts/quran` and is handed their implementations by
 * Layer 4.
 *
 * PHASE 18 DELIVERS the canonical structure and text — verified exactly against
 * a registered source and changed only through the step-up-bound canonical
 * service — and the LAYERED works over it: Translation, Transliteration,
 * Tafsir, Recitation with its segment audio, and Tajweed guidance, each its own
 * work with its own lifecycle and source.
 *
 * QURAN READS NO OTHER CONTENT CONTEXT, and none reads Quran. Media, Library,
 * Editorial and Hadith are never imported here; a recitation is not an
 * AudioTrack, and `/listen/recitations` is a Layer-4 page over this context's
 * public reader.
 */
export {
  QURAN_REFUSAL_REASONS,
  QuranRefusal,
  isQuranRefusalReason,
  quranFailure,
  type QuranRefusalReason,
} from './domain/refusal.ts';
export {
  compareExact,
  decodeExact,
  verifyCorpus,
  type DecodeRefusal,
  type DecodeResult,
} from './domain/verification.ts';
export {
  createQuranService,
  type LayerTextSaveInput,
  type QuranService,
} from './application/service.ts';
export {
  createQuranCanonicalService,
  type AyahCorrectionOutcome,
  type CanonicalLog,
  type CanonicalLogDetail,
  type CorpusAcceptanceOutcome,
  type QuranCanonicalService,
} from './application/canonical-service.ts';
export {
  createRecitationUpload,
  type RecitationFileDescription,
} from './application/recitation-upload.ts';
export {
  createRecitationAssetPolicy,
  createRecitationPreviewPolicy,
  type RecitationAssetRequest,
} from './application/asset-policy.ts';
export { createQuranReadService } from './application/read-service.ts';
export {
  ayahPath,
  createQuranSearchProjection,
} from './application/search-projection.ts';
