// FIXTURE — MUST FAIL. This contract looks narrow and names no Prisma type,
// but the implementation returns the raw object itself. Structural typing must
// not turn possession into encapsulated invocation.
import { getDatabaseClient } from '../../client';

interface ConnectableStore {
  $connect(): Promise<void>;
}

interface StoreHolder {
  client: ConnectableStore;
}

export function directConnection(): ConnectableStore {
  const database = getDatabaseClient();
  return database;
}

export function nestedConnection(): StoreHolder {
  return { client: getDatabaseClient() };
}
