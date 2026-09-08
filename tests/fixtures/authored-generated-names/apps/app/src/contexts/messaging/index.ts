// Review #6 (B2): every one of these targets is AUTHORED source that happens
// to sit in a directory whose name looks generated. Real `tsc` compiles them
// all, so each is a genuine Messaging -> Quran-internal edge.
export { quranInternal as viaDist } from '../../dist/barrel.ts';
export { quranInternal as viaBuild } from '../../build/barrel.ts';
export { quranInternal as viaCoverage } from '../../coverage/barrel.ts';
export { quranInternal as viaCache } from '../../cache/barrel.ts';
export { quranInternal as viaNestedDist } from '../../features/dist/barrel.ts';
export { quranInternal as viaNestedBuild } from '../../something/build/internal.ts';
