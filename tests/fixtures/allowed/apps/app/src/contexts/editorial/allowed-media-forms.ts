// FIXTURE — MUST PASS. Every permitted form of the allowlisted
// editorial -> media edge (Phase 14), through the public interface only.
import { createGalleryReferences } from '@/contexts/media';
export { createGalleryReferences } from '@/contexts/media';
export const lazyMedia = () => import('@/contexts/media');
export const checkGallery = createGalleryReferences;
