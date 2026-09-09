import { PrismaClient } from '@prisma/client';

export type DatabaseClient = PrismaClient;

export function getDatabaseClient(): DatabaseClient {
  return new PrismaClient();
}
