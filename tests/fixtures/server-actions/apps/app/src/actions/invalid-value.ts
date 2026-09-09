'use server';

// FIXTURE — MUST NOT BE A BOUNDARY. Next rejects non-function exports from a
// module-level Server Action file, so this marker cannot hide the import.
import { createLogger } from '@minhaj/server-core';

void createLogger;
export const notAnAction = 1;
