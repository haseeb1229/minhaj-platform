'use client';

import { createLogger } from '@/actions/invalid-reexport';

export function InvalidReexportClient(): string {
  void createLogger;
  return 'invalid';
}
