'use client';

// The Client Component that imports the action above. Its CLIENT-BUNDLE
// verdict is clean — no `server-only-in-client-graph` — because the action's
// implementation is not bundled for the browser. Every OTHER rule still sees
// the dependency: the action's own `context-internal-import` is reported
// against the action, and the ordinary composition reach is reported here.
// That is §7.2 exactly — the directive decides what ships to the browser and
// nothing else.
import { publish } from '@/contexts/messaging/publish-action';

export function Publisher(): string {
  return typeof publish;
}
