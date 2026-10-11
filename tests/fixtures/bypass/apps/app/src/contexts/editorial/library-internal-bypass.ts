// FIXTURE — MUST FAIL. editorial -> library is allowed (Phase 15), but Library's
// internals are not, and a relative path must not evade that.
import { workTable } from '../library/application/work-table';
export const w = workTable;
