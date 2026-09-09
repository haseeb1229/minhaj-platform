'use client';

// FIXTURE — MUST FAIL. An ordinary wrapper is not a boundary.
import { createLogger } from '@/shared/ordinary-wrapper';

export function Leaky(): string {
  return typeof createLogger;
}
