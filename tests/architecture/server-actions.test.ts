import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  hasUseClientDirective,
  hasUseServerDirective,
  isServerActionBoundary,
  moduleDirectives,
} from '../../scripts/architecture/parser.mjs';
import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * F3 — the Server Action boundary.
 *
 * The client-graph rule protects Client Components from server-only
 * implementation code, and it must keep doing so. But a genuine Next.js Server
 * Action is NOT ordinary client-bundle reachability: the framework replaces a
 * Client Component's import of a `'use server'` module with a callable
 * reference, and the implementation behind it — a context service, a
 * `server-core`-hosted service, a persistence adapter — stays on the server.
 *
 * ARCHITECTURE.md §7 makes Server Actions the sanctioned mutation path "for
 * mutations from the platform's own UI", so a checker that reported one as a
 * client leak would report the architecture itself as a violation.
 *
 * The danger in fixing that is obvious and is what most of this file is about:
 * `'use server'` must not become a general laundering marker. A marker anyone
 * can type is worth nothing, so the directive is read from the REAL module
 * prologue — the same place the framework reads it — and every shape that does
 * NOT create a boundary must still fail.
 */

const FIXTURE = 'tests/fixtures/server-actions';

function clientLeaks(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): ArchitectureViolation[] {
  return violations.filter(
    (violation) =>
      violation.file.endsWith(suffix) && violation.rule === 'server-only-in-client-graph',
  );
}

describe('F3 — a valid Server Action is not a client leak', () => {
  it('PERMITS a Client Component calling a Server Action that uses server-only code', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(clientLeaks(violations, 'client/valid-client.tsx')).toEqual([]);
  });

  it('reports nothing at all against that Client Component', async () => {
    // Not merely "no client leak" — no finding of any kind. The sanctioned
    // mutation path must be usable without argument.
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(violations.filter((v) => v.file.endsWith('valid-client.tsx'))).toEqual([]);
  });

  it('still treats the action module itself as reachable server source', async () => {
    // The stop applies to the CLIENT BUNDLE. The action module is not removed
    // from the graph, and it is not excused from anything (§7.2 below).
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(violations.filter((v) => v.file.endsWith('send-message.ts'))).toEqual([]);
  });
});

describe('F3 — every shape that is NOT a boundary still fails', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['an ordinary wrapper re-exporting server-only code', 'client/leaking-client.tsx'],
    [
      'a directive that is only a comment and a string constant',
      'client/commented-client.tsx',
    ],
    [
      'a directive placed after another statement, outside the prologue',
      'client/misplaced-client.tsx',
    ],
    [
      'a directive inside a function body rather than at module level',
      'client/function-level-client.tsx',
    ],
    [
      'a client-reachable ordinary barrel that also re-exports a valid action',
      'client/barrel-client.tsx',
    ],
    [
      "a 'use server' module exporting a non-function value",
      'client/invalid-value-client.tsx',
    ],
    [
      "a 'use server' module exporting a synchronous function",
      'client/invalid-sync-client.tsx',
    ],
    [
      "a 'use server' module with an unverifiable star re-export",
      'client/invalid-reexport-client.tsx',
    ],
  ];

  for (const [description, fixture] of cases) {
    it(`rejects ${description}`, async () => {
      const violations = await validateFixtureWorkspace(FIXTURE);
      const found = clientLeaks(violations, fixture);

      expect(found.length, `${fixture} must still report a client leak`).toBeGreaterThan(
        0,
      );
      expect(found[0]?.message).toContain('server-only');
    });
  }

  it('names the server-only module rather than the intermediate', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(clientLeaks(violations, 'client/leaking-client.tsx')[0]?.specifier).toContain(
      'packages/server-core/src',
    );
  });
});

describe('§7.2 — a Server Action is exempt from nothing but client bundling', () => {
  it('still applies context rules to a valid action module', async () => {
    // `contexts/messaging/publish-action.ts` carries a real `'use server'`
    // directive AND reaches Learning's internals. The directive decides what
    // ships to the browser; it decides nothing about what a bounded context may
    // depend on.
    const violations = await validateFixtureWorkspace(FIXTURE);
    const found = violations.filter((v) => v.file.endsWith('publish-action.ts'));

    expect(found.map((violation) => violation.rule)).toContain('context-internal-import');
  });

  it('gives the Client Component that calls it a clean CLIENT-BUNDLE verdict', async () => {
    const violations = await validateFixtureWorkspace(FIXTURE);

    expect(clientLeaks(violations, 'action-still-governed-client.tsx')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The directive itself — read where the framework reads it
// ---------------------------------------------------------------------------

/**
 * Parses one throwaway module and reports its module-level directives.
 *
 * Written to a real temporary file because the parser reads from disk, exactly
 * as the graph builder does. Testing a different code path would prove nothing
 * about the one that runs.
 */
async function directivesOf(source: string): Promise<Set<string>> {
  const directory = await mkdtemp(path.join(tmpdir(), 'minhaj-directive-'));
  const file = path.join(directory, 'module.ts');

  try {
    await writeFile(file, source, 'utf8');
    return moduleDirectives(file) as Set<string>;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function isServerAction(source: string): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), 'minhaj-directive-'));
  const file = path.join(directory, 'module.ts');

  try {
    await writeFile(file, source, 'utf8');
    return hasUseServerDirective(file) as boolean;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function isValidServerActionBoundary(source: string): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), 'minhaj-directive-'));
  const file = path.join(directory, 'module.ts');

  try {
    await writeFile(file, source, 'utf8');
    return isServerActionBoundary(file) as boolean;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('F3 — the directive is a prologue fact, not a text match', () => {
  it('recognises a real module-level directive', async () => {
    expect(await isServerAction("'use server';\nexport const a = 1;\n")).toBe(true);
    expect(await isServerAction('"use server";\nexport const a = 1;\n')).toBe(true);
  });

  it('recognises it after other directives in the same prologue', async () => {
    expect(
      await isServerAction("'use strict';\n'use server';\nexport const a = 1;\n"),
    ).toBe(true);
  });

  it('does NOT recognise it in a comment', async () => {
    expect(await isServerAction("// 'use server'\nexport const a = 1;\n")).toBe(false);
    expect(await isServerAction("/* 'use server' */\nexport const a = 1;\n")).toBe(false);
  });

  it('does NOT recognise it as an ordinary string value', async () => {
    expect(
      await isServerAction("const marker = 'use server';\nexport const a = 1;\n"),
    ).toBe(false);
  });

  it('does NOT recognise it after a statement, where the prologue has ended', async () => {
    expect(
      await isServerAction("const x = 1;\n'use server';\nexport const a = x;\n"),
    ).toBe(false);
  });

  it('does NOT recognise it after an import, where the prologue has ended', async () => {
    expect(
      await isServerAction("import x from 'y';\n'use server';\nexport const a = x;\n"),
    ).toBe(false);
  });

  it('does NOT recognise a function-level directive as a module boundary', async () => {
    // In Next.js an inline `'use server'` marks that FUNCTION. It does not make
    // the module a Server Action boundary, so a Client Component importing the
    // module still bundles the module.
    expect(
      await isServerAction("export function act() {\n  'use server';\n  return 1;\n}\n"),
    ).toBe(false);
  });

  it('reads both directives from the one prologue, and keeps them distinct', async () => {
    const client = await directivesOf("'use client';\nexport const a = 1;\n");
    const server = await directivesOf("'use server';\nexport const a = 1;\n");

    expect(client.has('use client')).toBe(true);
    expect(client.has('use server')).toBe(false);
    expect(server.has('use server')).toBe(true);
    expect(server.has('use client')).toBe(false);
  });

  it('leaves the existing use-client detection behaving exactly as before', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'minhaj-directive-'));
    const file = path.join(directory, 'module.tsx');

    try {
      await writeFile(file, "'use client';\nexport const a = 1;\n", 'utf8');
      expect(hasUseClientDirective(file)).toBe(true);

      await writeFile(file, "// 'use client'\nexport const a = 1;\n", 'utf8');
      expect(hasUseClientDirective(file)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('F3 — a directive alone does not create a Server Action boundary', () => {
  it('accepts direct async function declarations and async arrow values', async () => {
    expect(
      await isValidServerActionBoundary(
        "'use server';\nexport async function a() {}\nexport const b = async () => {};\n",
      ),
    ).toBe(true);
  });

  it('accepts local named exports of an async function', async () => {
    expect(
      await isValidServerActionBoundary(
        "'use server';\nasync function action() {}\nexport { action };\n",
      ),
    ).toBe(true);
  });

  it.each([
    ['a non-function value', "'use server';\nexport const value = 1;\n"],
    ['a synchronous function', "'use server';\nexport function action() {}\n"],
    ['an empty marker module', "'use server';\nimport 'server-only';\n"],
    [
      'conflicting client and server directives',
      "'use client';\n'use server';\nexport async function action() {}\n",
    ],
    ['a star re-export', "'use server';\nexport * from './actions';\n"],
    [
      'a named external re-export',
      "'use server';\nexport { action } from './actions';\n",
    ],
  ])('rejects %s', async (_description, source) => {
    expect(await isValidServerActionBoundary(source)).toBe(false);
  });
});
