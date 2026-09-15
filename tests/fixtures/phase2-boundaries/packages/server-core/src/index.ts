// PROHIBITED: the server-only HOST reaching the database package.
//
// `server-core` receives narrow readers and policies. If it could reach
// persistence itself, the future realtime process would acquire raw database
// capability merely by verifying a session (ARCHITECTURE.md §3.1, §6.3 rule 9).
import { resolveAccount } from '@minhaj/database';

export function hostedSession(id: string): string {
  return resolveAccount(id);
}
