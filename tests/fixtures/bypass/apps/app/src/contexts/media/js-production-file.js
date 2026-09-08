// FIXTURE — MUST FAIL. Review bypass: a .js file in production source escapes
// both tsc (allowJs without checkJs) and rules scoped to {ts,tsx}.
import { getAyah } from '@/contexts/quran';
export const a = getAyah('1:1');
