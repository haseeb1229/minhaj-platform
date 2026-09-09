// FIXTURE — MUST FAIL. A Layer 0 package every bounded context may consume,
// importing the Prisma client. Were it permitted, all sixteen contexts would
// hold raw database capability without one of them naming it.
import { PrismaClient } from '@prisma/client';
export type Client = PrismaClient;
