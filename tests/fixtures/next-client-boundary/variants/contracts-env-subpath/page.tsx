'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
// Server environment parsing reached through its declared package subpath.
import { parseServerEnv } from '@minhaj/contracts/env/server';

export default function ContractsEnvSubpathPage() {
  return <button onClick={() => parseServerEnv({})}>env subpath</button>;
}
