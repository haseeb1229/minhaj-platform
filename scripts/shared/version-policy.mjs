/**
 * THE locked-stack policy, and the engine that proves it from repository state.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The previous checker asked `require.resolve()` what was installed. That makes
 * `node_modules` the source of truth, and `node_modules` is not repository
 * state: it is whatever the last install happened to leave behind. Three
 * consequences, all of them real:
 *
 *   - A workspace could declare an out-of-policy version and pass, because
 *     hoisting meant the resolver found the ROOT copy.
 *   - A manifest and the lockfile could disagree entirely and pass, because
 *     neither was read.
 *   - A deferred package — Better Auth, next-intl, Socket.IO, Playwright — had
 *     no contract at all. It could arrive at any version, in any workspace, and
 *     the checker would not notice, because it only ever looked for the
 *     thirteen names it already knew.
 *
 * The authority is therefore the COMMITTED SOURCE: the root manifest, every
 * workspace manifest, and `package-lock.json`. Those three files decide what a
 * clean `npm ci` installs, so they are what the policy is proved against, and
 * the proof holds on a fresh runner that has installed nothing yet.
 *
 * The engine is a pure function over parsed inputs so it can be exercised
 * against synthetic manifests and lockfiles. Nothing here mutates a manifest to
 * simulate a bad state, and nothing here reaches the network.
 *
 * TECH_STACK.md §1.2, §1.5, §2, §15, §16 · SECURITY_BASELINE.md §18.3.
 */

/* ===========================================================================
 * The policy, transcribed from TECH_STACK.md §2.
 * ========================================================================= */

/**
 * Packages this repository installs TODAY.
 *
 * `exact` is a frozen pin — the version and nothing else. `range` fixes the
 * leading parts named in `expected` and lets the lockfile record the patch
 * (TECH_STACK.md §16 rule 5).
 */
export const lockedStack = Object.freeze([
  { name: 'next', kind: 'exact', expected: '16.3.3', introduced: 'Phase 0B' },
  { name: 'react', kind: 'exact', expected: '19.2.8', introduced: 'Phase 0B' },
  { name: 'react-dom', kind: 'exact', expected: '19.2.8', introduced: 'Phase 0B' },
  { name: 'tailwindcss', kind: 'exact', expected: '4.3.3', introduced: 'Phase 0B' },
  { name: 'pino', kind: 'exact', expected: '10.3.1', introduced: 'Phase 0B' },
  { name: 'prisma', kind: 'exact', expected: '7.10.0', introduced: 'Phase 1' },
  { name: '@prisma/client', kind: 'exact', expected: '7.10.0', introduced: 'Phase 1' },
  {
    name: '@prisma/adapter-mssql',
    kind: 'exact',
    expected: '7.10.0',
    introduced: 'Phase 1',
  },
  { name: 'typescript', kind: 'range', expected: '5.9', introduced: 'Phase 0B' },
  { name: 'zod', kind: 'range', expected: '4.5', introduced: 'Phase 0B' },
  { name: 'vitest', kind: 'range', expected: '4.1', introduced: 'Phase 0B' },
  { name: 'eslint', kind: 'range', expected: '10', introduced: 'Phase 0B' },
  { name: 'prettier', kind: 'range', expected: '3', introduced: 'Phase 0B' },
]);

/**
 * Packages that are LOCKED but deliberately not installed yet (§1.3, §1.5).
 *
 * Absence is correct and must pass: "Phase 0B claims nothing about a package it
 * does not install." Presence is what needs a contract — if one of these turns
 * up before its owning phase, or at a version the architecture did not choose,
 * that is exactly the drift §1.2 exists to stop.
 *
 * No patch is frozen for Better Auth here. TECH_STACK.md §2 locks the 1.7.x
 * RANGE and §1.5 places the exact resolved patch at genuine introduction in
 * Phase 2; inventing a patch now would decide, in a hardening pass, something
 * the architecture deliberately left to the phase that installs it.
 */
export const deferredStack = Object.freeze([
  {
    name: 'better-auth',
    kind: 'range',
    expected: '1.7',
    introduced: 'Phase 2 — Identity & Access',
  },
  {
    name: 'next-intl',
    kind: 'range',
    expected: '4.14',
    introduced: 'Phase 3A — Localisation Foundation',
  },
  {
    name: 'socket.io',
    kind: 'exact',
    expected: '4.8.3',
    introduced: 'Phase 25 — realtime runtime',
  },
  {
    // The same product, shipped as a second package. Locking the server and
    // leaving the client unconstrained would be a hole rather than a decision.
    name: 'socket.io-client',
    kind: 'exact',
    expected: '4.8.3',
    introduced: 'Phase 25 — realtime runtime',
  },
  {
    name: 'playwright',
    kind: 'range',
    expected: '1.55',
    introduced: 'first genuine introduction',
  },
  {
    name: '@playwright/test',
    kind: 'range',
    expected: '1.55',
    introduced: 'first genuine introduction',
  },
  { name: 'motion', kind: 'range', expected: '13.1', introduced: 'first genuine use' },
  { name: 'react-hook-form', kind: 'range', expected: '7', introduced: 'when needed' },
]);

/**
 * Scoped FAMILIES, matched by prefix.
 *
 * Tiptap 3.x is locked as a product and ships as a dozen packages
 * (`@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`, …). Naming them
 * individually would guess at which ones a future editor build uses; a prefix
 * rule covers whichever it turns out to be.
 */
export const lockedFamilies = Object.freeze([
  { prefix: '@tiptap/', kind: 'range', expected: '3', introduced: 'when needed' },
]);

/** Transitive security overrides, pinned at the root (root `overrides`). */
export const requiredSecurityOverrides = Object.freeze([
  { name: 'deepmerge-ts', expected: '8.0.0' },
  { name: 'mysql2', expected: '3.23.1' },
]);

/** The locked runtime (TECH_STACK.md §3). */
export const lockedNode = '24.20.0';

/** Manifest fields that declare a DIRECT dependency. */
const dependencyFields = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

/* ===========================================================================
 * Policy lookup.
 * ========================================================================= */

/** The policy entry governing `name`, or null if the package is unconstrained. */
export function policyFor(name) {
  const named = [...lockedStack, ...deferredStack].find((entry) => entry.name === name);
  if (named !== undefined) return named;

  const family = lockedFamilies.find((entry) => name.startsWith(entry.prefix));
  return family === undefined ? null : { ...family, name };
}

/** Is this package deferred — legitimately absent until its owning phase? */
export function isDeferred(name) {
  return (
    deferredStack.some((entry) => entry.name === name) ||
    lockedFamilies.some((entry) => name.startsWith(entry.prefix))
  );
}

/* ===========================================================================
 * Version and specifier reasoning.
 *
 * Deliberately hand-written rather than pulled from a semver library. The
 * grammar this policy needs is small — an exact pin, a caret, a tilde — and
 * adding a dependency to check the dependency policy would be its own
 * architecture decision (TECH_STACK.md §1.2).
 * ========================================================================= */

/** Prereleases are excluded outright (TECH_STACK.md §15, §16 rule 6). */
export function isPrerelease(version) {
  if (typeof version !== 'string') return false;

  // A hyphen in build metadata (`1.2.3+linux-x64`) does not make a SemVer
  // prerelease. Only the portion before `+` participates in that decision.
  return /-/.test(version.replace(/^[~^]/, '').split('+', 1)[0]);
}

/** Does a RESOLVED version satisfy an entry? */
export function versionSatisfies(version, entry) {
  if (typeof version !== 'string') return false;
  if (isPrerelease(version)) return false;

  // Anchor the whole lockfile value. A prefix check accepted malformed values
  // such as `5.9.3garbage` for a 5.9.x policy, which turns corrupt or hostile
  // lock data into apparent proof instead of failing closed.
  const parsed =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  if (parsed === null) return false;

  if (entry.kind === 'exact') return version === entry.expected;

  const expected = entry.expected.split('.');
  const actual = parsed.slice(1, 4);

  return expected.every((part, index) => actual[index] === part);
}

/**
 * Parses a dependency SPECIFIER — what a manifest declares, not what resolves.
 *
 * Anything this cannot reason about confidently is reported as `unsupported`
 * and fails, rather than being waved through. A specifier the checker does not
 * understand is exactly where an out-of-policy version would hide.
 */
export function analyseSpecifier(spec) {
  if (typeof spec !== 'string') return { kind: 'unsupported', spec };

  const trimmed = spec.trim();
  if (trimmed === '') return { kind: 'unsupported', spec };
  if (trimmed.startsWith('npm:')) return { kind: 'alias', spec };
  if (/^(?:workspace|file|link|git|github|https?|portal|patch):/i.test(trimmed)) {
    return { kind: 'unsupported', spec };
  }
  if (/[\s|]/.test(trimmed) || /^[<>=]/.test(trimmed)) {
    return { kind: 'unsupported', spec };
  }
  if (/^(?:\*|x|latest|next)$/i.test(trimmed)) return { kind: 'floating', spec };

  const match =
    /^([~^]?)v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      trimmed,
    );

  if (match === null) return { kind: 'unsupported', spec };

  const [, operator, major, minor, patch, prerelease] = match;

  return {
    kind: 'version',
    spec,
    operator,
    parts: [major, minor, patch],
    prerelease: prerelease !== undefined,
  };
}

/**
 * How many leading version parts a specifier actually FIXES.
 *
 * This is the question that matters. `^5.9.3` names 5.9.3 but fixes only the
 * major, so it permits 5.10 — outside a `5.9` range even though it looks like
 * it sits inside one.
 */
function fixedPartCount(analysis) {
  const [major, minor, patch] = analysis.parts;
  const named = [major, minor, patch].filter(
    (part) => part !== undefined && !/[xX*]/.test(part),
  ).length;

  if (analysis.operator === '^') {
    if (major !== '0') return Math.min(1, named);
    if (minor !== undefined && minor !== '0') return Math.min(2, named);
    return named;
  }

  if (analysis.operator === '~') return Math.min(minor === undefined ? 1 : 2, named);

  return named;
}

/**
 * Checks one DECLARED specifier against its policy entry.
 *
 * Returns a human-readable reason, or null when the declaration is compliant.
 */
export function specifierViolation(entry, spec) {
  const analysis = analyseSpecifier(spec);

  if (analysis.kind === 'alias') {
    return `declared through an npm alias ('${spec}'), which hides the real package from the policy`;
  }

  if (analysis.kind === 'floating') {
    return `declared as '${spec}', which pins nothing; ${entry.name} is a locked architecture decision`;
  }

  if (analysis.kind === 'unsupported') {
    return `declared as '${spec}', a specifier this policy cannot prove; use an exact version or a caret/tilde range`;
  }

  if (analysis.prerelease) {
    return `declared as '${spec}', a prerelease; canary, beta, RC, preview and experimental packages are excluded (TECH_STACK.md §15)`;
  }

  const expected = entry.expected.split('.');
  const fixed = fixedPartCount(analysis);

  if (fixed < expected.length) {
    return entry.kind === 'exact'
      ? `declared as '${spec}', which floats; ${entry.name} is locked exactly at ${entry.expected}`
      : `declared as '${spec}', which does not fix ${entry.name} to ${entry.expected}.x`;
  }

  for (const [index, part] of expected.entries()) {
    if (analysis.parts[index] !== part) {
      return entry.kind === 'exact'
        ? `declared as '${spec}', locked exactly at ${entry.expected}`
        : `declared as '${spec}', outside the locked range ${entry.expected}.x`;
    }
  }

  if (entry.kind === 'exact') {
    const declared = analysis.parts.join('.');
    if (analysis.operator !== '' || declared !== entry.expected) {
      return `declared as '${spec}', locked exactly at ${entry.expected}`;
    }
  }

  return null;
}

/* ===========================================================================
 * Lockfile resolution.
 * ========================================================================= */

/**
 * Resolves what a DIRECT declaration in `fromDirectory` actually installs.
 *
 * npm's own resolution order: the declaring directory's `node_modules`, then
 * each ancestor's, up to the root. This is why hoisting hid the previous
 * checker's blind spot — a workspace declaring its own version resolves to its
 * own copy, and `require.resolve` from the repository root never sees it.
 */
export function resolveFromLock(lock, fromDirectory, name) {
  const segments = fromDirectory === '' ? [] : fromDirectory.split('/');

  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const prefix = segments.slice(0, depth).join('/');
    const key = `${prefix === '' ? '' : `${prefix}/`}node_modules/${name}`;
    const entry = lock.packages?.[key];

    if (entry !== undefined) return { key, entry };
  }

  return null;
}

/** Every lock entry for `name`, at any nesting — direct copies and transitive. */
export function allLockEntries(lock, name) {
  return Object.entries(lock.packages ?? {})
    .filter(
      ([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`),
    )
    .map(([key, entry]) => ({ key, entry }));
}

/* ===========================================================================
 * The evaluation.
 * ========================================================================= */

/**
 * Proves the policy against committed repository state.
 *
 * @param {object} input
 * @param {object} input.rootManifest      parsed root `package.json`
 * @param {Array<{name?: string, directory: string, manifest: object}>} input.workspaces
 *        every workspace manifest, `directory` relative to the repository root
 * @param {object} input.lock              parsed `package-lock.json`
 * @param {string} [input.nodeVersion]     the runtime to validate, if any
 * @param {Record<string,string|null>} [input.installed]
 *        optional `node_modules` versions, used ONLY as a consistency check
 */
export function evaluateVersionPolicy(input) {
  const failures = [];
  const rows = [];

  const { rootManifest, workspaces, lock, nodeVersion, installed } = input;

  // --- Fail closed on unusable inputs --------------------------------------
  if (rootManifest === null || typeof rootManifest !== 'object') {
    failures.push(
      'the root package.json could not be parsed; the policy cannot be proved',
    );
    return { failures, rows };
  }

  if (lock === null || typeof lock !== 'object' || typeof lock.packages !== 'object') {
    failures.push(
      'package-lock.json is missing or carries no `packages` map. The lockfile is ' +
        'what a clean `npm ci` installs, so without it nothing here is evidence ' +
        '(TECH_STACK.md §16 rule 8).',
    );
    return { failures, rows };
  }

  if (!Array.isArray(workspaces)) {
    failures.push(
      'workspace manifests could not be enumerated; the policy cannot be proved',
    );
    return { failures, rows };
  }

  // --- Collect every DIRECT declaration of a policy-controlled package -----
  /** @type {Map<string, Array<{origin: string, directory: string, field: string, spec: string}>>} */
  const declarations = new Map();

  const manifests = [
    { origin: 'root package.json', directory: '', manifest: rootManifest },
    ...workspaces.map((workspace) => ({
      origin: `${workspace.name ?? workspace.directory}/package.json`,
      directory: workspace.directory.replaceAll('\\', '/'),
      manifest: workspace.manifest,
    })),
  ];

  for (const { origin, directory, manifest } of manifests) {
    if (manifest === null || typeof manifest !== 'object') {
      failures.push(
        `${origin} could not be parsed; a manifest that cannot be read fails closed`,
      );
      continue;
    }

    for (const field of dependencyFields) {
      const declared = manifest[field];
      if (declared === undefined) continue;

      if (declared === null || typeof declared !== 'object') {
        failures.push(
          `${origin}: '${field}' is not an object; the declaration cannot be proved`,
        );
        continue;
      }

      for (const [name, spec] of Object.entries(declared)) {
        const entry = policyFor(name);
        if (entry === null) continue;

        if (!declarations.has(name)) declarations.set(name, []);
        declarations.get(name).push({ origin, directory, field, spec });
      }
    }
  }

  // An alias can smuggle a policy-controlled package in under another name.
  for (const { origin, manifest } of manifests) {
    if (manifest === null || typeof manifest !== 'object') continue;

    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (typeof spec !== 'string' || !spec.startsWith('npm:')) continue;

        const aliased = spec.slice(4).replace(/@[^@]*$/, '');
        if (policyFor(aliased) !== null && aliased !== name) {
          failures.push(
            `${origin}: '${name}' is an alias for the policy-controlled package ` +
              `'${aliased}' ('${spec}'). Declare it under its real name so the ` +
              'policy applies to it.',
          );
        }
      }
    }
  }

  // --- Evaluate each policy entry -----------------------------------------
  for (const entry of [...lockedStack, ...deferredStack]) {
    const sites = declarations.get(entry.name) ?? [];
    const deferredEntry = isDeferred(entry.name);

    if (sites.length === 0) {
      if (deferredEntry) {
        rows.push({
          package: entry.name,
          policy: entry.kind === 'exact' ? entry.expected : `${entry.expected}.x`,
          declared: '—',
          resolved: '—',
          status: `deferred (${entry.introduced})`,
        });
        continue;
      }

      failures.push(
        `${entry.name}: locked at ${entry.expected} but declared by no workspace. ` +
          'A locked runtime dependency that nothing declares cannot be installed.',
      );
      rows.push({
        package: entry.name,
        policy: entry.expected,
        declared: '—',
        resolved: '—',
        status: 'UNDECLARED',
      });
      continue;
    }

    evaluateDeclaredPackage({ entry, sites, lock, installed, failures, rows });
  }

  // Family members are discovered rather than enumerated, so a `@tiptap/*`
  // package nobody listed still meets its contract.
  for (const [name, sites] of declarations) {
    if ([...lockedStack, ...deferredStack].some((known) => known.name === name)) continue;

    evaluateDeclaredPackage({
      entry: policyFor(name),
      sites,
      lock,
      installed,
      failures,
      rows,
    });
  }

  evaluateSecurityOverrides({ rootManifest, lock, installed, failures, rows });

  if (nodeVersion !== undefined) {
    const matches = nodeVersion === lockedNode;

    rows.push({
      package: 'node (runtime)',
      policy: lockedNode,
      declared: rootManifest.engines?.node ?? '—',
      resolved: nodeVersion,
      status: matches ? 'ok' : 'MISMATCH',
    });

    if (!matches) {
      failures.push(
        `node: running ${nodeVersion}, locked ${lockedNode}. The locked runtime is ` +
          'an architecture decision (TECH_STACK.md §3) — align the workstation ' +
          'rather than validating against a different runtime.',
      );
    }

    if (rootManifest.engines?.node !== lockedNode) {
      failures.push(
        `package.json engines.node is '${rootManifest.engines?.node ?? 'missing'}', ` +
          `locked exactly ${lockedNode}`,
      );
    }
  }

  return { failures, rows };
}

/** Manifest, cross-workspace and lockfile checks for one declared package. */
function evaluateDeclaredPackage({ entry, sites, lock, installed, failures, rows }) {
  let status = 'ok';

  // --- Manifest specifiers -------------------------------------------------
  for (const site of sites) {
    const violation = specifierViolation(entry, site.spec);

    if (violation !== null) {
      failures.push(`${entry.name}: ${site.origin} (${site.field}) ${violation}`);
      status = 'DECLARATION';
    }
  }

  // --- Conflicting declarations across manifests ---------------------------
  const distinct = [...new Set(sites.map((site) => site.spec))];

  if (distinct.length > 1) {
    failures.push(
      `${entry.name}: conflicting declarations — ` +
        sites.map((site) => `${site.origin} declares '${site.spec}'`).join(', ') +
        '. One locked package must have one declared version across the repository.',
    );
    status = 'CONFLICT';
  }

  // --- Lockfile resolution -------------------------------------------------
  const resolutions = new Map();

  for (const site of sites) {
    const resolved = resolveFromLock(lock, site.directory, entry.name);

    if (resolved === null) {
      failures.push(
        `${entry.name}: declared by ${site.origin} but package-lock.json resolves ` +
          'it nowhere reachable from that workspace. A declaration with no lock ' +
          'resolution cannot be installed by `npm ci`.',
      );
      status = 'NO LOCK ENTRY';
      continue;
    }

    const version = resolved.entry.version;

    if (typeof version !== 'string') {
      failures.push(
        `${entry.name}: package-lock.json entry '${resolved.key}' declares no version; ` +
          'a malformed lock entry fails closed rather than being skipped.',
      );
      status = 'MALFORMED LOCK';
      continue;
    }

    resolutions.set(resolved.key, version);

    if (isPrerelease(version)) {
      failures.push(
        `${entry.name}: package-lock.json resolves '${resolved.key}' to ${version}, ` +
          'a prerelease. Only stable releases are approved (TECH_STACK.md §15).',
      );
      status = 'PRERELEASE';
    } else if (!versionSatisfies(version, entry)) {
      failures.push(
        `${entry.name}: package-lock.json resolves '${resolved.key}' to ${version}, ` +
          `outside the locked ${entry.kind === 'exact' ? entry.expected : `${entry.expected}.x`}` +
          `${isDeferred(entry.name) ? ` (deferred to ${entry.introduced}; if it is genuinely introduced, it must arrive at the approved version)` : ''}`,
      );
      status = 'LOCK MISMATCH';
    }
  }

  const resolvedVersions = [...new Set(resolutions.values())];

  if (resolvedVersions.length > 1) {
    failures.push(
      `${entry.name}: direct declarations resolve to ${resolvedVersions.join(' and ')} ` +
        `(${[...resolutions.keys()].join(', ')}). Two versions of one locked package ` +
        'ship at once.',
    );
    status = 'SPLIT RESOLUTION';
  }

  // --- Manifest vs lock agreement -----------------------------------------
  // A transitive copy at a different version is normal and is NOT a failure;
  // only the resolution a DIRECT declaration reaches is policy-controlled. The
  // distinction matters: conflating them would make the gate cry wolf on every
  // ordinary dependency tree.
  const transitive = allLockEntries(lock, entry.name)
    .filter(({ key }) => !resolutions.has(key))
    .map(({ key, entry: locked }) => `${key}@${locked.version}`);

  // --- node_modules, as a CONSISTENCY check only ---------------------------
  const installedVersion = installed?.[entry.name];
  const rootResolution = resolutions.get(`node_modules/${entry.name}`);

  if (
    installedVersion !== undefined &&
    installedVersion !== null &&
    rootResolution !== undefined &&
    installedVersion !== rootResolution
  ) {
    failures.push(
      `${entry.name}: node_modules carries ${installedVersion} while package-lock.json ` +
        `resolves ${rootResolution}. The working tree has drifted from the ` +
        'lockfile — run `npm ci`.',
    );
    status = 'INSTALL DRIFT';
  }

  rows.push({
    package: entry.name,
    policy: entry.kind === 'exact' ? entry.expected : `${entry.expected}.x`,
    declared: distinct.join(' / ') || '—',
    resolved: resolvedVersions.join(' / ') || '—',
    status: status === 'ok' && transitive.length > 0 ? 'ok (+transitive)' : status,
  });
}

/** The transitive security overrides, proved from the root manifest and lock. */
function evaluateSecurityOverrides({ rootManifest, lock, installed, failures, rows }) {
  for (const { name, expected } of requiredSecurityOverrides) {
    const declared = rootManifest.overrides?.[name];
    let status = 'ok';

    if (declared !== expected) {
      failures.push(
        `${name}: root override is ${declared ?? 'missing'}, expected exactly ${expected}`,
      );
      status = 'OVERRIDE MISSING';
    }

    const entries = allLockEntries(lock, name);

    if (entries.length === 0) {
      failures.push(
        `${name}: the root override pins ${expected} but package-lock.json resolves ` +
          'the package nowhere. An override with nothing to override is stale.',
      );
      status = 'NO LOCK ENTRY';
    }

    for (const { key, entry } of entries) {
      if (entry.version !== expected) {
        failures.push(
          `${name}: package-lock.json resolves '${key}' to ${entry.version ?? 'no version'}, ` +
            `while the security override requires exactly ${expected}`,
        );
        status = 'LOCK MISMATCH';
      }
    }

    const installedVersion = installed?.[name];
    if (
      installedVersion !== undefined &&
      installedVersion !== null &&
      installedVersion !== expected
    ) {
      failures.push(
        `${name}: node_modules carries ${installedVersion}, security override requires ${expected}`,
      );
      status = 'INSTALL DRIFT';
    }

    rows.push({
      package: `${name} (security override)`,
      policy: expected,
      declared: declared ?? '—',
      resolved: entries.map(({ entry }) => entry.version).join(' / ') || '—',
      status,
    });
  }
}
