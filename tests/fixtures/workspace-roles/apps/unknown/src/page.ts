// Composing a context's PUBLIC interface is exactly what Layer 4 is for — so
// this file is architecturally innocent AND STILL FAILS, because nobody
// classified this workspace as Layer 4 (Review #5, B3).
import { quran } from './contexts/quran/index.ts';

export const page = quran;
