'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// The same server environment implementation reached by RELATIVE SOURCE PATH,
// sidestepping the guarded subpath. The in-module marker is the guarantee.
import { parseServerEnv } from '../../../../../../packages/contracts/src/env/server';

export default function ContractsEnvRelativePage() {
  return <button onClick={() => parseServerEnv({})}>env relative</button>;
}
