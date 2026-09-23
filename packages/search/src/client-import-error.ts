/**
 * The `browser` export condition of `@minhaj/search` resolves here.
 *
 * The search foundation reaches the index and every owner's projection source,
 * and holds the rate limiter. None of that may ever be bundled for a visitor: a
 * browser reaches search only through the public `/search` route, which renders
 * on the server.
 *
 * The throw is evaluated at module scope, so a bundler resolving the browser
 * condition fails the build immediately rather than shipping server code.
 * Lint is the second, independent gate.
 */

throw new Error(
  "'@minhaj/search' is server-only and cannot be imported into a client " +
    'bundle. Reach search through the public /search route.',
);
