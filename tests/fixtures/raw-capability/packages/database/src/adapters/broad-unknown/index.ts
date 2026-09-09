// FIXTURE — MUST FAIL. An explicit annotation is not proof of a narrow
// surface when it erases the returned client to `unknown`.
import { getDatabaseClient } from '../../client';

export function connection(): unknown {
  return getDatabaseClient();
}
