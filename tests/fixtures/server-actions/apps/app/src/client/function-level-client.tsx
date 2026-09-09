'use client';

// FIXTURE — MUST FAIL. The target's directive is inside a function body. That
// marks the function, not the module, so importing the module bundles the
// module — server-only imports included.
import { inlineAction } from '@/actions/function-level-directive';

export function InlineDirective(): string {
  return typeof inlineAction;
}
