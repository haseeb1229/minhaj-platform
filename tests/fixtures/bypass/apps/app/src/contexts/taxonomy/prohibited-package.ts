// FIXTURE — MUST FAIL. No context depends on Prisma directly
// (DOMAIN_MODEL.md §2 rule 7).
import { PrismaClient } from '@prisma/client';
export const client = new PrismaClient();
