/**
 * The `browser` export condition of `@minhaj/contracts/env/server` resolves
 * here.
 *
 * Server environment parsing reads `process.env` and, in later phases, will
 * describe secrets. A client bundle must never reach it
 * (SECURITY_BASELINE.md §18.1). The throw is evaluated at module scope, so a
 * bundler resolving the browser condition fails immediately rather than
 * shipping server configuration to a visitor.
 *
 * Client configuration has its own schema, deliberately separate:
 *
 *     import { parseClientEnv } from '@minhaj/contracts/env/client';
 */

throw new Error(
  "'@minhaj/contracts/env/server' is server-only and cannot be imported into " +
    'a client bundle (SECURITY_BASELINE.md §18.1). Public configuration lives ' +
    "in '@minhaj/contracts/env/client'; every variable there is NEXT_PUBLIC_ " +
    'and understood to be disclosed to every visitor.',
);

export {};
