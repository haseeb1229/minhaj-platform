// FIXTURE — MUST FAIL. The TDS driver beneath the MSSQL client: the same
// capability two layers down, named by neither deny list but by the raw
// capability walk (ARCHITECTURE.md §3.1.2).
import { Connection } from 'tedious';
export const connection = Connection;
