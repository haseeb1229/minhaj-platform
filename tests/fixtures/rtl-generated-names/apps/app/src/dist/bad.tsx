// Review #8 (B8-1): AUTHORED production source that merely lives in a
// directory someone named `dist`. Real `tsc` compiles it and the architecture
// gate includes it, but the RTL scanner skipped the directory by basename — so
// a physical-direction inline style shipped with no diagnostic at all.
export const physicalDirectionStyle = { borderLeftWidth: 1 };
