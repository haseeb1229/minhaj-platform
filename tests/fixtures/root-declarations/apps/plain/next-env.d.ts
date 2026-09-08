// NOT a Next application — this workspace depends on no `next` package. The
// name carries no authority (Review #4 B2), and living at a workspace ROOT
// rather than under `src/` carries none either (Review #5 B2).
export type { Secret as LeakA } from '@/contexts/quran/internal/repository';
