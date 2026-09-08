'use client';

// FIXTURE VARIANT — MUST FAIL THE NEXT BUILD.
//
// THE EXACT REVIEW #3 BYPASS. This built cleanly into a browser bundle:
// `@minhaj/contracts/env/schema` was a public subpath exporting a marker-free
// `parseServerEnv` that reads `process.env`.
//
// The subpath is removed. The schema and parser now live at
// `src/internal/env/server-schema.ts`, which the `exports` map does not name,
// so this specifier resolves to nothing at all. The one supported route,
// `@minhaj/contracts/env/server`, carries `import 'server-only'`.
import { parseServerEnv } from '@minhaj/contracts/env/schema';

export default function ContractsEnvSchemaPage() {
  return <button onClick={() => parseServerEnv({})}>env schema</button>;
}
