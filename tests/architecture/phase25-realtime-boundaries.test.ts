import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  validateFixtureWorkspace,
  type ArchitectureViolation,
} from './architecture-harness.ts';

/**
 * Phase 25 — the realtime transport is a TRANSPORT (DELIVERY_PLAN.md Phase 25;
 * ARCHITECTURE.md §3.1 rule 1, §3.1.2, §3.3).
 *
 * THE SEAM BEING PROVEN. `apps/realtime` holds Socket.IO and the event
 * handlers and nothing that persists. The realtime PROCESS still has to wire
 * Identity's and Messaging's ports to their context-owned adapters, and that is
 * Layer 4's job — so it has a Layer-4 composition root in the composition
 * workspace that hands the transport two narrow, already-composed services.
 *
 * Both halves are proven against fixtures, because "a violation occurred"
 * would also be satisfied by a typo:
 *
 *   - `model-a/` gains the Phase-25 shape — a composition root wiring the adapter
 *     and handing the realtime gateway the composed service — and must still
 *     produce ZERO violations;
 *   - `raw-capability/` gains every remaining way the transport could reach the
 *     database: by package name, through Prisma, through the TDS driver, and
 *     through the web process's own composition. Each asserts its own rule.
 */

const MODEL_A = 'tests/fixtures/model-a';
const RAW = 'tests/fixtures/raw-capability';

function rulesFor(
  violations: readonly ArchitectureViolation[],
  suffix: string,
): string[] {
  return violations
    .filter((violation) => violation.file.endsWith(suffix))
    .map((violation) => violation.rule);
}

describe('the approved realtime process composition passes', () => {
  it('accepts a Layer-4 root wiring the adapter and handing the transport a composed service', async () => {
    const violations = await validateFixtureWorkspace(MODEL_A);
    expect(rulesFor(violations, 'web/src/app/realtime-root.ts')).toEqual([]);
    expect(rulesFor(violations, 'realtime/src/gateway.ts')).toEqual([]);
    expect(violations).toEqual([]);
  });
});

describe('apps/realtime never reaches the database, by any route', () => {
  it('rejects the database package named directly', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    expect(rulesFor(violations, 'realtime/src/direct-database-package.ts')).toContain(
      'realtime-database-access',
    );
  });

  it('rejects Prisma imported by the transport', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    expect(rulesFor(violations, 'realtime/src/direct-prisma.ts')).toContain(
      'realtime-database-access',
    );
  });

  it('rejects the TDS driver beneath the MSSQL client', async () => {
    const violations = await validateFixtureWorkspace(RAW);
    expect(rulesFor(violations, 'realtime/src/direct-tedious.ts')).toContain(
      'realtime-raw-database-capability',
    );
  });

  it("rejects reaching the web process's composition, which legitimately wires the adapter", async () => {
    const violations = await validateFixtureWorkspace(RAW);
    expect(rulesFor(violations, 'realtime/src/via-web-composition.ts')).toContain(
      'realtime-laundered-database-access',
    );
  });
});

/* ===========================================================================
 * The production transport, as built
 * ========================================================================= */

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TRANSPORT = 'apps/realtime/src';

async function sourcesIn(relative: string): Promise<string[]> {
  const entries = await readdir(path.join(ROOT, relative), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await sourcesIn(child)));
    else if (/\.tsx?$/u.test(entry.name)) found.push(child);
  }
  return found;
}

const read = (relative: string): Promise<string> =>
  readFile(path.join(ROOT, relative), 'utf8');

function specifiersOf(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/gu),
  ].map((match) => match[1] ?? match[2] ?? '');
}

describe('the production transport is only a transport', () => {
  it('imports nothing but Node, Socket.IO, the contracts and the server-core host', async () => {
    const files = await sourcesIn(TRANSPORT);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = await read(file);
      if (!file.endsWith('client-import-error.ts'))
        expect(source, `${file} carries the server-only marker`).toMatch(
          /^import 'server-only';/mu,
        );
      for (const specifier of specifiersOf(source))
        expect(
          specifier === 'server-only' ||
            specifier === 'socket.io' ||
            specifier.startsWith('node:') ||
            specifier.startsWith('./') ||
            /^@minhaj\/contracts\/(?:messaging|identity|platform)$/u.test(specifier) ||
            /^@minhaj\/server-core\/(?:messaging|logger|session)$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
    }
  });

  it('declares only the transport dependencies, and no realtime scale-out machinery anywhere', async () => {
    const manifest = JSON.parse(await read('apps/realtime/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@minhaj/contracts',
      '@minhaj/server-core',
      'server-only',
      'socket.io',
    ]);
    expect(manifest.devDependencies ?? {}).toEqual({});
    const lock = await read('package-lock.json');
    expect(lock).not.toMatch(
      /"node_modules\/(?:ioredis|redis|@socket\.io\/redis-adapter|@socket\.io\/[a-z-]*adapter|kafkajs)"/u,
    );
  });

  it('accepts WebSocket only, serves no client, sends no CORS headers and caps every frame', async () => {
    const server = await read(`${TRANSPORT}/server.ts`);
    const code = server.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');
    expect(code).toMatch(/transports:\s*\[\s*'websocket'\s*\]/u);
    expect(code).toMatch(/allowUpgrades:\s*false/u);
    expect(code).toMatch(/serveClient:\s*false/u);
    expect(code).toMatch(/maxHttpBufferSize:\s*REALTIME_LIMITS\.maxPayloadBytes/u);
    expect(code).not.toMatch(/\bcors\s*:/u);
    expect(code).not.toMatch(/connectionStateRecovery/u);
  });

  it('is started only by the Layer-4 realtime composition root', async () => {
    const callers: string[] = [];
    for (const root of ['apps/web/src', 'packages']) {
      for (const file of await sourcesIn(root)) {
        if (file.includes('/node_modules/')) continue;
        if (/\bstartRealtimeServer\s*\(/u.test(await read(file))) callers.push(file);
      }
    }
    expect(callers).toEqual(['apps/web/src/composition/realtime-main.ts']);
    const root = await read('apps/web/src/composition/realtime.ts');
    // The root names packages and explicit paths only, so plain Node runs it.
    for (const specifier of specifiersOf(root))
      expect(specifier.startsWith('@/'), `realtime root imports ${specifier}`).toBe(
        false,
      );
  });
});
