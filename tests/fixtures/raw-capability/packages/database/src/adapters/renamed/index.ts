// FIXTURE — MUST FAIL. A "generic repository wrapper that merely renames the
// raw capability". Its return type is inferred, so the surface cannot be shown
// to be narrow and it fails closed.
import { getDatabaseClient } from '../../client';

export function repository() {
  return getDatabaseClient();
}
