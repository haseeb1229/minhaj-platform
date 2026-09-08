// Matched by `include` and then removed by `exclude` — so it is NOT a root
// input. `tsc -p` loads it regardless, because an included source imports it
// (Review #5, B-02d). It must enter the graph through the Program closure.
export type { Secret as LeakD } from '@/contexts/quran/internal/repository';
