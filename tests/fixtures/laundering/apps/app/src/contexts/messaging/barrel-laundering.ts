// FIXTURE — MUST FAIL. Laundering via a barrel (`export *`).
import { getAyah } from '../../shared/barrel';
export const a = getAyah('1:1');
