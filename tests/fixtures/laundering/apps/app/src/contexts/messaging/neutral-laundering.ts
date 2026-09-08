// FIXTURE — MUST FAIL as laundering.
// Every hop is individually legal; the composition is not. Messaging must not
// obtain Quran, and routing through a neutral helper does not change that.
import { ayahTable } from '../../shared/wrapper';

export const table = ayahTable;
