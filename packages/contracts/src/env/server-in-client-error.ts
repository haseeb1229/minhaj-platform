/**
 * The `browser` export condition of the server-only environment subpaths
 * resolves here.
 *
 * Server environment parsing reads `process.env` and, in later phases, will
 * describe secrets. A client bundle must never reach it
 * (SECURITY_BASELINE.md §18.1). The throw is evaluated at module scope, so a
 * bundler resolving the browser condition fails immediately rather than
 * shipping server configuration to a visitor.
 *
 * No browser environment variable is currently required. A public variable is
 * introduced only when browser code has a real consumer for it.
 */

throw new Error(
  'This environment module is server-only and cannot be imported into a client ' +
    'bundle (SECURITY_BASELINE.md §18.1).',
);

export {};
