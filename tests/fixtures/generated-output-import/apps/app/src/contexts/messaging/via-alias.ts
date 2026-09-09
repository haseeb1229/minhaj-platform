// §15 — an ALIAS import whose resolved target is generated output. The
// specifier names no directory at all; only the resolution is revealing, which
// is exactly why the check must run on the resolved path.
export { quranInternal as viaAlias } from '#generated/barrel.js';
