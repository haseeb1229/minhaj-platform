'use server';

// FIXTURE — MUST NOT BE A BOUNDARY. Server Actions are asynchronous functions.
import { createLogger } from '@minhaj/server-core';

export function notAsync(): string {
  void createLogger;
  return 'not an action';
}
