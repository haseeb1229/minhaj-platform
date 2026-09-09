// FIXTURE — MUST FAIL. No context depends on Prisma directly.
import { PrismaClient } from '@prisma/client';
export const client = PrismaClient;
