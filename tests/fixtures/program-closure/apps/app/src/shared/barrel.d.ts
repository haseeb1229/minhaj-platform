// Excluded from `include`, yet compiled: reached from an included root. The
// alias below is resolved by TypeScript with THIS PROJECT'S `paths`, so the
// architecture analyser must resolve it the same way (Review #5, B1).
import type { Secret } from '@/contexts/quran/internal/repository';

export interface Barrel {
  ok: Secret;
}
