import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
// @ts-expect-error — the enforcement scripts are plain ESM, deliberately not
// part of a TypeScript project. The test consumes them exactly as the gate does.
import {
  deferredStack,
  evaluateVersionPolicy,
  isDeferred,
  lockedNode,
  lockedStack,
  policyFor,
  specifierViolation,
  versionSatisfies,
} from '../../scripts/shared/version-policy.mjs';

/**
 * F13 — the version policy must be provable from COMMITTED SOURCE.
 *
 * The previous checker resolved packages out of `node_modules`, which is not
 * repository state — it is whatever the last install left behind. Three holes
 * followed, and all three are closed here:
 *
 *   - a workspace could declare an out-of-policy version and pass, because
 *     hoisting meant the resolver found the ROOT copy;
 *   - a manifest and the lockfile could disagree entirely and pass, because
 *     neither file was read;
 *   - the deferred packages — Better Auth, Socket.IO, Playwright — had no
 *     contract at all, so any version could arrive in any phase. (next-intl
 *     was among them until Phase 3A installed it at its owning point; its
 *     contract is now the LOCKED one, where absence fails.)
 *
 * Every case below is a SYNTHETIC manifest and lockfile passed to the engine.
 * No real manifest is mutated to simulate a bad state, nothing is installed,
 * and no test reaches the network.
 */

/* ---------------------------------------------------------------------------
 * A minimal, compliant repository state, and helpers to bend one field of it.
 * ------------------------------------------------------------------------ */

interface Manifest {
  name?: string;
  engines?: Record<string, string>;
  overrides?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function baseRootManifest(): Manifest {
  return {
    name: 'minhaj-platform',
    engines: { node: lockedNode },
    overrides: { 'deepmerge-ts': '8.0.0', mysql2: '3.23.1' },
    devDependencies: {
      '@playwright/test': '1.55.1',
      cheerio: '1.2.0',
      eslint: '^10.9.1',
      prettier: '^3.9.6',
      typescript: '~5.9.3',
      vitest: '~4.1.11',
    },
  };
}

function baseWorkspaces(): { name: string; directory: string; manifest: Manifest }[] {
  return [
    {
      name: '@minhaj/web',
      directory: 'apps/web',
      manifest: {
        dependencies: {
          next: '16.4.2',
          'next-intl': '4.14.3',
          react: '19.2.8',
          'react-dom': '19.2.8',
          'socket.io-client': '4.8.3',
        },
        devDependencies: { tailwindcss: '4.3.3' },
      },
    },
    {
      name: '@minhaj/database',
      directory: 'packages/database',
      manifest: {
        dependencies: {
          '@prisma/adapter-mssql': '7.10.0',
          '@prisma/client': '7.10.0',
          'better-auth': '1.7.7',
          resend: '6.27.0',
          zod: '4.6.7',
        },
        devDependencies: { prisma: '7.10.0' },
      },
    },
    {
      name: '@minhaj/server-core',
      directory: 'packages/server-core',
      manifest: { dependencies: { pino: '10.3.1' } },
    },
    {
      name: '@minhaj/realtime',
      directory: 'apps/realtime',
      manifest: { dependencies: { 'socket.io': '4.8.3' } },
    },
  ];
}

function baseLock(): { packages: Record<string, { version?: string }> } {
  return {
    packages: {
      '': {},
      'node_modules/next': { version: '16.4.2' },
      'node_modules/next-intl': { version: '4.14.3' },
      'node_modules/react': { version: '19.2.8' },
      'node_modules/react-dom': { version: '19.2.8' },
      'node_modules/tailwindcss': { version: '4.3.3' },
      'node_modules/pino': { version: '10.3.1' },
      'node_modules/prisma': { version: '7.10.0' },
      'node_modules/@prisma/client': { version: '7.10.0' },
      'node_modules/@prisma/adapter-mssql': { version: '7.10.0' },
      'node_modules/better-auth': { version: '1.7.7' },
      'node_modules/resend': { version: '6.27.0' },
      'node_modules/@playwright/test': { version: '1.55.1' },
      'node_modules/socket.io': { version: '4.8.3' },
      'node_modules/socket.io-client': { version: '4.8.3' },
      'node_modules/cheerio': { version: '1.2.0' },
      'node_modules/typescript': { version: '5.9.3' },
      'node_modules/zod': { version: '4.6.7' },
      'node_modules/vitest': { version: '4.1.11' },
      'node_modules/eslint': { version: '10.9.1' },
      'node_modules/prettier': { version: '3.9.6' },
      'node_modules/deepmerge-ts': { version: '8.0.0' },
      'node_modules/mysql2': { version: '3.23.1' },
    },
  };
}

interface State {
  rootManifest: Manifest;
  workspaces: { name: string; directory: string; manifest: Manifest }[];
  lock: { packages: Record<string, { version?: string }> };
  nodeVersion?: string;
  installed?: Record<string, string | null>;
}

function baseState(): State {
  return {
    rootManifest: baseRootManifest(),
    workspaces: baseWorkspaces(),
    lock: baseLock(),
    nodeVersion: lockedNode,
  };
}

/** The baseline, optionally bent in exactly one place, evaluated. */
function failuresFor(mutate?: (state: State) => void): string[] {
  const state = baseState();
  mutate?.(state);
  return evaluateVersionPolicy(state).failures as string[];
}

/** The `apps/web` manifest of a state, for the common mutation. */
function web(state: State): Manifest {
  return state.workspaces.find((workspace) => workspace.directory === 'apps/web')!
    .manifest;
}

function database(state: State): Manifest {
  return state.workspaces.find(
    (workspace) => workspace.directory === 'packages/database',
  )!.manifest;
}

describe('F13.1 — the baseline passes', () => {
  it('accepts a compliant synthetic repository', () => {
    expect(failuresFor()).toEqual([]);
  });

  it('accepts the REAL repository through the committed gate', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'verify-versions.mjs')],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('package-lock.json');
  });

  it('proves the policy WITHOUT node_modules as the source of truth', () => {
    // The decisive property. The engine is given no `installed` map at all —
    // the state a fresh runner is in before `npm ci` — and still both passes a
    // compliant repository and catches a violation.
    expect(failuresFor()).toEqual([]);

    const caught = failuresFor((state) => {
      web(state).dependencies!['next'] = '17.0.0';
      state.lock.packages['node_modules/next'] = { version: '17.0.0' };
    });

    expect(caught.join('\n')).toMatch(/next/);
  });
});

describe('F13.2 — frozen exact pins stay exact', () => {
  it.each([
    ['prisma', 'packages/database'],
    ['@prisma/client', 'packages/database'],
    ['@prisma/adapter-mssql', 'packages/database'],
  ])('keeps %s frozen at 7.10.0', (name) => {
    expect(policyFor(name)).toMatchObject({ kind: 'exact', expected: '7.10.0' });
  });

  it('rejects a range where an exact pin is required', () => {
    const failures = failuresFor((state) => {
      state.workspaces.find(
        (w) => w.directory === 'packages/database',
      )!.manifest.devDependencies!['prisma'] = '^7.10.0';
    });

    expect(failures.join('\n')).toMatch(/prisma.*locked exactly at 7\.10\.0/s);
  });

  it('rejects the wrong exact patch of a frozen package', () => {
    const failures = failuresFor((state) => {
      state.workspaces.find(
        (w) => w.directory === 'packages/database',
      )!.manifest.dependencies!['@prisma/client'] = '7.10.1';
      state.lock.packages['node_modules/@prisma/client'] = { version: '7.10.1' };
    });

    expect(failures.join('\n')).toMatch(/@prisma\/client/);
  });

  it('rejects a wrong MAJOR', () => {
    const failures = failuresFor((state) => {
      web(state).dependencies!['next'] = '17.0.0';
      state.lock.packages['node_modules/next'] = { version: '17.0.0' };
    });

    expect(failures.join('\n')).toMatch(/next/);
  });

  it.each([
    // 4.5.x is the line GHSA-mrhx-c7xc-m3w5 left unpatched; going back to it is
    // a security regression, not a patch choice.
    ['4.5.4', 'the vulnerable former line'],
    // 4.7.0 is a different architectural choice, not a patch.
    ['4.7.0', 'the next minor'],
  ])('rejects zod %s (%s) where the contract fixes the 4.6 minor', (version) => {
    const failures = failuresFor((state) => {
      database(state).dependencies!['zod'] = version;
      state.lock.packages['node_modules/zod'] = { version };
    });

    expect(failures.join('\n')).toMatch(/zod.*4\.6\.x/s);
  });

  it('accepts the exact 4.6.7 declaration and rejects a caret that could leave 4.6', () => {
    const zod = policyFor('zod');

    expect(zod).toMatchObject({ kind: 'range', expected: '4.6' });
    expect(specifierViolation(zod, '4.6.7')).toBeNull();
    expect(specifierViolation(zod, '^4.6.7')).toMatch(/does not fix/);
    expect(specifierViolation(zod, '4.6.7-rc.1')).toMatch(/prerelease/);
  });

  it('rejects a caret that would float past the fixed minor', () => {
    // `^5.9.3` LOOKS like 5.9. It permits 5.10, which is outside the range —
    // the difference between naming a version and fixing one.
    expect(
      specifierViolation(
        { name: 'typescript', kind: 'range', expected: '5.9' },
        '^5.9.3',
      ),
    ).toMatch(/does not fix/);

    expect(
      specifierViolation(
        { name: 'typescript', kind: 'range', expected: '5.9' },
        '~5.9.3',
      ),
    ).toBeNull();
  });

  it('accepts a caret where the contract fixes only the major', () => {
    expect(
      specifierViolation({ name: 'eslint', kind: 'range', expected: '10' }, '^10.9.1'),
    ).toBeNull();
  });
});

describe('F13.3 — prereleases are rejected everywhere', () => {
  it.each([
    '7.11.0-alpha.1',
    '8.0.0-beta.2',
    '7.10.1-rc.1',
    '8.0.0-next.3',
    '7.10.1-canary.0',
  ])('rejects the declared prerelease %s', (version) => {
    expect(
      specifierViolation({ name: 'prisma', kind: 'exact', expected: '7.10.0' }, version),
    ).toMatch(/prerelease/);
  });

  it('rejects a prerelease even when semver ordering would place it in range', () => {
    // `4.6.8-rc.1` sits inside the 4.6 line by ordering alone. §15 excludes it
    // regardless: the rule is about stability, not arithmetic.
    expect(versionSatisfies('4.6.8-rc.1', { kind: 'range', expected: '4.6' })).toBe(
      false,
    );
  });

  it('rejects a prerelease resolved by the LOCKFILE even when the manifest looks clean', () => {
    const failures = failuresFor((state) => {
      state.lock.packages['node_modules/zod'] = { version: '4.6.8-rc.1' };
    });

    expect(failures.join('\n')).toMatch(/prerelease/);
  });
});

describe('F13.4 — every workspace is inspected', () => {
  it('rejects a root/workspace conflict', () => {
    const failures = failuresFor((state) => {
      state.rootManifest.dependencies = { pino: '10.2.0' };
      state.lock.packages['node_modules/pino'] = { version: '10.3.1' };
    });

    expect(failures.join('\n')).toMatch(/pino/);
    expect(failures.join('\n')).toMatch(/conflicting declarations|locked exactly/);
  });

  it('rejects a workspace/workspace conflict', () => {
    const failures = failuresFor((state) => {
      state.workspaces.find(
        (w) => w.directory === 'packages/server-core',
      )!.manifest.dependencies!['zod'] = '4.6.6';
    });

    expect(failures.join('\n')).toMatch(/zod.*conflicting declarations/s);
  });

  /**
   * The hoisting hole, reproduced exactly. `apps/web` declares its own Next,
   * the lockfile gives it its own nested copy, and the ROOT `node_modules`
   * still holds the compliant version — so the old resolver-based checker saw
   * that compliant root copy and passed.
   */
  it('catches a workspace-local version that hoisting used to hide', () => {
    const failures = failuresFor((state) => {
      web(state).dependencies!['next'] = '16.2.0';
      state.lock.packages['apps/web/node_modules/next'] = { version: '16.2.0' };
    });

    expect(failures.join('\n')).toMatch(/next/);
    expect(failures.join('\n')).toMatch(/apps\/web/);
  });

  it('inspects devDependencies and optionalDependencies, not only dependencies', () => {
    expect(
      failuresFor((state) => {
        web(state).devDependencies!['tailwindcss'] = '4.4.0';
        state.lock.packages['node_modules/tailwindcss'] = { version: '4.4.0' };
      }).join('\n'),
    ).toMatch(/tailwindcss/);

    expect(
      failuresFor((state) => {
        web(state).optionalDependencies = { pino: '9.0.0' };
      }).join('\n'),
    ).toMatch(/pino/);
  });

  it('rejects an npm alias that hides a policy-controlled package', () => {
    const failures = failuresFor((state) => {
      web(state).dependencies!['our-next'] = 'npm:next@17.0.0';
    });

    expect(failures.join('\n')).toMatch(/alias/);
  });

  it('rejects a floating specifier for a locked package', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['next'] = '*';
      }).join('\n'),
    ).toMatch(/pins nothing/);
  });

  it('rejects a specifier the policy cannot reason about', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['next'] = '>=16.0.0 <17';
      }).join('\n'),
    ).toMatch(/cannot prove/);
  });
});

describe('F13.5 — the lockfile is authoritative and must agree', () => {
  it('rejects a declared package with no lock resolution', () => {
    const failures = failuresFor((state) => {
      delete state.lock.packages['node_modules/pino'];
    });

    expect(failures.join('\n')).toMatch(/pino.*resolves it nowhere/s);
  });

  it('rejects a manifest and lockfile that disagree', () => {
    const failures = failuresFor((state) => {
      state.lock.packages['node_modules/next'] = { version: '16.3.2' };
    });

    expect(failures.join('\n')).toMatch(/next.*resolves.*16\.3\.2/s);
  });

  it('rejects a lock entry carrying no version at all', () => {
    const failures = failuresFor((state) => {
      state.lock.packages['node_modules/pino'] = {};
    });

    expect(failures.join('\n')).toMatch(/declares no version/);
  });

  it('rejects a malformed resolved version instead of accepting its numeric prefix', () => {
    const failures = failuresFor((state) => {
      state.lock.packages['node_modules/typescript'] = {
        version: '5.9.3garbage',
      };
    });

    expect(failures.join('\n')).toMatch(/typescript.*outside the locked 5\.9\.x/s);
    expect(versionSatisfies('5.9.3garbage', { kind: 'range', expected: '5.9' })).toBe(
      false,
    );
  });

  it('rejects two direct declarations resolving to different versions', () => {
    const failures = failuresFor((state) => {
      state.rootManifest.dependencies = { pino: '10.3.1' };
      state.lock.packages['packages/server-core/node_modules/pino'] = {
        version: '10.3.0',
      };
    });

    expect(failures.join('\n')).toMatch(/pino/);
  });

  /**
   * The distinction that keeps the gate credible. A transitive copy at another
   * version is an ordinary dependency tree, not a policy breach — failing on
   * it would make the check cry wolf until someone switched it off.
   */
  it('does NOT fail on a harmless transitive copy', () => {
    expect(
      failuresFor((state) => {
        state.lock.packages['node_modules/some-tool/node_modules/zod'] = {
          version: '3.22.0',
        };
      }),
    ).toEqual([]);
  });

  it('does not compare a workspace-local direct install to an unrelated root copy', () => {
    expect(
      failuresFor((state) => {
        state.lock.packages['apps/web/node_modules/next'] = { version: '16.4.2' };
        state.lock.packages['node_modules/next'] = { version: '15.5.0' };
        state.installed = { next: '15.5.0' };
      }),
    ).toEqual([]);
  });
});

describe('F13.6 — deferred packages: absent is correct, present is contracted', () => {
  it.each(deferredStack as readonly { name: string }[])(
    'treats $name as legitimately absent',
    ({ name }) => {
      expect(isDeferred(name)).toBe(true);
      expect(failuresFor()).toEqual([]);
    },
  );

  it('reports each deferred package as deferred rather than missing', () => {
    const { rows } = evaluateVersionPolicy(baseState()) as {
      rows: { package: string; status: string }[];
    };

    for (const { name } of deferredStack as readonly { name: string }[]) {
      expect(rows.find((row) => row.package === name)?.status).toMatch(/^deferred/);
    }
  });

  it('accepts a deferred package introduced at its approved version', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['better-auth'] = '1.7.7';
        state.lock.packages['node_modules/better-auth'] = { version: '1.7.7' };
      }),
    ).toEqual([]);

    expect(
      failuresFor((state) => {
        web(state).dependencies!['react-hook-form'] = '7.66.0';
        state.lock.packages['node_modules/react-hook-form'] = { version: '7.66.0' };
      }),
    ).toEqual([]);
  });

  it('rejects a deferred package introduced at the wrong version', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['better-auth'] = '1.8.0';
        state.lock.packages['node_modules/better-auth'] = { version: '1.8.0' };
      }).join('\n'),
    ).toMatch(/better-auth/);

    expect(
      failuresFor((state) => {
        web(state).dependencies!['react-hook-form'] = '8.0.0';
        state.lock.packages['node_modules/react-hook-form'] = { version: '8.0.0' };
      }).join('\n'),
    ).toMatch(/react-hook-form/);
  });

  it('rejects a deferred package introduced as a prerelease', () => {
    expect(
      failuresFor((state) => {
        web(state).devDependencies = { '@playwright/test': '1.55.0-beta.1' };
      }).join('\n'),
    ).toMatch(/prerelease/);
  });

  it('pins the Better Auth patch the stack actually resolves', () => {
    // TECH_STACK.md §2 locks the 1.7.x RANGE and §1.5 places the exact resolved
    // patch at genuine introduction. Phase 2 is that introduction, and it
    // resolved 1.7.4 — so the patch is no longer something this policy would
    // be pre-empting by naming. Phase 30 moved it to 1.7.7, the first patch
    // clearing three Critical advisories against 1.7.4-1.7.6.
    //
    // It is pinned EXACTLY rather than left as a range because the patch is
    // load-bearing: 1.7.0-1.7.2 required an `account.issuer` column and a
    // unique index on (issuer, accountId), which 1.7.3 withdrew and 1.7.4
    // keeps withdrawn. A range permitting 1.7.0 would permit a version whose
    // schema this repository deliberately does not have.
    expect(policyFor('better-auth')).toMatchObject({
      kind: 'exact',
      expected: '1.7.7',
    });
    expect(policyFor('better-auth')?.introduced).toMatch(/Phase 2/);
  });

  it('rejects the withdrawn 1.7.0-1.7.2 account schema line', () => {
    for (const version of [
      '1.7.0',
      '1.7.1',
      '1.7.2',
      '1.7.3',
      '1.7.4',
      '1.7.6',
      '1.8.0',
    ]) {
      expect(
        failuresFor((state) => {
          database(state).dependencies!['better-auth'] = version;
          state.lock.packages['node_modules/better-auth'] = { version };
        }).join('\n'),
      ).toMatch(/better-auth/);
    }
  });

  it('covers a scoped family without enumerating its packages', () => {
    expect(policyFor('@tiptap/starter-kit')).toMatchObject({
      kind: 'range',
      expected: '3',
    });

    expect(
      failuresFor((state) => {
        web(state).dependencies!['@tiptap/core'] = '2.9.0';
        state.lock.packages['node_modules/@tiptap/core'] = { version: '2.9.0' };
      }).join('\n'),
    ).toMatch(/@tiptap\/core/);
  });

  it('adds no deferred dependency to the real repository', () => {
    // H2 must not install a deferred package merely to exercise the checker.
    const manifests = ['package.json', 'apps/web/package.json'].map(
      (file) => JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as Manifest,
    );

    for (const manifest of manifests) {
      const declared = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
      });

      for (const { name } of deferredStack as readonly { name: string }[]) {
        expect(declared, `${name} must not be installed yet`).not.toContain(name);
      }
    }
  });
});

describe('F13.7 — the check fails closed on unusable input', () => {
  it('fails when package-lock.json is missing', () => {
    const { failures } = evaluateVersionPolicy({
      ...baseState(),
      lock: null,
    }) as { failures: string[] };

    expect(failures.join('\n')).toMatch(/lockfile/);
  });

  it('fails when the lockfile carries no `packages` map', () => {
    const { failures } = evaluateVersionPolicy({
      ...baseState(),
      lock: { lockfileVersion: 3 },
    }) as { failures: string[] };

    expect(failures.join('\n')).toMatch(/packages/);
  });

  it('fails when the root manifest cannot be parsed', () => {
    const { failures } = evaluateVersionPolicy({
      ...baseState(),
      rootManifest: null,
    }) as { failures: string[] };

    expect(failures.length).toBeGreaterThan(0);
  });

  it('fails when a workspace manifest cannot be parsed', () => {
    const failures = failuresFor((state) => {
      state.workspaces.push({
        name: '@minhaj/broken',
        directory: 'packages/broken',
        manifest: null as unknown as Manifest,
      });
    });

    expect(failures.join('\n')).toMatch(/could not be parsed/);
  });

  it('fails when a dependency block is not an object', () => {
    const failures = failuresFor((state) => {
      web(state).dependencies = 'nonsense' as unknown as Record<string, string>;
    });

    expect(failures.join('\n')).toMatch(/not an object/);
  });

  it('fails when a locked runtime package is declared by nobody', () => {
    const failures = failuresFor((state) => {
      delete web(state).dependencies!['next'];
    });

    expect(failures.join('\n')).toMatch(/next.*declared by no workspace/s);
  });

  it('fails on the wrong Node runtime rather than reporting success', () => {
    const failures = failuresFor((state) => {
      state.nodeVersion = '22.11.0';
    });

    expect(failures.join('\n')).toMatch(/node: running 22\.11\.0/);
  });

  it('fails when engines.node drifts from the locked runtime', () => {
    const failures = failuresFor((state) => {
      state.rootManifest.engines = { node: '>=24' };
    });

    expect(failures.join('\n')).toMatch(/engines\.node/);
  });
});

describe('F13.8 — the security overrides are proved from source too', () => {
  it('rejects a removed override', () => {
    const failures = failuresFor((state) => {
      delete state.rootManifest.overrides!['mysql2'];
    });

    expect(failures.join('\n')).toMatch(/mysql2.*root override is missing/s);
  });

  it('rejects a lockfile that resolves an overridden package elsewhere', () => {
    const failures = failuresFor((state) => {
      state.lock.packages['node_modules/mssql/node_modules/mysql2'] = {
        version: '3.22.0',
      };
    });

    expect(failures.join('\n')).toMatch(/mysql2/);
  });
});

describe('F13.9 — the transcribed policy matches TECH_STACK.md', () => {
  // The Docker test stage builds from a context that deliberately excludes
  // `docs/` — documentation is not a build input, and widening the image to
  // satisfy a test would be the wrong repair. Reading the document at suite
  // definition time therefore failed COLLECTION there, taking the whole file
  // down with it, including the checks below that never touch the document.
  //
  // Only the assertion that literally reads TECH_STACK.md is conditional. It is
  // reported as SKIPPED where the document is absent — never as passing, which
  // would turn a missing proof into a green one — and runs normally in every
  // full checkout, which is where the transcription can actually drift.
  const techStackPath = path.join(repoRoot, 'docs', 'TECH_STACK.md');
  const techStack = existsSync(techStackPath)
    ? readFileSync(techStackPath, 'utf8')
    : null;

  const documented = lockedStack as readonly {
    name: string;
    expected: string;
    kind: string;
  }[];

  /**
   * What the DOCUMENT is expected to contain for a package.
   *
   * Usually the policy's own value. Better Auth is the exception, and the
   * exception is deliberate rather than a fudge: TECH_STACK.md §2 records the
   * locked architectural choice as the `1.7.x` RANGE and states that "the exact
   * resolved patch is recorded in the committed lockfile". The policy pins
   * `1.7.4` exactly because the patch is load-bearing here — 1.7.0-1.7.2
   * carried an `account.issuer` column that 1.7.3 withdrew, so a range
   * permitting 1.7.0 would permit a schema this repository deliberately does
   * not have.
   *
   * Both statements are true and they are about different things: the document
   * fixes the architectural range, the policy fixes the patch Phase 2 resolved.
   * The document is checked against the range it actually states.
   *
   * `@playwright/test` is the same case for the same reason: §2 records
   * Playwright as the `1.55.x` RANGE, while the policy pins the patch the
   * browser suite actually runs against.
   *
   * Resend is deliberately NOT here. Its §2 row read "current stable at
   * introduction" — a forward reference the document left for its owning
   * phase to resolve — and Phase 2 is that introduction, so the resolved
   * `6.27.0` is recorded in the document itself and checked against it
   * directly. An override here would have had nothing to match.
   */
  const documentedVersion: Record<string, string> = {
    'better-auth': '1.7.x',
    '@playwright/test': '1.55.x',
  };

  it.skipIf(techStack === null).each(documented)(
    'finds $expected for $name in the frozen document',
    ({ name, expected }) => {
      expect(techStack).toContain(documentedVersion[name] ?? expected);
    },
  );

  it('names every deferred dependency the document defers', () => {
    const names = (deferredStack as readonly { name: string }[]).map(
      (entry) => entry.name,
    );

    expect(names).toContain('playwright');

    // socket.io and socket.io-client were here until Phase 25, which introduced
    // the realtime transport at its owning point; their absence now fails.
    expect(names).not.toContain('socket.io');
    expect(names).not.toContain('socket.io-client');

    // better-auth was here until Phase 2, and next-intl until Phase 3A.
    // TECH_STACK.md §1.5 places validation at genuine introduction, and this
    // is what that migration looks like from the policy's side: neither is
    // legitimately absent any more.
    expect(names).not.toContain('better-auth');

    // next-intl was here until Phase 3A. TECH_STACK.md §1.5 places validation
    // at genuine introduction, and this is what that migration looks like from
    // the policy's side: it is no longer legitimately absent.
    expect(names).not.toContain('next-intl');
  });

  /**
   * next-intl at its owning point (TECH_STACK.md §1.5, DELIVERY_PLAN.md
   * Phase 3A).
   *
   * The direction of this contract INVERTED in Phase 3A. While the package was
   * deferred, absence passed and presence had to be justified. Now that
   * localisation is delivered, absence is a broken application, and these
   * assertions are what stop the policy quietly sliding back to "not installed
   * yet is fine" if a manifest ever loses the dependency.
   */
  it('locks next-intl to the 4.14.x range at its owning phase', () => {
    expect(policyFor('next-intl')).toEqual(
      expect.objectContaining({ kind: 'range', expected: '4.14' }),
    );

    // TECH_STACK.md §2: "the range is the locked architectural choice and the
    // exact resolved patch is recorded in the committed lockfile". A frozen
    // patch in the POLICY would be a different architectural decision.
    expect(policyFor('next-intl')).not.toEqual(
      expect.objectContaining({ kind: 'exact' }),
    );
  });

  it('names Phase 3A as the phase that introduced it', () => {
    expect(policyFor('next-intl')?.introduced).toMatch(/Phase 3A/);
  });

  it('FAILS when next-intl is absent, where absence used to pass', () => {
    const failures = failuresFor((state) => {
      delete web(state).dependencies!['next-intl'];
      delete state.lock.packages['node_modules/next-intl'];
    });

    expect(failures.join('\n')).toMatch(/next-intl/);
    expect(failures.join('\n')).toMatch(/declared by no workspace/);
  });

  /**
   * Socket.IO at its owning point (TECH_STACK.md §1.5, DELIVERY_PLAN.md
   * Phase 25). The same inversion next-intl made in Phase 3A: absence used to
   * pass and now fails, because the realtime process is delivered.
   */
  it('locks socket.io and socket.io-client EXACTLY at 4.8.3, introduced in Phase 25', () => {
    for (const name of ['socket.io', 'socket.io-client'])
      expect(policyFor(name), name).toEqual(
        expect.objectContaining({ kind: 'exact', expected: '4.8.3' }),
      );
    expect(policyFor('socket.io')?.introduced).toMatch(/Phase 25/);
  });

  it('FAILS when socket.io is absent, where absence used to pass', () => {
    const failures = failuresFor((state) => {
      for (const workspace of state.workspaces)
        delete workspace.manifest.dependencies?.['socket.io'];
      delete state.lock.packages['node_modules/socket.io'];
    });
    expect(failures.join('\n')).toMatch(/socket\.io/);
  });

  it('FAILS when socket.io drifts from the exact 4.8.3', () => {
    const failures = failuresFor((state) => {
      for (const workspace of state.workspaces)
        if (workspace.manifest.dependencies?.['socket.io'] !== undefined)
          workspace.manifest.dependencies['socket.io'] = '4.8.4';
      state.lock.packages['node_modules/socket.io'] = { version: '4.8.4' };
    });
    expect(failures.join('\n')).toMatch(/socket\.io/);
  });

  /**
   * Cheerio at its owning point (TECH_STACK.md §2 "Native fetch + Cheerio",
   * §11; Phase 29). Development tooling for the migration source adapters,
   * pinned exactly because it parses hostile legacy markup.
   */
  it('locks cheerio EXACTLY at 1.2.0, introduced in Phase 29', () => {
    expect(policyFor('cheerio')).toEqual(
      expect.objectContaining({ kind: 'exact', expected: '1.2.0' }),
    );
    expect(policyFor('cheerio')?.introduced).toMatch(/Phase 29/);
  });

  it('FAILS when cheerio is absent or drifts from the exact 1.2.0', () => {
    const absent = failuresFor((state) => {
      delete state.rootManifest.devDependencies?.['cheerio'];
      delete state.lock.packages['node_modules/cheerio'];
    });
    const drifted = failuresFor((state) => {
      state.rootManifest.devDependencies!['cheerio'] = '^1.2.0';
      state.lock.packages['node_modules/cheerio'] = { version: '1.2.1' };
    });
    expect(absent.join('\n')).toMatch(/cheerio/);
    expect(drifted.join('\n')).toMatch(/cheerio/);
  });

  it('accepts the installed 4.14.x patch', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['next-intl'] = '4.14.1';
        state.lock.packages['node_modules/next-intl'] = { version: '4.14.1' };
      }),
    ).toEqual([]);
  });

  it.each(['4.13.7', '5.0.0', '4.15.0'])(
    'rejects next-intl resolving to %s, outside the locked range',
    (version) => {
      expect(
        failuresFor((state) => {
          web(state).dependencies!['next-intl'] = version;
          state.lock.packages['node_modules/next-intl'] = { version };
        }).join('\n'),
      ).toMatch(/next-intl/);
    },
  );

  it('rejects a next-intl prerelease', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['next-intl'] = '4.14.4-beta.1';
        state.lock.packages['node_modules/next-intl'] = { version: '4.14.4-beta.1' };
      }).join('\n'),
    ).toMatch(/next-intl/);
  });

  it('rejects a next-intl declaration that floats outside 4.14', () => {
    // `^4.14.3` names 4.14.3 but fixes only the major, so it permits 4.15.
    expect(
      failuresFor((state) => {
        web(state).dependencies!['next-intl'] = '^4.14.3';
      }).join('\n'),
    ).toMatch(/next-intl/);
  });

  it('rejects next-intl smuggled in under an npm alias', () => {
    expect(
      failuresFor((state) => {
        web(state).dependencies!['intl'] = 'npm:next-intl@4.14.3';
      }).join('\n'),
    ).toMatch(/next-intl/);
  });

  it('proves the REAL repository declares it, not only the synthetic one', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'apps/web/package.json'), 'utf8'),
    ) as Manifest;

    expect(Object.keys(manifest.dependencies ?? {})).toContain('next-intl');
  });

  it('keeps the Phase 1 Prisma trio exact', () => {
    for (const name of ['prisma', '@prisma/client', '@prisma/adapter-mssql']) {
      expect(policyFor(name)).toEqual(
        expect.objectContaining({ kind: 'exact', expected: '7.10.0' }),
      );
    }
  });
});

/**
 * Pre-Phase-30 security maintenance. Two security fixes live in version pins,
 * so the REAL repository is held to them: Node 24.22.1 (the Node 24 line of the
 * 2026-10-21 security releases) and Zod 4.6.7 (GHSA-mrhx-c7xc-m3w5, first patched 4.6.6).
 */
describe('F13.10 — the security-maintenance pins hold in the real repository', () => {
  const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

  it('runs every Node pin on the locked runtime, with no 24.20.0 left behind', () => {
    expect(lockedNode).toBe('24.22.1');

    const pins: [string, string | undefined][] = [
      [
        'package.json engines',
        (JSON.parse(read('package.json')) as Manifest).engines?.node,
      ],
      [
        'package-lock.json root engines',
        (
          JSON.parse(read('package-lock.json')) as {
            packages: Record<string, { engines?: Record<string, string> }>;
          }
        ).packages['']?.engines?.['node'],
      ],
      [
        'ci.yml NODE_VERSION',
        /^ {2}NODE_VERSION: '([^']+)'$/m.exec(read('.github/workflows/ci.yml'))?.[1],
      ],
      [
        'staging edge proof image',
        /^readonly NODE_IMAGE='node:([^-']+)-/m.exec(
          read('scripts/staging-edge-proof.sh'),
        )?.[1],
      ],
    ];

    for (const dockerfile of ['web', 'realtime', 'ops']) {
      const source = read(`docker/${dockerfile}.Dockerfile`);
      const nodeImages = [...source.matchAll(/^FROM node:(\S+?)-bookworm-slim\b/gm)];

      expect(
        nodeImages.length,
        `${dockerfile}.Dockerfile builds on Node`,
      ).toBeGreaterThan(0);
      for (const [, version] of nodeImages)
        pins.push([`${dockerfile}.Dockerfile`, version]);
      expect(source).not.toContain('24.20.0');
    }

    for (const [where, version] of pins) expect(version, where).toBe(lockedNode);
  });

  it('declares zod exactly 4.6.7 in every workspace and resolves nothing older', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<
        string,
        { version?: string; dependencies?: Record<string, string> }
      >;
    };

    const declarations = Object.entries(lock.packages)
      .filter(([key]) => !key.includes('node_modules'))
      .flatMap(([key]) => {
        const manifestPath = key === '' ? 'package.json' : `${key}/package.json`;
        if (!existsSync(path.join(repoRoot, manifestPath))) return [];
        const manifest = JSON.parse(read(manifestPath)) as Manifest;
        return ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap(
          (field) => {
            const spec = manifest[field as keyof Manifest] as
              Record<string, string> | undefined;
            return spec?.['zod'] === undefined ? [] : [[manifestPath, spec['zod']]];
          },
        );
      });

    // contracts, database and storage declare it today; a new declaration is
    // held to the same pin the moment it appears.
    expect(declarations.length).toBeGreaterThanOrEqual(3);
    for (const [manifestPath, spec] of declarations)
      expect(spec, manifestPath).toBe('4.6.7');

    const resolved = Object.entries(lock.packages).filter(([key]) =>
      key.endsWith('node_modules/zod'),
    );
    expect(resolved.length).toBeGreaterThan(0);
    for (const [key, entry] of resolved) expect(entry.version, key).toBe('4.6.7');
  });
});
