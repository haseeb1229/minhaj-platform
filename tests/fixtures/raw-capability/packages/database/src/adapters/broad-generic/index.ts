// FIXTURE — MUST FAIL. An unconcretised generic can be instantiated or cast as
// raw capability and proves no context-owned contract.
import { getDatabaseClient } from '../../client';

export function connection<T>(): T {
  return getDatabaseClient() as T;
}
