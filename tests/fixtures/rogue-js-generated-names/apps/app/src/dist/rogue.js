// Review #7 (B1): AUTHORED production JavaScript sitting in a directory named
// `dist`. `allowJs` is false, so no TypeScript Program ever loads this file and
// real `tsc` exits 0 — the directory walk is the only mechanism that can see
// it, and it must not look away because of a directory NAME.
export const rogue = 'dist-rogue';
