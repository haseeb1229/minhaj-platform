// MUST FAIL — Messaging reaches Quran through a package WILDCARD export. The
// wildcard is the only reason the edge was previously invisible.
import { canon } from '@fixture/gateway/quran-gate';

export const used = canon;
