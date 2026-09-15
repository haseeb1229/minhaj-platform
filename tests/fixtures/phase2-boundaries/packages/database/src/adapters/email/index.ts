// PROHIBITED: a LAYER-0 adapter reaching up into a bounded context.
//
// Infrastructure "owns no business invariants" (DOMAIN_MODEL.md §1.1, §2 rule
// 7). The moment the shared email concern depends on Identity, it HAS one —
// and the concern that was supposed to serve every context has become one
// context's property. A context that needs this concern to know something
// passes it in.
import { describeAccount } from '../../../../../apps/app/src/contexts/identity-access/index.ts';

export function deliverSomething(id: string): string {
  return describeAccount(id);
}
