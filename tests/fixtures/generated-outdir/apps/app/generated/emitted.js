// Genuine compiler output under this project's CONFIGURED `outDir`. It is
// JavaScript, but it is not authored source, so `production-must-be-typescript`
// must NOT fire for it — the control proving the B1 fix distinguishes a
// configured output root from a directory merely NAMED `dist` (§6).
export const emitted = 'emitted';
