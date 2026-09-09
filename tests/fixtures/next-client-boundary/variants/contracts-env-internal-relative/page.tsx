'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// The server environment IMPLEMENTATION reached by RELATIVE SOURCE PATH,
// bypassing package resolution entirely.
import { parseServerEnv } from '../../../../../../packages/contracts/src/env/server-schema';

export default function ContractsEnvInternalRelativePage() {
  return <button onClick={() => parseServerEnv({})}>env internal relative</button>;
}
