import 'server-only';

import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from '@prisma/client';
import { getDatabaseRuntimeUrl } from './config.ts';

export type DatabaseClient = PrismaClient;

let databaseClient: PrismaClient | undefined;

/**
 * Returns the process-wide Prisma client for the server runtime.
 *
 * Construction is lazy so importing a server module does not open a database
 * connection. Prisma and the MSSQL driver own pooling below this singleton.
 */
export function getDatabaseClient(): PrismaClient {
  databaseClient ??= new PrismaClient({
    adapter: new PrismaMssql(getDatabaseRuntimeUrl()),
  });

  return databaseClient;
}
