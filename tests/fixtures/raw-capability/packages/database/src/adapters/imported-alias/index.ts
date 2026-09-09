// FIXTURE — MUST FAIL. Following an imported type alias must preserve the same
// fail-closed judgement as a local alias.
import { getDatabaseClient } from '../../client';
import type { HiddenCapability } from './types';

export function connection(): HiddenCapability {
  return getDatabaseClient();
}
