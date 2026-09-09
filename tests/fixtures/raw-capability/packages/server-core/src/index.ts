// FIXTURE — MUST FAIL. The service host holding raw capability of its own. A
// hosted service persists through its OWN context's port and adapter, exactly
// as it would when called from apps/web (ARCHITECTURE.md §3.1 rule 4, §4.1).
import { PrismaClient } from '@prisma/client';
export const client = PrismaClient;
