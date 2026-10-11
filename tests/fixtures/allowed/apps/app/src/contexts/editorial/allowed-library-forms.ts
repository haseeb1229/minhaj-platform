// FIXTURE — MUST PASS. Every permitted form of the allowlisted
// editorial -> library edge (Phase 15), through the public interface only.
import { createLibraryReadService } from '@/contexts/library';
export { createLibraryReadService } from '@/contexts/library';
export const lazyLibrary = () => import('@/contexts/library');
export const workReferences = createLibraryReadService;
