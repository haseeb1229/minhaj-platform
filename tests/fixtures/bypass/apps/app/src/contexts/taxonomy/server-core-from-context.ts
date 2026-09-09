// FIXTURE — MUST FAIL. server-core is a host, not a layer; a context never
// depends on it (ARCHITECTURE.md §3.1).
import { createLogger } from '@minhaj/server-core';
export const l = createLogger;
