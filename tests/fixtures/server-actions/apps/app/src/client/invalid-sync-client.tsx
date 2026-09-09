'use client';

import { notAsync } from '@/actions/invalid-sync';

export function InvalidSyncClient(): string {
  void notAsync;
  return 'invalid';
}
