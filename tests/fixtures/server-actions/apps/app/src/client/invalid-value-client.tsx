'use client';

import { notAnAction } from '@/actions/invalid-value';

export function InvalidValueClient(): string {
  void notAnAction;
  return 'invalid';
}
