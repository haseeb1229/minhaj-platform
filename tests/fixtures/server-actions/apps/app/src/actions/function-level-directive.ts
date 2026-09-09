import { createLogger } from '@minhaj/server-core';

export async function inlineAction(): Promise<string> {
  'use server';
  return typeof createLogger;
}
