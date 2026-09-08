// FIXTURE — MUST FAIL. Review bypass: explicit .js extension on a TS module.
import { getAyah } from '@/contexts/quran/index.js';
export const a = getAyah('1:1');
