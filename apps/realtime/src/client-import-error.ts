/**
 * The `browser` export condition of `@minhaj/realtime` resolves here.
 *
 * `apps/realtime` is the server half of the realtime transport: it holds the
 * session resolver and the Messaging facade the composition root hands it, and
 * must never be imported into a client bundle (ARCHITECTURE.md §3.1, §6.3
 * rule 9). This module is the build-time gate — a bundler resolving the browser
 * condition loads this file, and the throw below is evaluated at module scope,
 * so the import fails immediately rather than shipping server code to a
 * visitor.
 *
 * It is the same mechanism `@minhaj/server-core` uses, and every module behind
 * the other conditions also carries the `server-only` marker: two independent
 * gates, because one of them being misconfigured must not be enough to leak.
 * The browser's half of the protocol is `socket.io-client` and the client-safe
 * vocabulary in `@minhaj/contracts/messaging` — never this package.
 */

throw new Error(
  "'@minhaj/realtime' is server-only and cannot be imported into a client " +
    'bundle (ARCHITECTURE.md §3.1). It is the realtime transport process. A ' +
    "browser connects with 'socket.io-client' and the event vocabulary in " +
    "'@minhaj/contracts/messaging'.",
);

export {};
