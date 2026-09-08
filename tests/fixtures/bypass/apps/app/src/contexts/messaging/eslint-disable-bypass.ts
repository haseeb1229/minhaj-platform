// FIXTURE — MUST FAIL. Review bypass: inline disable suppressed the ESLint rule.
// The standalone checker is a separate process and ignores these directives.
/* eslint-disable no-restricted-imports */
// eslint-disable-next-line no-restricted-imports
import { getAyah } from '@/contexts/quran';
export const a = getAyah('1:1');
