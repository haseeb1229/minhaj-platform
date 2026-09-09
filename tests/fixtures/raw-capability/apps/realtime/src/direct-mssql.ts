// FIXTURE — MUST FAIL. Not `@minhaj/database`, not Prisma — the MSSQL driver,
// which ARCHITECTURE.md §3.1.2 names separately for exactly this reason.
import { ConnectionPool } from 'mssql';
export const pool = ConnectionPool;
