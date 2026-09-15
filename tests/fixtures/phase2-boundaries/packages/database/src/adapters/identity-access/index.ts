/** A context-owned adapter. It may reach its OWN context's public interface. */
import { describeAccount } from '../../../../../apps/app/src/contexts/identity-access/index.ts';

export function resolveAccount(id: string): string {
  return describeAccount(id);
}
