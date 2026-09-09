// PRIVATE infrastructure. Raw Prisma client construction happens inside this
// package and nowhere else (ARCHITECTURE.md §4.1), and it is never published:
// `src/index.ts` does not export it, and nothing outside this package may
// import it.
import { PrismaClient } from '@prisma/client';

export type DatabaseClient = PrismaClient;

export function getDatabaseClient(): DatabaseClient {
  return new PrismaClient();
}
