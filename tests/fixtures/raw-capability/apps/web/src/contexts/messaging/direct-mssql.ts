// FIXTURE — MUST FAIL. The MSSQL driver is the same dependency one layer down.
import { ConnectionPool } from 'mssql';
export const pool = ConnectionPool;
