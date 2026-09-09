// 'use server'
const marker = 'use server';

import { createLogger } from '@minhaj/server-core';

export async function pretend(): Promise<string> {
  return `${marker}${typeof createLogger}`;
}
