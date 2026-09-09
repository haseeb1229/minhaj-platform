#!/usr/bin/env node
/**
 * Build-level proof of the server-only boundary (ARCHITECTURE.md §3.1, §6.3
 * rule 9).
 *
 * A Vitest import assertion is NOT proof: it exercises Node resolution, not the
 * Next.js bundler that actually decides what reaches a browser. This script
 * runs a REAL `next build` against an isolated fixture app, once per violating
 * variant, and asserts:
 *
 *   - each Client Component route that reaches `@minhaj/server-core` FAILS
 *   - a Server Component using the same package still BUILDS
 *
 * The second half matters as much as the first: a rule that also broke
 * legitimate server usage would be a wrong rule, not a strict one.
 *
 * The fixture lives in `tests/fixtures/next-client-boundary/` and is outside
 * the workspace, so it never ships and never enters production source.
 */

import { execFile } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'next-client-boundary');
const appDirectory = path.join(fixtureRoot, 'src', 'app');

/**
 * Each violating route, with the bypass it represents. The route directory is
 * moved out of `src/app` for every build except its own, so one build proves
 * exactly one variant and a failure is never ambiguous.
 */
const VARIANTS = [
  // ---- database --------------------------------------------------------
  { route: 'database-direct', description: 'Client Component imports database directly' },
  {
    route: 'database-dynamic',
    description: 'Client Component reaches database via dynamic import()',
  },
  {
    route: 'database-wrapper',
    description: 'Client Component reaches database through a re-export wrapper',
  },
  {
    route: 'database-relative-source',
    description: 'Client Component reaches database by RELATIVE SOURCE PATH',
  },
  {
    route: 'database-alias-source',
    description: 'Client Component reaches database through a REAL tsconfig alias',
  },
  {
    route: 'database-subpath',
    description: 'Client Component imports an unexported database package subpath',
    expect: 'removed-subpath',
  },

  // ---- server-core -----------------------------------------------------
  { route: 'direct', description: 'Client Component imports server-core directly' },
  { route: 'dynamic', description: 'Client Component reaches it via dynamic import()' },
  {
    route: 'wrapper',
    description: 'Client Component reaches it via a re-export wrapper',
  },
  { route: 'subpath', description: 'Client Component reaches it via the subpath export' },
  {
    route: 'relative-source',
    description: 'Client Component reaches server-core by RELATIVE SOURCE PATH',
  },
  {
    route: 'alias-source',
    description:
      'Client Component reaches INTERNAL server-core source through a REAL ' +
      'tsconfig path alias (~server/*)',
  },
  {
    route: 'shared-wrapper',
    description: 'Client Component reaches it through a shared wrapper module',
  },

  // ---- contracts server environment ------------------------------------
  {
    route: 'contracts-env-subpath',
    description: 'Client Component reaches contracts server env via its package subpath',
  },
  {
    route: 'contracts-env-relative',
    description: 'Client Component reaches contracts server env by RELATIVE SOURCE PATH',
  },
  {
    route: 'contracts-env-wrapper',
    description: 'Client Component reaches contracts server env through a wrapper',
  },
  {
    route: 'contracts-env-alias',
    description:
      'Client Component reaches the server env IMPLEMENTATION through a REAL ' +
      'tsconfig path alias (~contracts/*)',
  },
  {
    route: 'contracts-env-internal-relative',
    description:
      'Client Component reaches the server env IMPLEMENTATION by RELATIVE SOURCE PATH',
  },
  {
    // The exact Review #3 bypass. `@minhaj/contracts/env/schema` was a public,
    // marker-free subpath exporting `parseServerEnv`, and this build SUCCEEDED.
    // The subpath is removed, so the specifier must now resolve to nothing —
    // which is a different failure mode from the boundary errors above and is
    // asserted separately.
    route: 'contracts-env-schema',
    description:
      'REVIEW #3 BYPASS — Client Component imports @minhaj/contracts/env/schema',
    expect: 'removed-subpath',
  },
  {
    route: 'invalid-server-action',
    description: "Client imports a 'use server' module with a non-function export",
    expect: 'invalid-server-action',
  },
];

/**
 * Variants live permanently in `variants/`, OUTSIDE `src/app`, so the fixture
 * has one stable committed state. A variant is copied into the routable app
 * directory for its own build and removed afterwards — one build proves exactly
 * one bypass, and a failure is never ambiguous about which.
 */
const VARIANTS_SOURCE = path.join(fixtureRoot, 'variants');

/** Copies one variant into the app directory. */
async function activate(route) {
  const to = path.join(appDirectory, route);
  await cp(path.join(VARIANTS_SOURCE, route), to, { recursive: true });
}

async function deactivate(route) {
  await rm(path.join(appDirectory, route), { recursive: true, force: true });
}

/** Guarantees no variant is left behind by an interrupted earlier run. */
async function clearAllVariants() {
  for (const { route } of VARIANTS) await deactivate(route);
}

/** Runs `next build` in the fixture. Returns { ok, output }. */
async function buildFixture() {
  await rm(path.join(fixtureRoot, '.next'), { recursive: true, force: true });
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
      {
        cwd: fixtureRoot,
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 300_000,
      },
    );
    return { ok: true, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const stdout = error.stdout ?? '';
    const stderr = error.stderr ?? '';
    return { ok: false, output: `${stdout}\n${stderr}\n${error.message ?? ''}` };
  }
}

/**
 * Did the build fail specifically because of the SERVER/CLIENT boundary?
 *
 * Asserting only "the build failed" would pass for a BROKEN fixture — a typo, a
 * missing module, a bad tsconfig — and prove nothing about enforcement. This
 * matches the boundary diagnostics Next emits and, just as importantly, rejects
 * the common fixture-configuration failures, so a broken fixture cannot
 * masquerade as a successful rejection.
 */
function failedForServerOnlyReason(output) {
  const boundary =
    /cannot be imported from a Client Component|only be used from a Server Component|server-only/i.test(
      output,
    );

  // A fixture that fails to resolve or type-check is not proof of anything.
  const fixtureBroken =
    /Cannot find module|Module not found|Failed to type check|SyntaxError/i.test(
      output,
    ) && !/server-only/i.test(output);

  return boundary && !fixtureBroken;
}

/**
 * Did the build fail because the specifier NO LONGER EXISTS?
 *
 * The remedy for the Review #3 bypass was to delete the public subpath, not to
 * add a marker to it. So the correct failure for that variant is a resolution
 * failure naming that specifier — and asserting it specifically is what stops
 * the fixture from "passing" because of some unrelated breakage.
 */
function failedForRemovedSubpath(output, specifier) {
  const unresolved =
    /Cannot find module|Module not found|Failed to resolve|has no exported member|is not exported from/i.test(
      output,
    );

  return unresolved && output.includes(specifier);
}

/** Did Next reject a trivially invalid module-level Server Action surface? */
function failedForInvalidServerAction(output) {
  return /only async functions.*use server|use server.*only.*async functions|invalid-use-server-value/i.test(
    output,
  );
}

/** The specifier each `removed-subpath` variant must fail to resolve. */
const REMOVED_SUBPATHS = Object.freeze({
  'database-subpath': '@minhaj/database/config',
  'contracts-env-schema': '@minhaj/contracts/env/schema',
});

export async function proveServerOnlyBoundary({ log = console.log } = {}) {
  const results = [];
  await clearAllVariants();

  // ---- Control: legitimate server usage still builds ---------------------
  //
  // Three routes, all of which MUST compile:
  //   - a Server Component using `@minhaj/server-core` and `@minhaj/database`
  //   - a Client Component using the BROWSER-SAFE contracts root
  //   - a Client Component calling a real module-level Server Action whose
  //     implementation reaches server-only code (ARCHITECTURE.md §7)
  //
  // The third is the half of the Server Action rule no Vitest assertion can
  // establish. The architecture analyser stops its client-bundle walk at a
  // `'use server'` boundary on the grounds that Next keeps the implementation
  // on the server; this build is what proves Next actually does, rather than
  // leaving the analyser to model a framework that does not exist.
  log(
    '\n[control] Server Component using @minhaj/server-core, a Client ' +
      'Component using the BROWSER-SAFE contracts root, and a Client ' +
      'Component calling a real Server Action — expect BUILD OK',
  );
  const control = await buildFixture();
  results.push({
    name: 'control (server component + browser-safe client + Server Action)',
    expected: 'build succeeds',
    passed: control.ok,
    output: control.output,
  });
  log(
    control.ok ? '  PASS — builds, as it must' : '  FAIL — legitimate server usage broke',
  );

  // ---- Each violating variant -------------------------------------------
  for (const { route, description, expect } of VARIANTS) {
    log(`\n[${route}] ${description} — expect BUILD FAILURE`);
    await activate(route);
    const result = await buildFixture();
    await deactivate(route);

    const removedSubpath = expect === 'removed-subpath';
    const invalidServerAction = expect === 'invalid-server-action';
    const specifier = REMOVED_SUBPATHS[route] ?? '';

    const passed =
      !result.ok &&
      (invalidServerAction
        ? failedForInvalidServerAction(result.output)
        : removedSubpath
          ? failedForRemovedSubpath(result.output, specifier)
          : failedForServerOnlyReason(result.output));

    results.push({
      name: route,
      expected: invalidServerAction
        ? "build fails because a 'use server' file exports a non-async value"
        : removedSubpath
          ? `build fails because '${specifier}' no longer exists`
          : 'build fails with a server/client boundary error',
      passed,
      output: result.output,
    });

    if (passed) {
      log('  PASS — build rejected the client-side reach');
    } else if (result.ok) {
      log('  FAIL — the build SUCCEEDED; server code could reach the browser');
    } else {
      log(
        '  FAIL — build failed, but NOT because of the server/client boundary ' +
          '(a broken fixture proves nothing)',
      );
    }
  }

  await clearAllVariants();
  await rm(path.join(fixtureRoot, '.next'), { recursive: true, force: true });
  return results;
}

function isMain() {
  const invoked = process.argv[1];
  return (
    invoked !== undefined &&
    path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url))
  );
}

if (isMain()) {
  const results = await proveServerOnlyBoundary();
  const failed = results.filter((result) => !result.passed);

  console.log('\n' + '='.repeat(70));
  for (const result of results) {
    console.log(
      `  ${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.expected}`,
    );
  }

  if (failed.length > 0) {
    console.error(`\nServer-only boundary NOT proven: ${failed.length} case(s) failed.`);
    for (const result of failed) {
      console.error(`\n--- ${result.name} output ---\n${result.output.slice(0, 2000)}`);
    }
    process.exit(1);
  }

  console.log('\nServer-only boundary proven by real Next builds.');
}
