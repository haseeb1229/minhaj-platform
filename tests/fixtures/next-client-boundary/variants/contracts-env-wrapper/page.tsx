'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// Client -> local wrapper -> server environment. Laundering the import through
// an intermediate module must not launder the boundary.
import { parseServerEnv } from '@/shared/env-wrapper';

export default function ContractsEnvWrapperPage() {
  return <button onClick={() => parseServerEnv({})}>env wrapper</button>;
}
