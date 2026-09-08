/**
 * The `browser` export condition of `@minhaj/server-core` resolves here.
 *
 * ARCHITECTURE.md §3.1 and §6.3 rule 9: `packages/server-core` is server-only
 * and must never be imported into a client bundle. This module is the build-time
 * gate — a bundler resolving the browser condition loads this file, and the
 * throw below is evaluated at module scope, so the import fails immediately
 * rather than shipping server code to a visitor.
 *
 * This is the same mechanism the `server-only` package uses, implemented with
 * the export conditions already available in the locked stack rather than by
 * adding a dependency.
 *
 * Lint is the other gate: `no-restricted-imports` rejects the import in any
 * client-bundle file before a build is ever attempted. Two independent gates,
 * because one of them being misconfigured must not be enough to leak.
 */

throw new Error(
  "'@minhaj/server-core' is server-only and cannot be imported into a client " +
    'bundle (ARCHITECTURE.md §3.1). It hosts context-owned server services. ' +
    'Call it from a Server Component, Server Action or Route Handler and pass ' +
    'the result down as props.',
);

export {};
