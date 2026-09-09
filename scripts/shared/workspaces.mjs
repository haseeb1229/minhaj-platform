/**
 * Workspace and source-root discovery.
 *
 * Shared by the architecture analyser and the RTL scanner so neither carries
 * its own hard-coded list of packages. A workspace added later —
 * `packages/database`, `packages/ui`, `apps/realtime` — enters validation the
 * moment it exists, without anyone remembering to edit a checker.
 *
 * Nothing here invents a future workspace. It reads the `workspaces` globs from
 * the root `package.json` and reports what is genuinely present on disk.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/**
 * A CONVENIENCE skip list for tooling traversal. NOT a security control.
 *
 * Review #7 (B1) — read this before using it anywhere new.
 *
 * These are directory BASENAMES, and a basename is chosen by whoever writes the
 * code. The architecture analyser's source walk used to consult this set and
 * was bypassed exactly as you would expect: authored `src/dist/rogue.js`,
 * `src/build/rogue.jsx` and `src/coverage/rogue.js` under `allowJs: false` are
 * invisible to every TypeScript Program (so real `tsc` exits 0) and were also
 * skipped by the walk, which switched `production-must-be-typescript` off for
 * anyone willing to name a directory `dist`.
 *
 * That walk no longer uses this set. It descends everywhere except CANONICAL
 * generated roots — a real `node_modules`, a real Next `.next`, a project's
 * configured `outDir`/`declarationDir` — identified by path identity rather
 * than by spelling (`scripts/architecture/graph.mjs`).
 *
 * Review #8 (B8-1) then closed the last enforcement use. Round 7 left this set
 * powering the RTL scanner's traversal, reasoning that skipping a directory
 * there costs only a missed STYLE convention. That reasoning was wrong, and
 * Review #8 demonstrated it in one file:
 *
 *     apps/app/src/dist/bad.tsx
 *     export const physicalDirectionStyle = { borderLeftWidth: 1 };
 *
 * `check:rtl` checked ZERO files, ESLint ignored the path by glob, and an RTL
 * violation shipped undiagnosed — while a direct scan of that directory
 * reported it correctly. A missed RTL violation silently breaks Urdu and
 * Arabic, which is not a lesser class of defect; and "covered by another gate"
 * was never true, because the other gate does not check RTL.
 *
 * The RTL scanner now uses the shared canonical policy in
 * `shared/generated-roots.mjs`, which is where every gate's generated-output
 * decision belongs.
 *
 * ONE consumer remains, and it is not an enforcement path: workspace-glob
 * expansion, which additionally requires a `package.json` to match, so a
 * skipped directory is one that declares no workspace.
 *
 * Do not reintroduce it anywhere else. If a gate needs to exclude build
 * output, it calls `shared/generated-roots.mjs`.
 */
export const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
]);

/**
 * A workspace directory the analyser matched but could not understand.
 *
 * Review #3 (N6): a directory matching the root workspace glob whose
 * `package.json` was malformed, unreadable, or nameless simply VANISHED from
 * discovery. A workspace that disappears from enforcement is worse than one
 * that fails it — the failure is at least visible.
 *
 * These are surfaced as architecture violations by `rules.mjs` rather than
 * thrown here, so one broken manifest reports a clear diagnostic instead of
 * aborting the whole run.
 */
export class WorkspaceManifestError extends Error {
  constructor(message, { directory }) {
    super(message);
    this.name = 'WorkspaceManifestError';
    this.directory = directory;
  }
}

/** Reads and parses a JSON file, returning `null` when absent or malformed. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Reads a workspace manifest, distinguishing "absent" from "broken".
 *
 * Returns `{ manifest }` on success or `{ error }` describing precisely what
 * could not be understood.
 */
function readWorkspaceManifest(directory) {
  const file = path.join(directory, 'package.json');
  const relative = path.relative(repoRoot, directory).split(path.sep).join('/');

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    return {
      error: new WorkspaceManifestError(
        `Workspace directory '${relative}' matches a root workspace pattern but ` +
          `its package.json could not be read: ${cause.message}. A matched ` +
          `workspace that cannot be understood must not disappear from ` +
          `architecture enforcement.`,
        { directory },
      ),
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (cause) {
    return {
      error: new WorkspaceManifestError(
        `Workspace '${relative}' has a malformed package.json: ${cause.message}. ` +
          `A matched workspace that cannot be parsed must not disappear from ` +
          `architecture enforcement.`,
        { directory },
      ),
    };
  }

  if (typeof manifest?.name !== 'string' || manifest.name === '') {
    return {
      error: new WorkspaceManifestError(
        `Workspace '${relative}' declares no package "name". Classification — ` +
          `Layer 0, prohibited infrastructure, or unclassified — is by package ` +
          `name, so a nameless workspace cannot be judged and must not be ` +
          `silently skipped.`,
        { directory },
      ),
    };
  }

  return { manifest };
}

/**
 * Expands one npm workspace glob.
 *
 * npm workspace globs are deliberately simple — `apps/*`, `packages/*`, or a
 * literal path. Supporting exactly that is correct here; a general glob engine
 * would be a dependency and a maintenance burden for no gain.
 */
function expandWorkspaceGlob(pattern, root = repoRoot) {
  const normalised = pattern.replaceAll('\\', '/');

  if (!normalised.includes('*')) {
    const candidate = path.join(root, normalised);
    return existsSync(path.join(candidate, 'package.json')) ? [candidate] : [];
  }

  const [prefix] = normalised.split('*');
  const parent = path.join(root, prefix);

  if (!existsSync(parent)) return [];

  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => path.join(parent, entry.name))
    .filter((directory) => existsSync(path.join(directory, 'package.json')));
}

/**
 * Workspaces whose content is BUILD TOOLING rather than production application
 * or domain source.
 *
 * `@minhaj/config` holds the shared ESLint, Prettier and TypeScript
 * configuration. Flat ESLint config is `.js` by necessity — it is loaded by
 * ESLint itself, not compiled by the application — so the TypeScript-only
 * production rule does not apply to it, and it ships in no bundle.
 *
 * This is a classification, not an exemption: the workspace is still walked,
 * still parsed, and still subject to every dependency and cycle rule. Only the
 * "production source must be TypeScript" rule is inapplicable, because this is
 * not production source.
 */
export const TOOLING_WORKSPACES = new Set(['@minhaj/config']);

/** Is this workspace build tooling rather than production source? */
export function isToolingWorkspace(workspace) {
  return TOOLING_WORKSPACES.has(workspace?.name);
}

/**
 * Every workspace currently present on disk.
 *
 * Returns `{ name, directory, manifest }`, where `name` is the package name the
 * workspace publishes under — the specifier other packages import it by.
 */
export function discoverWorkspaces(root = repoRoot) {
  const rootManifest = readJson(path.join(root, 'package.json'));
  const patterns = rootManifest?.workspaces ?? [];

  const workspaces = [];
  const problems = [];
  const seen = new Set();

  for (const pattern of patterns) {
    for (const directory of expandWorkspaceGlob(pattern, root)) {
      if (seen.has(directory)) continue;
      seen.add(directory);

      const { manifest, error } = readWorkspaceManifest(directory);

      if (error !== undefined) {
        problems.push(error);
        continue;
      }

      workspaces.push({ name: manifest.name, directory, manifest });
    }
  }

  workspaces.sort((a, b) => a.name.localeCompare(b.name));

  // Carried on the array rather than returned separately so every existing
  // caller keeps working while `rules.mjs` can still report them.
  Object.defineProperty(workspaces, 'problems', {
    value: Object.freeze(problems),
    enumerable: false,
  });

  return workspaces;
}

/** Manifest problems recorded during discovery, if any. */
export function workspaceProblems(workspaces) {
  return workspaces?.problems ?? [];
}

/** Workspace package name → absolute directory. */
export function workspacePackageMap(workspaces = discoverWorkspaces()) {
  return Object.fromEntries(
    workspaces.map((workspace) => [workspace.name, workspace.directory]),
  );
}

/**
 * Conventional source directories inside a workspace, in preference order.
 *
 * `src/` is the convention across this repository. A workspace without one is
 * inspected at its root, minus the ignored directories, so a future workspace
 * that organises itself differently is still covered rather than skipped.
 */
const SOURCE_SUBDIRECTORIES = ['src', 'app'];

/**
 * Production source roots for one workspace.
 *
 * Configuration files at a workspace root (`next.config.ts`,
 * `postcss.config.mjs`) are build tooling, not production application source,
 * and are excluded when a `src/` directory exists.
 */
export function sourceRootsFor(workspace) {
  const roots = SOURCE_SUBDIRECTORIES.map((name) =>
    path.join(workspace.directory, name),
  ).filter((candidate) => existsSync(candidate) && statSync(candidate).isDirectory());

  return roots.length > 0 ? roots : [workspace.directory];
}

/**
 * Every production source root across every discovered workspace.
 *
 * This is what the architecture analyser and the RTL scanner walk. Because it
 * derives from the workspace list, a new workspace is covered automatically.
 */
export function discoverSourceRoots(workspaces = discoverWorkspaces()) {
  return workspaces.flatMap(sourceRootsFor);
}
