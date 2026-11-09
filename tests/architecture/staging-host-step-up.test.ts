import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * The staging HOST-ISSUED step-up (OWNER-DECISION-2026-11-09-STAGING-HOST-
 * STEP-UP) is reachable ONLY from the staging operator composition root.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT: a web request path — a page, a
 * route, a Server Action, the proxy, or a composition root the web process
 * loads — composing Identity's host-issued step-up, which would let a request
 * mint the grant a person is supposed to earn with a password and a second
 * factor. The service refuses outside a declared non-indexable staging
 * deployment, and staging is not indexable, so this is the second wall: the
 * web graph contains neither the staging root nor the session adapter it
 * wires, and nothing in it calls the service's factory.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments removed, string literals kept, so prose cannot match. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1 ');
}

const SKIPPED = new Set(['node_modules', '.next', 'dist', 'generated', 'test-results']);
const CODE = /\.(?:ts|tsx|mts|mjs|js|cjs)$/u;

async function exists(relative: string): Promise<boolean> {
  try {
    await stat(path.join(repoRoot, relative));
    return true;
  } catch {
    return false;
  }
}

async function sources(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const found: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  })) {
    if (SKIPPED.has(entry.name)) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await sources(relative)));
    else if (CODE.test(entry.name)) found.push(relative);
  }
  return found;
}

/** Every import specifier, static or dynamic. */
function imports(source: string): string[] {
  const body = withoutComments(source);
  return [
    ...body.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gu),
    ...body.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...body.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gmu),
  ].map((match) => match[1]!);
}

const WEB = 'apps/web/src';
const RUNNER = `${WEB}/composition/staging-step-up-runner.ts`;
const SERVICE = `${WEB}/contexts/identity-access/application/host-step-up-service.ts`;
const IDENTITY_BARREL = `${WEB}/contexts/identity-access/index.ts`;
const TOOL = 'scripts/identity/host-step-up.ts';
const ADAPTER = 'packages/database/src/adapters/identity-access/host-step-up-sessions.ts';
const ADAPTER_BARREL = 'packages/database/src/adapters/identity-access/index.ts';
const DATABASE_BARREL = 'packages/database/src/index.ts';

/** A web-workspace file a specifier names, or `null` when it leaves the workspace. */
async function resolveWeb(from: string, specifier: string): Promise<string | null> {
  let base: string;
  if (specifier.startsWith('@/')) base = `${WEB}/${specifier.slice(2)}`;
  else if (specifier.startsWith('.'))
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  else return null;
  if (!base.startsWith(`${WEB}/`)) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ])
    if (CODE.test(candidate) && (await exists(candidate))) return candidate;
  return null;
}

/**
 * Every file the web process can load: the App Router tree, the proxy and the
 * instrumentation hook, and everything they import inside the workspace.
 */
async function webGraph(): Promise<Set<string>> {
  const queue = [
    ...(await sources(`${WEB}/app`)),
    `${WEB}/proxy.ts`,
    `${WEB}/instrumentation.ts`,
  ];
  const reached = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    for (const specifier of imports(await read(file))) {
      const target = await resolveWeb(file, specifier);
      if (target !== null) queue.push(target);
    }
  }
  return reached;
}

/** Every first-party source file, outside tests. */
async function allSources(): Promise<string[]> {
  return [
    ...(await sources('apps')),
    ...(await sources('packages')),
    ...(await sources('scripts')),
  ];
}

/** The files whose CODE (not prose) names `identifier`. */
async function naming(identifier: string): Promise<string[]> {
  const pattern = new RegExp(`\\b${identifier}\\b`, 'u');
  const found: string[] = [];
  for (const file of await allSources())
    if (pattern.test(withoutComments(await read(file)))) found.push(file);
  return found.sort();
}

describe('the staging host-issued step-up is reachable only from the staging operator root', () => {
  it('is never composed or called anywhere in the web process’s import graph', async () => {
    const graph = await webGraph();
    // The graph is real: it reaches the ordinary authorisation composition.
    expect(graph.has(`${WEB}/composition/authorization.ts`)).toBe(true);
    expect(graph.has(RUNNER), 'the web process loads the staging step-up root').toBe(
      false,
    );
    // Identity's public interface is ONE barrel (ARCHITECTURE.md §6.3 rule 4),
    // so the service's module is in the graph as a re-export. What must never
    // be there is a CALL — the only way to obtain the capability — or the
    // adapter or root that supply it.
    for (const file of graph) {
      const code = withoutComments(await read(file));
      expect(code, `${file} composes the host step-up`).not.toMatch(
        /(?<!function )\b(?:createHostStepUpService|createHostStepUpSessions|composeStagingStepUpRunner)\s*\(/u,
      );
      expect(code, `${file} names the host step-up adapter or root`).not.toMatch(
        /\b(?:createHostStepUpSessions|composeStagingStepUpRunner)\b/u,
      );
    }
    // The service module is reached only through the barrel's re-export.
    if (graph.has(SERVICE))
      for (const file of graph)
        if (file !== IDENTITY_BARREL)
          expect(
            imports(await read(file)).some((specifier) =>
              specifier.endsWith('host-step-up-service.ts'),
            ),
            `${file} imports the host step-up service module directly`,
          ).toBe(false);
  });

  it('is composed in exactly one place, and that place is loaded only by the operator tool', async () => {
    expect(await naming('createHostStepUpService')).toEqual(
      [IDENTITY_BARREL, RUNNER, SERVICE].sort(),
    );
    expect(await naming('createHostStepUpSessions')).toEqual(
      [ADAPTER, ADAPTER_BARREL, DATABASE_BARREL, RUNNER].sort(),
    );
    expect(await naming('composeStagingStepUpRunner')).toEqual([RUNNER, TOOL].sort());

    const importers: string[] = [];
    for (const file of await allSources())
      if (
        imports(await read(file)).some((specifier) =>
          specifier.endsWith('staging-step-up-runner.ts'),
        )
      )
        importers.push(file);
    expect(importers).toEqual([TOOL]);
  });

  it('is started only by the owner-side staging command, as an allowlisted runtime tool', async () => {
    const operator = withoutComments(
      await read('packages/database/src/lifecycle/migration-proof-operator.ts'),
    );
    expect(operator).toMatch(
      /HOST_STEP_UP_TOOL_ENTRY = path\.join\(\s*'scripts',\s*'identity',\s*'host-step-up\.ts',?\s*\)/u,
    );
    expect(operator).toMatch(/input\.entry !== HOST_STEP_UP_TOOL_ENTRY &&/u);
    expect(await naming('HOST_STEP_UP_TOOL_ENTRY')).toEqual(
      [
        'packages/database/scripts/staging-step-up.ts',
        'packages/database/src/lifecycle/migration-proof-operator.ts',
      ].sort(),
    );
  });
});

/*
 * The staging HOST REVIEW (Rebaseline R2; the same owner decision) — the
 * review and publication acts of a completed run, performed on the staging
 * host as named administrators — is reachable ONLY from its operator tool,
 * and the tool only from the owner-side staging command. A web request path
 * composing it would let a request act as an account it did not sign in as.
 */
const REVIEW_ROOT = `${WEB}/composition/staging-review-runner.ts`;
const REVIEW_TOOL = 'scripts/review/review-runtime.ts';

describe('the staging host review is reachable only from its operator tool', () => {
  it('is never loaded or composed anywhere in the web process’s import graph', async () => {
    const graph = await webGraph();
    expect(graph.has(`${WEB}/composition/migration.ts`)).toBe(true);
    expect(graph.has(REVIEW_ROOT), 'the web process loads the staging review root').toBe(
      false,
    );
    for (const file of graph) {
      expect(
        withoutComments(await read(file)),
        `${file} names the staging review root`,
      ).not.toMatch(/\bcomposeStagingReviewRunner\b|staging-review-runner/u);
      expect(
        imports(await read(file)).some((specifier) =>
          specifier.includes('scripts/review'),
        ),
        `${file} imports the staging review tool`,
      ).toBe(false);
    }
  });

  it('is composed in one root that only the review tool imports, and that tool only the staging command starts', async () => {
    expect(await naming('composeStagingReviewRunner')).toEqual(
      [REVIEW_ROOT, REVIEW_TOOL].sort(),
    );
    const importers: string[] = [];
    for (const file of await allSources())
      if (
        imports(await read(file)).some((specifier) =>
          specifier.endsWith('staging-review-runner.ts'),
        )
      )
        importers.push(file);
    expect(importers).toEqual([REVIEW_TOOL]);

    const operator = withoutComments(
      await read('packages/database/src/lifecycle/migration-proof-operator.ts'),
    );
    expect(operator).toMatch(
      /MIGRATION_REVIEW_TOOL_ENTRY = path\.join\(\s*'scripts',\s*'review',\s*'review-runtime\.ts',?\s*\)/u,
    );
    expect(operator).toMatch(/input\.entry !== MIGRATION_REVIEW_TOOL_ENTRY &&/u);
    expect(await naming('MIGRATION_REVIEW_TOOL_ENTRY')).toEqual(
      [
        'packages/database/scripts/staging-migration-review.ts',
        'packages/database/src/lifecycle/migration-proof-operator.ts',
      ].sort(),
    );
  });

  it('refuses to be built outside a declared non-indexable staging deployment', async () => {
    const root = withoutComments(await read(REVIEW_ROOT));
    const guard = root.indexOf("env['MINHAJ_DEPLOYMENT_ENVIRONMENT'] !== 'staging'");
    expect(guard).toBeGreaterThan(0);
    expect(root).toContain("env['PUBLIC_INDEXING_ENABLED'] !== 'false'");
    // The refusal comes before anything is composed.
    expect(root.indexOf('composeMigrationRunner(env)')).toBeGreaterThan(guard);
    expect(root.indexOf('createEditorialService(')).toBeGreaterThan(guard);
  });
});
