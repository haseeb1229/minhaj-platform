/**
 * Module resolution — ONE authoritative pipeline, driven entirely by
 * TypeScript, plus realpath canonicalisation.
 *
 * WHAT THIS REPLACES AND WHY
 * --------------------------
 * Reviews #2 and #3 both broke a resolver that ran ALONGSIDE TypeScript rather
 * than through it. Three separate bypasses followed from the same root cause:
 *
 *   B2 — only the `@/*` alias was understood, because that mapping was
 *        hard-coded. A workspace declaring `~/*` resolved for the build and
 *        not for the checker.
 *
 *   B3 — resolved `.d.ts` files were discarded. A declaration-only import is
 *        a real compile-time dependency and was invisible.
 *
 *   B4 — workspace package `exports` were matched by EXACT KEY in hand-written
 *        code. A `"./*": "./src/*.ts"` wildcard resolved for TypeScript and
 *        not for the checker, hiding a genuine cycle.
 *
 * The fix is structural, not additive: nothing here reimplements resolution.
 * `ts.resolveModuleName` performs every lookup, using the workspace's own
 * EFFECTIVE compiler options (see `./tsconfig.mjs`), so any alias the workspace
 * declares, every `exports` shape TypeScript supports, and every condition the
 * stack uses all behave identically for the analyser and for the build.
 *
 * WORKSPACE PACKAGES WITHOUT `node_modules`
 * -----------------------------------------
 * TypeScript finds a package by walking `node_modules`. In the real repository
 * npm links `node_modules/@minhaj/*` into `packages/*`, so that works. An
 * ISOLATED FIXTURE TREE has no such links, and a resolver that gave up there
 * would leave every fixture untested — which is how B4 survived.
 *
 * Rather than resolve packages by hand, the resolution HOST is virtualised: a
 * lookup under `node_modules/<workspace-package>/…` is redirected onto that
 * workspace's real directory. TypeScript still performs the resolution and
 * still reads the package's own `package.json`, so `exports` — exact subpaths,
 * wildcard patterns, conditions, nested targets — are applied by TypeScript's
 * implementation and not by an approximation of it.
 *
 * Every result then passes through `realpathSync` before classification, so a
 * symlink, a junction or a differently-cased Windows path cannot produce two
 * identities for one file, and every consumer of the graph agrees.
 */

import path from 'node:path';
import ts from 'typescript';

import { canonicalise } from '../shared/generated-roots.mjs';
import { repoRoot } from '../shared/workspaces.mjs';
import { effectiveOptionsFor } from './tsconfig.mjs';

/**
 * Canonical identity of a path on disk.
 *
 * Re-exported from `shared/generated-roots.mjs`, which owns it: the canonical
 * generated-root test is built on this function and must be importable without
 * the TypeScript compiler API, so that the RTL scanner can share one
 * generated-output policy with the architecture analyser (Review #8, B8-1).
 * Every existing caller keeps importing it from here, and there is still
 * exactly one implementation.
 */
export { canonicalise };

/** Repository-relative POSIX path, for stable diagnostics and rule matching. */
export function toRepoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

/**
 * `node_modules`, delimited, in the platform's own separator.
 *
 * TypeScript hands its host FORWARD-slash paths on every platform, including
 * Windows. Every candidate below is therefore run through `path.normalize`
 * first, which rewrites separators to the platform's, so one comparison is
 * correct on Windows and on Linux alike. Comparing the raw string would work
 * on Linux and silently fail on Windows — and a resolver that quietly resolves
 * nothing is the failure mode this whole remediation exists to remove.
 */
const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

/**
 * Builds a TypeScript module-resolution host that can see workspace packages
 * whether or not `node_modules` links exist.
 *
 * The host is `ts.sys` with one redirection: a filesystem lookup beneath
 * `…/node_modules/<workspace-package>/` is answered from that workspace's real
 * directory. TypeScript is unaware of the substitution and performs completely
 * ordinary package resolution — reading the real `package.json`, applying the
 * real `exports` map, honouring conditions — which is precisely the point.
 *
 * `workspacePackages` is `{ packageName: absoluteDirectory }`. Longer names are
 * matched first so `@scope/a-b` cannot be shadowed by `@scope/a`.
 */
function createResolutionHost(workspacePackages) {
  const entries = Object.entries(workspacePackages ?? {})
    .map(([name, directory]) => ({
      name,
      segment: name.split('/').join(path.sep),
      directory: path.resolve(directory),
    }))
    .sort((a, b) => b.segment.length - a.segment.length);

  const redirect = (file) => {
    if (entries.length === 0) return file;

    // Normalising FIRST is what makes the separator comparison below correct on
    // both platforms; see `NODE_MODULES_SEGMENT`.
    const normalised = path.normalize(file);
    const index = normalised.lastIndexOf(NODE_MODULES_SEGMENT);
    if (index === -1) return file;

    const remainder = normalised.slice(index + NODE_MODULES_SEGMENT.length);

    for (const entry of entries) {
      if (remainder === entry.segment) return entry.directory;
      if (remainder.startsWith(entry.segment + path.sep)) {
        return path.join(entry.directory, remainder.slice(entry.segment.length + 1));
      }
    }

    return file;
  };

  return {
    redirect,
    host: {
      fileExists: (file) => ts.sys.fileExists(redirect(file)),
      readFile: (file) => ts.sys.readFile(redirect(file)),
      realpath: (file) => {
        const target = redirect(file);
        return ts.sys.realpath === undefined ? target : ts.sys.realpath(target);
      },
      directoryExists: (directory) => ts.sys.directoryExists(redirect(directory)),
      getDirectories: (directory) => ts.sys.getDirectories(redirect(directory)),
      getCurrentDirectory: () => repoRoot,
    },
  };
}

/**
 * The `node_modules/<workspace-package>/…` -> real-directory mapping alone.
 *
 * Exported so the TypeScript PROGRAM built in `./tsconfig.mjs` sees workspace
 * packages exactly as this resolver does. Two implementations of one mapping
 * would drift, and a Program that could not resolve a workspace specifier would
 * stop its closure at the package boundary — hiding the very cross-package
 * edges the graph exists to find.
 */
export function createWorkspaceRedirect(workspacePackages) {
  return createResolutionHost(workspacePackages).redirect;
}

/**
 * NO SYNTHETIC CONDITIONS — Review #5 (N1).
 *
 * Previous rounds retried a failed resolution under a forced
 * `customConditions: ['react-server','node','import','require','default']` set,
 * on the reasoning that the graph should see what the SERVER loads. Review #5
 * showed what that actually produced: for a package whose `exports` map has no
 * applicable branch, real `tsc -p` reports TS2307 and resolves nothing, while
 * the analyser resolved `server-branch.ts` and carried on. The analyser was
 * modelling a project that does not exist.
 *
 * That is the same class of defect as every blocker this remediation closed —
 * the checker disagreeing with the build — merely pointing the other way. It
 * happened not to be an active bypass, because inventing EXTRA resolutions can
 * only add edges. But "strictly more edges" is not a property anyone verified,
 * and an analyser whose resolution semantics differ from the project's is one
 * `exports` map away from being wrong in the direction that matters.
 *
 * The rule is now unconditional: architecture resolution uses the effective
 * options of the real TypeScript project and nothing else. A project that sets
 * `customConditions` keeps them; a project that sets none gets none, exactly as
 * `tsc -p` behaves. Next's own server/client condition behaviour is proven
 * where it is real — the Next build in `npm run check:server-only`.
 */

/**
 * Resolves one specifier from one importing file.
 *
 * Returns a discriminated result:
 *   - `{ kind: 'file' }`       — a real file inside this repository
 *   - `{ kind: 'external' }`   — a package outside the repository
 *   - `{ kind: 'unresolved' }` — statically named, not resolvable on disk
 *   - `{ kind: 'error' }`      — the governing tsconfig could not be understood
 *
 * `isDeclaration` is reported rather than used to DROP the result. A `.d.ts`
 * target is a genuine compile-time architectural dependency (B3); the graph
 * decides what to do with it, and previously the resolver decided for it by
 * discarding the edge.
 *
 * Options come from the TypeScript PROJECT that compiles `importingFile` — the
 * project the workspace's own `tsc -p` command builds — never from whichever
 * `tsconfig.json` happens to sit nearest on disk. Review #4 broke the latter by
 * dropping an unreferenced config beside a source file; see `./tsconfig.mjs`.
 */
export function resolveSpecifier(
  specifier,
  importingFile,
  { workspacePackages = null, projectIndex = null } = {},
) {
  let options;
  let configPath;
  let unowned;
  let ownership;

  try {
    const effective = effectiveOptionsFor(importingFile, { projectIndex });
    options = effective.options;
    configPath = effective.configPath;
    unowned = effective.unowned;
    // 'root' (a declared project input) or 'closure' (a module the project's
    // Program loaded by following an import). Carried through so a diagnostic
    // can say WHICH project governs a file no `include` names.
    ownership = effective.ownership;
  } catch (error) {
    // A configuration the analyser cannot read must not silently degrade into
    // permissive defaults — that is a workspace leaving enforcement quietly.
    return {
      kind: 'error',
      specifier,
      message: error.message,
      configPath: error.configPath ?? null,
    };
  }

  const { host } = createResolutionHost(workspacePackages);

  const resolved = ts.resolveModuleName(
    specifier,
    importingFile,
    options,
    host,
    /* cache */ undefined,
    /* redirectedReference */ undefined,
    ts.ModuleKind.ESNext,
  );

  const resolvedFileName = resolved.resolvedModule?.resolvedFileName;

  // A bare specifier naming no known workspace and resolving nowhere is an
  // ordinary third-party package. A RELATIVE specifier that resolves nowhere is
  // a broken import and is reported as such rather than mistaken for a package.
  if (resolvedFileName === undefined) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return { kind: 'unresolved', specifier, configPath, unowned, ownership };
    }

    const packageName = packageNameOf(specifier);

    // A specifier naming a KNOWN workspace that does not resolve is a workspace
    // reference with a bad subpath, not a third-party dependency. Classifying it
    // as external would let an unknown workspace look harmless.
    if (
      workspacePackages !== null &&
      isWorkspaceSpecifier(specifier, workspacePackages)
    ) {
      return {
        kind: 'unresolved',
        specifier,
        viaWorkspace: packageName,
        configPath,
        unowned,
        ownership,
      };
    }

    return { kind: 'external', specifier, packageName, configPath, unowned, ownership };
  }

  const canonical = canonicalise(resolvedFileName);
  const relative = toRepoRelative(canonical);

  // Outside the repository is a genuine third-party dependency.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      kind: 'external',
      specifier,
      packageName: packageNameOf(specifier),
      configPath,
      unowned,
      ownership,
    };
  }

  // Inside `node_modules` after canonicalisation is likewise third-party. An
  // npm-linked WORKSPACE resolves out of node_modules by realpath, into
  // `packages/…`, so it is not caught here — which is what keeps workspace
  // dependencies and workspace cycles visible.
  if (relative.split('/').includes('node_modules')) {
    return {
      kind: 'external',
      specifier,
      packageName: packageNameOf(specifier),
      configPath,
      unowned,
      ownership,
    };
  }

  return {
    kind: 'file',
    specifier,
    absolute: canonical,
    relative,
    isDeclaration: canonical.endsWith('.d.ts'),
    viaWorkspace: workspaceOwning(specifier, workspacePackages),
    configPath,
    unowned,
    ownership,
  };
}

/** Does this specifier name one of the discovered workspace packages? */
function isWorkspaceSpecifier(specifier, workspacePackages) {
  return workspaceOwning(specifier, workspacePackages) !== null;
}

/** The workspace package a bare specifier names, or `null`. */
function workspaceOwning(specifier, workspacePackages) {
  if (workspacePackages === null) return null;

  for (const name of Object.keys(workspacePackages)) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return name;
  }

  return null;
}

/** The package name portion of a bare specifier, scope included. */
export function packageNameOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return specifier;

  const segments = specifier.split('/');

  if (specifier.startsWith('@')) return segments.slice(0, 2).join('/');
  if (specifier.startsWith('node:')) return specifier;

  return segments[0] ?? specifier;
}

export { ts };
