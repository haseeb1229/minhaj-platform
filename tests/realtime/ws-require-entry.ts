import { registerHooks } from 'node:module';

/**
 * Test-runner correction: load the `ws` entry Node itself would load.
 *
 * Vitest forwards its SSR resolve conditions to the worker as Node
 * `--conditions` flags, and the repository's list includes `import`
 * (vitest.config.ts). For an ESM `import` that changes nothing, but it also
 * applies to CommonJS `require`: Engine.IO's `require("ws")` then matches the
 * `import` branch of ws's export map and receives the ESM wrapper's namespace,
 * which has no `Server`, so `new Server()` fails with "wsEngine is not a
 * constructor". Under plain Node (`--conditions=react-server`, the realtime
 * process's real start command) `require("ws")` selects ws's CommonJS entry.
 *
 * This hook restores exactly that for `ws` and nothing else: a `require` of
 * `ws` is resolved without the forwarded `import` condition. It changes which
 * FILE of the same package version is loaded, not what the transport does.
 * Imported first by the transport test, before Socket.IO is loaded.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'ws' && context.conditions.includes('require')) {
      return nextResolve(specifier, {
        ...context,
        conditions: context.conditions.filter((condition) => condition !== 'import'),
      });
    }
    return nextResolve(specifier, context);
  },
});
