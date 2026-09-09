// Review #7 (B3): an AUTHORED source module importing into the project's own
// configured `outDir`. TypeScript resolves `../../../dist/barrel.js` to the
// emitted declaration `dist/barrel.d.ts`, which re-exports a Quran internal, so
// real `tsc` succeeds. The analyser resolved the target correctly and then
// silently dropped it for living under a generated root — leaving zero
// violations for an edge that genuinely crosses a context boundary.
export { quranInternal } from '../../../dist/barrel.js';
