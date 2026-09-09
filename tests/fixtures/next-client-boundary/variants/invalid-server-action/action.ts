'use server';

import { createLogger } from '@minhaj/server-core';

// Next.js rejects this export shape. A directive with a non-function export is
// not a valid boundary and must not become useful laundering syntax.
void createLogger;
export const notAnAction = 1;
