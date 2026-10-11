// FIXTURE — MUST FAIL. library -> editorial is prohibited in every form: the
// edge runs one way only, editorial -> library (Phase 15).
export const reviseCollection = () => import('@/contexts/editorial');
