'use client';

import { useState } from 'react';

/**
 * The giving form's operation id, held for the life of the form in the
 * browser (DELIVERY_PLAN.md Phase 27).
 *
 * WHY STATE AND NOT A PLAIN HIDDEN FIELD. Starting a NEW donation writes the
 * status cookie, and a Server Action that changes a cookie makes the
 * framework re-render the page — which would hand the form a fresh id. A
 * donor whose first submission met a provider outage would then retry as a
 * SECOND donation, beside the first one still being reconciled. Kept here, the
 * id the page first rendered survives that re-render and the form's reset, so
 * a retry, a double submit or a resubmission reaches the same donation; only a
 * newly loaded page is a new attempt. It is an opaque idempotency key, never
 * authority: the server checks every request against what that id recorded.
 */
export function OperationIdField({ initial }: { readonly initial: string }) {
  const [operationId] = useState(initial);
  return <input type="hidden" name="operationId" defaultValue={operationId} />;
}
