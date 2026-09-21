/**
 * The `browser` export condition of `@minhaj/storage` resolves here.
 *
 * The storage foundation reads and writes the server's filesystem, holds the
 * storage root and talks to the malware scanner. None of that may ever be
 * bundled for a visitor, and an asset is reached from a browser only through
 * the authorisation-checking serving route.
 *
 * The throw is evaluated at module scope, so a bundler resolving the browser
 * condition fails the build immediately rather than shipping server code.
 * Lint is the second, independent gate.
 */

throw new Error(
  "'@minhaj/storage' is server-only and cannot be imported into a client " +
    'bundle. Reach an asset through the serving route, which applies the ' +
    'default-deny authorisation decision.',
);
