// The server environment entry point, and the ONLY publicly exported route to
// server environment parsing.
//
// It is intrinsically server-only: it is the module application code imports to
// read `process.env`, and in later phases that environment will describe
// secrets. The `browser` export condition on this subpath is defence in depth;
// the `server-only` MARKER is the guarantee, because it holds however the
// module is reached — package subpath, relative source path, or tsconfig alias
// (SECURITY_BASELINE.md §18.1).
//
// The schema and parser live in `./server-schema.ts`, which carries the same
// marker and which the package `exports` map does not name. Review #3 built a
// Client Component against `@minhaj/contracts/env/schema` — a PUBLIC,
// marker-free subpath — and the build SUCCEEDED. That subpath is removed, and
// the implementation behind it is now marked, so neither half of that defect
// remains.
//
// The production start wrapper (`apps/web/scripts/start.mjs`) runs itself under
// `--conditions=react-server`, so it imports THIS module like any other server
// consumer. There is exactly one schema definition and no unguarded route to
// it.
import 'server-only';

export { parseServerEnv, serverEnvKeys, serverEnvSchema } from './server-schema.ts';
export type { ServerEnv } from './server-schema.ts';
