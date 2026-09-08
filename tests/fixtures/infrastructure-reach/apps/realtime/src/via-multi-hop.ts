// MUST FAIL — apps/realtime -> wrapper -> contracts -> database.
import { connection } from '@fixture/wrapper';

export const used = connection;
