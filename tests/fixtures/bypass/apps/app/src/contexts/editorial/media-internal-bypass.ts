// FIXTURE — MUST FAIL. editorial -> media is allowed (Phase 14), but Media's
// internals are not, and a relative path must not evade that.
import { galleryTable } from '../media/application/gallery-table';
export const g = galleryTable;
