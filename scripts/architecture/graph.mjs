/**
 * Resolved production module graph.
 *
 * One graph over every discovered workspace, built from real AST parsing and
 * real module resolution, keyed by canonical (realpath) file identity. Every
 * later analysis — context edges, cycles, client reachability — reads this one
 * structure, so all of them agree about what depends on what.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  generatedRootOf,
  generatedRootsFor,
  isUnderGeneratedRoot,
} from '../shared/generated-roots.mjs';
import {
  discoverWorkspaces,
  isToolingWorkspace,
  repoRoot,
  sourceRootsFor,
  workspacePackageMap,
  workspaceProblems,
} from '../shared/workspaces.mjs';
import { extractModuleSpecifiers, hasUseClientDirective } from './parser.mjs';
import {
  canonicalise,
  createWorkspaceRedirect,
  resolveSpecifier,
  toRepoRelative,
} from './resolver.mjs';
import { buildProjectIndex, projectMembershipKey } from './tsconfig.mjs';

/** Extensions carrying production source. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

/**
 * The one Next-generated declaration file, recognised by CANONICAL PATH.
 *
 * Review #4 (B2) broke the previous rule, which excluded any file whose
 * BASENAME was `next-env.d.ts`. A declaration barrel planted at
 * `src/shared/next-env.d.ts` re-exported a Quran internal, Messaging imported
 * through it, `tsc` passed, and the node simply vanished from the graph —
 * no violation, because the analyser had been told to look away by filename.
 *
 * A basename is attacker-controlled and carries no authority. Excluding on one
 * is a filename-based security control, which is to say not a control at all.
 *
 * The exclusion is now anchored to identity, not spelling: the file must sit at
 * the ROOT of a workspace that is genuinely the Next application — one whose
 * manifest depends on `next` — which is the only place Next ever writes it.
 * `src/next-env.d.ts`, `shared/next-env.d.ts`, `contexts/.../next-env.d.ts` and
 * `packages/.../next-env.d.ts` are ordinary repository-local declarations and
 * stay in the graph, subject to every rule.
 */
const NEXT_GENERATED_DECLARATION = 'next-env.d.ts';

/**
 * Is this the genuine Next-generated root declaration for a Next workspace?
 *
 * Both halves are required. The file must be exactly `<workspace>/next-env.d.ts`
 * — not merely inside the workspace — and the workspace must actually be a Next
 * application, proven by its own manifest rather than by its path.
 */
function isGeneratedNextDeclaration(file, workspace) {
  if (path.basename(file) !== NEXT_GENERATED_DECLARATION) return false;
  if (workspace === null || workspace === undefined) return false;

  const manifest = workspace.manifest ?? {};
  const dependsOnNext =
    manifest.dependencies?.next !== undefined ||
    manifest.devDependencies?.next !== undefined;

  if (!dependsOnNext) return false;

  return (
    canonicalise(path.join(workspace.directory, NEXT_GENERATED_DECLARATION)) ===
    canonicalise(file)
  );
}

/** Files that are build tooling rather than production application source. */
const TOOLING_FILENAMES = new Set([
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'postcss.config.mjs',
  'postcss.config.js',
  'tailwind.config.ts',
  'vitest.config.ts',
  'eslint.config.js',
  'prettier.config.js',
]);

/**
 * Recursively collects source files beneath a root.
 *
 * `workspace` is the workspace owning the root, needed to recognise the genuine
 * Next-generated declaration by identity rather than by filename.
 *
 * `generatedRoots` is the ONE canonical generated-root list (§5). It is the
 * only thing permitted to stop the walk descending.
 *
 * WHY THE WALK IS AUTHORITATIVE — Review #7 (B1)
 * ----------------------------------------------
 * The previous version skipped any directory whose BASENAME appeared in
 * `IGNORED_DIRECTORIES` — `dist`, `build`, `coverage`, `.turbo` — and defended
 * it as a mere performance shortcut on the grounds that the Program closure and
 * the recursive worklist would find anything real. That defence holds for
 * TypeScript and for nothing else. Review #7 planted:
 *
 *     src/dist/rogue.js        src/build/rogue.jsx
 *     src/coverage/rogue.js    src/features/dist/rogue.jsx
 *
 * under `allowJs: false`. No Program loads a `.js` file when `allowJs` is off,
 * so the closure never mentions them; nothing imports them, so the worklist
 * never reaches them; real `tsc` exits 0 because TypeScript ignores them
 * entirely. Every other discovery path is blind to authored JavaScript BY
 * CONSTRUCTION, which makes this walk the sole mechanism behind
 * `production-must-be-typescript` — and a basename someone chose was switching
 * that rule off (§4).
 *
 * So the walk now descends everywhere except genuine generated roots, which are
 * identified by CANONICAL PATH: a real `node_modules`, a real Next `.next`, a
 * project's configured `outDir`/`declarationDir`. `IGNORED_DIRECTORIES` is no
 * longer consulted here and carries no security meaning (§5).
 */
export function collectSourceFiles(root, workspace = null, generatedRoots = []) {
  const files = [];

  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const child = path.join(directory, entry.name);

        // Git's object store is not a filesystem the analyser has any business
        // descending into: it holds no authored source, and no `.js` inside it
        // is a production file anyone can import. This is not a security
        // exclusion — nothing there is reachable production source — and it is
        // deliberately the ONLY name-based skip left (§5).
        if (entry.name === '.git') continue;

        // The only OTHER permitted skip, and it is an identity test rather
        // than a name test (§5). `src/dist/` is walked; a configured `outDir`
        // is not.
        if (isUnderGeneratedRoot(child, generatedRoots)) continue;

        walk(child);
        continue;
      }

      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (TOOLING_FILENAMES.has(entry.name)) continue;

      // Repository-local `.d.ts` files ARE walked (B3). Review #3 imported
      // `../quran/secret` where the target was `secret.d.ts`; TypeScript
      // resolved it and the analyser then discarded it, so a real cross-context
      // dependency was invisible. A declaration-only dependency is still a
      // compile-time architectural dependency.
      //
      // The ONE Next-generated root declaration is skipped, by canonical path
      // and only for the real Next workspace (B2). Every other declaration —
      // whatever it is named — stays.
      const candidate = path.join(directory, entry.name);
      if (isGeneratedNextDeclaration(candidate, workspace)) continue;

      files.push(candidate);
    }
  };

  if (existsSync(root) && statSync(root).isDirectory()) walk(root);

  return files.sort();
}

/**
 * Is a repository-local path one the graph should carry as a node?
 *
 * Source and declaration extensions only, and never a tooling config file. The
 * Program closure can legitimately contain `.json` (under `resolveJsonModule`)
 * and TypeScript's own libs; neither is an architecture node.
 */
function isGraphCandidate(file) {
  if (TOOLING_FILENAMES.has(path.basename(file))) return false;
  return SOURCE_EXTENSIONS.has(path.extname(file));
}

/**
 * GENERATED-OUTPUT POLICY — `shared/generated-roots.mjs`.
 *
 * `generatedRootsFor`, `isUnderGeneratedRoot` and `generatedRootOf` used to be
 * defined here. Regression B8-1 showed why they must not be: the RTL
 * scanner kept its OWN basename skip list, so `src/dist/bad.tsx` — authored
 * source this analyser correctly includes — was invisible to `check:rtl` and to
 * ESLint, and a physical-direction inline style shipped undiagnosed.
 *
 * One principle enforced in one gate and not the others is a coincidence, not a
 * principle. The policy now lives in one shared module that every gate imports,
 * so a second, weaker copy cannot drift into existence again.
 */

/** The workspace whose directory contains a file, longest match winning. */
function workspaceContaining(file, workspaces) {
  let best = null;
  let bestLength = -1;

  for (const workspace of workspaces) {
    const directory = canonicalise(workspace.directory);
    const relative = path.relative(directory, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;

    if (directory.length > bestLength) {
      best = workspace;
      bestLength = directory.length;
    }
  }

  return best;
}

/**
 * Builds the resolved graph.
 *
 * `workspaces` and `roots` are injectable so tests can point the analyser at a
 * fixture tree using exactly the production code path.
 *
 * WHAT SEEDS THE GRAPH — Review #5 (B2)
 * -------------------------------------
 * Three sources, unioned, because no single one of them is complete:
 *
 *   1. THE TYPESCRIPT PROGRAM CLOSURE, which is authoritative. Every
 *      repository-local file any project's real `ts.Program` loaded is a node.
 *      Review #5 planted a declaration at a workspace ROOT — `next-env.d.ts` in
 *      a workspace that is not a Next app, and again as an ordinary
 *      `types.d.ts` — which re-exported a Quran internal. `tsc -p` compiled it;
 *      the analyser walked `src/` by preference and never saw it, so the
 *      laundered edge vanished. Directory preference is a discovery
 *      convenience and was never an authority on what TypeScript compiles.
 *
 *   2. THE DIRECTORY WALK, which is AUTHORITATIVE for what no Program can
 *      contain: rogue `.js`/`.jsx` production files (a TypeScript project
 *      excludes them by definition — under `allowJs: false` no Program loads
 *      one and real `tsc` exits 0 — yet `production-must-be-typescript` must
 *      still fire), and files in a workspace that declares no project at all.
 *
 *      Review #7 (B1): because this is the ONLY path that can see authored
 *      JavaScript, the walk may not skip a directory for being NAMED `dist`,
 *      `build` or `coverage`. It descends everywhere but canonical generated
 *      roots — see `collectSourceFiles`.
 *
 *   3. RECURSIVE RESOLVED TARGETS (§10). Any repository-local file an analysed
 *      module resolves to is enqueued, whatever directory it lives in. A local
 *      dependency must never be treated like an external package merely
 *      because discovery did not seed it; that is how a node disappears while
 *      the edge into it stays real.
 */
export function buildGraph({ workspaces = discoverWorkspaces(), roots = null } = {}) {
  /** Canonical absolute path → node. */
  const nodes = new Map();

  /** Package name -> directory, so a workspace specifier resolves to source. */
  const workspacePackages = workspacePackageMap(workspaces);

  /** Which workspace a source root belongs to. */
  const rootOwners = [];

  for (const workspace of workspaces) {
    for (const sourceRoot of sourceRootsFor(workspace)) {
      rootOwners.push({ sourceRoot: canonicalise(sourceRoot), workspace });
    }
  }

  const targetRoots =
    roots ?? rootOwners.map((owner) => ({ root: owner.sourceRoot, owner }));

  const resolvedTargets =
    roots === null
      ? targetRoots
      : roots.map((root) => {
          const canonical = canonicalise(root);
          const owner =
            rootOwners.find((candidate) => canonical.startsWith(candidate.sourceRoot)) ??
            null;
          return { root: canonical, owner };
        });

  // The TypeScript PROJECT index: which project compiles which file, with what
  // options, and — since Round 5 — the complete repository-local Program
  // closure of every project. Built once from the workspaces' own declared
  // `tsc -p` targets, so the analyser resolves exactly as the build does (B1).
  //
  // The workspace redirect is handed in so a Program in an isolated fixture
  // tree resolves that tree's own packages, exactly as the resolver does.
  const projectIndex = buildProjectIndex(
    workspaces,
    createWorkspaceRedirect(workspacePackages),
  );

  // ONE canonical generated-root list, computed once and consumed by BOTH the
  // Program seed and the recursive worklist (§20). Two separate implementations
  // are exactly how a file ends up seeded by one path and dropped by the other.
  const generatedRoots = generatedRootsFor(
    workspaces,
    projectIndex.configuredOutputRoots,
  );

  /**
   * Files awaiting analysis: `{ file, workspace }`.
   *
   * A worklist rather than a loop over a fixed list, because analysing a file
   * can reveal further repository-local files (§10).
   */
  const queue = [];
  const queued = new Set();

  const enqueue = (file, workspace) => {
    const absolute = canonicalise(file);
    if (queued.has(absolute)) return;
    if (!isGraphCandidate(absolute)) return;
    queued.add(absolute);
    queue.push({ absolute, workspace: workspace ?? null });
  };

  // ---- Seed 1: the directory walk ---------------------------------------
  for (const { root, owner } of resolvedTargets) {
    for (const file of collectSourceFiles(
      root,
      owner?.workspace ?? null,
      generatedRoots,
    )) {
      enqueue(file, owner?.workspace ?? null);
    }
  }

  // ---- Seed 2: the Program closure, authoritative -----------------------
  //
  // Restricted to files inside the workspaces UNDER ANALYSIS. A fixture tree
  // that imports the real `packages/server-core` legitimately pulls that
  // package's sources into its Program; seeding them would drag the production
  // repository into a fixture's result set and report findings against files
  // the fixture never claimed to check. They remain reachable as EDGE targets
  // through seed 3, which is where a genuine cross-tree dependency belongs.
  const analysedWorkspaces =
    roots === null
      ? workspaces
      : workspaces.filter((workspace) =>
          resolvedTargets.some(({ root }) =>
            canonicalise(root).startsWith(canonicalise(workspace.directory)),
          ),
        );

  const analysedRoots = analysedWorkspaces.map((workspace) =>
    path.dirname(path.dirname(canonicalise(workspace.directory))),
  );

  for (const file of projectIndex.programFiles) {
    const canonical = canonicalise(file);

    // Inside the tree under analysis, whether or not it sits inside a
    // workspace DIRECTORY. A module shared between two workspaces — beside
    // `apps/` rather than within it — is compiled by both and belongs in the
    // graph; requiring a containing workspace would drop it silently.
    if (!analysedRoots.some((root) => canonical.startsWith(root))) continue;

    // GENERATED OUTPUT is not architecture. `apps/web/.next/types/*.d.ts` is
    // written by `next build` and genuinely enters the app's Program, so the
    // closure reports it — but it is a build artefact, not authored source,
    // and it exists only on a machine that has run a build. Including it made
    // the analyser's own file count differ between a developer's working tree
    // and a clean CI checkout, which is the kind of drift that turns a gate
    // into a coin flip (§28).
    //
    // Filtered by CANONICAL ROOT, never by directory name (§13, B2): Program
    // membership is strong evidence that TypeScript genuinely compiles a file
    // (§14), so only a file actually inside a configured output root — a real
    // `.next`, a real `node_modules`, a configured `outDir` — is discarded.
    if (isUnderGeneratedRoot(canonical, generatedRoots)) continue;

    const workspace = workspaceContaining(canonical, analysedWorkspaces);

    // The ONE genuine generated Next declaration stays out, by canonical path
    // and only for a real Next workspace (§11). Every other declaration —
    // whatever it is named, wherever it sits — is an ordinary node.
    if (workspace !== null && isGeneratedNextDeclaration(canonical, workspace)) continue;

    enqueue(file, workspace);
  }

  // ---- Analysis, with seed 3 folded in ----------------------------------
  while (queue.length > 0) {
    const { absolute, workspace } = queue.shift();
    if (nodes.has(absolute)) continue;

    // A file the Program closure named may sit outside every source root, so
    // its workspace is resolved by containment when discovery did not supply
    // one. A node with no workspace escapes classification entirely, which is
    // the "unknown treated as harmless" failure this gate exists to prevent.
    const owningWorkspace = workspace ?? workspaceContaining(absolute, workspaces);

    // Resolution uses the options of the project that ACTUALLY COMPILES this
    // file — the one the workspace's `tsc -p` command builds, including files
    // that project loaded through an import rather than through `include`
    // (B1). Nothing about the workspace's aliases is assumed here; the
    // resolver reads them from that project.
    const imports = extractModuleSpecifiers(absolute).map((entry) => {
      const resolved = resolveSpecifier(entry.specifier, absolute, {
        workspacePackages,
        projectIndex,
      });

      // ---- An authored edge INTO generated output (§12, B3) -------------
      //
      // Excluding generated output from SEEDING is right: `.next/types/*.d.ts`
      // and a configured `outDir` are build artefacts, they exist only on a
      // machine that has run a build, and treating them as authored source is
      // what made the analyser's own file count differ between a clean checkout
      // and a built tree.
      //
      // Silently excluding it as an edge TARGET is a different thing entirely,
      // and Review #7 walked through the gap. Messaging declared:
      //
      //     export { … } from '../../../dist/barrel.js';
      //
      // TypeScript resolved that to `dist/barrel.d.ts` — the project's own
      // configured `outDir` — where the emitted declaration re-exports a Quran
      // internal. Real `tsc` succeeds. The analyser resolved the target
      // correctly, dropped it for living under a generated root, and reported
      // NOTHING: a genuine cross-context dependency erased by the very rule
      // meant to keep build artefacts out.
      //
      // So the target is still not seeded — generated output never becomes
      // authoritative production source (§16) — but the EDGE is recorded here
      // and reported by `rules.mjs` as `source-imports-generated-output`. An
      // authored source module reaching into generated output fails closed.
      const generatedRoot =
        resolved.kind === 'file'
          ? generatedRootOf(resolved.absolute, generatedRoots)
          : null;

      return {
        ...entry,
        resolved,
        // Repository-relative so the diagnostic reads the same on Windows and
        // Linux and never leaks an absolute machine path (§26).
        generatedRoot: generatedRoot === null ? null : toRepoRelative(generatedRoot),
        generatedTarget:
          generatedRoot === null ? null : toRepoRelative(resolved.absolute),
      };
    });

    const isDeclaration = absolute.endsWith('.d.ts');
    const membershipKey = projectMembershipKey(absolute);

    nodes.set(absolute, {
      absolute,
      relative: toRepoRelative(absolute),
      workspace: owningWorkspace,
      isTooling: isToolingWorkspace(owningWorkspace),
      extension: isDeclaration ? '.d.ts' : path.extname(absolute),
      isDeclaration,
      isClientEntry: hasUseClientDirective(absolute),
      // No TypeScript project compiles this file — neither as a declared input
      // nor anywhere in any project's Program closure. Its imports were
      // resolved without any project's `paths`/`baseUrl`, so the analyser
      // cannot claim to reproduce the build for it; reported by `rules.mjs`
      // rather than passed silently (B1 §3.3).
      unownedByProject: !projectIndex.membership.has(membershipKey),
      // Two independent projects compile this file with materially different
      // resolution options, so its imports genuinely mean different things
      // depending on which build is running. There is no right answer and the
      // gate fails closed (§6).
      ambiguousOwnership: projectIndex.ambiguous.get(membershipKey) ?? null,
      // The workspace's own project configuration could not be parsed, so
      // NOTHING about this file's resolution can be reproduced. Distinct from
      // "no project includes it": here the project exists and is broken.
      projectUnreadable: projectIndex.problems.some(
        (problem) => problem.workspaceName === (owningWorkspace?.name ?? null),
      ),
      imports,
    });

    // ---- Seed 3: every repository-local target this file resolves -------
    //
    // Fail closed (§10). A resolved local module either becomes a node with
    // its own project identity, or — when no project owns it — becomes a node
    // that `rules.mjs` reports as outside project ownership. What it must
    // never do is vanish because source discovery did not reach its directory.
    for (const entry of imports) {
      if (entry.resolved.kind !== 'file') continue;

      const target = entry.resolved.absolute;
      if (nodes.has(target) || queued.has(target)) continue;
      // Same canonical predicate as the Program seed (§20) — a resolved local
      // target is dropped only when it genuinely lives under generated output,
      // never because an ancestor directory is spelled `dist` or `build`.
      //
      // NOT seeded, but NOT silent either: the edge was recorded above as
      // `generatedRoot` and `rules.mjs` reports it (B3). Generated output stays
      // out of the graph as a NODE (§16) while the authored import into it
      // still fails closed.
      if (entry.generatedRoot !== null) continue;

      // A resolved repository-local target is enqueued whether or not a
      // workspace DIRECTORY contains it (§10). It resolved to a real file
      // inside this repository, so it is a real dependency; dropping it for
      // sitting outside `apps/`/`packages/` would let a shared module hold an
      // edge the graph cannot see — the exact shape of B2.
      const targetWorkspace = workspaceContaining(target, workspaces);
      if (targetWorkspace !== null && isGeneratedNextDeclaration(target, targetWorkspace))
        continue;

      enqueue(target, targetWorkspace);
    }
  }

  return {
    nodes,
    workspaces,
    workspaceProblems: workspaceProblems(workspaces),
    projectProblems: projectIndex.problems,
    projects: projectIndex.projects,
    repoRoot,
  };
}

/**
 * Adjacency over canonical file paths, restricted to edges landing on files
 * the graph actually contains.
 *
 * A resolved file outside the walked roots (a declaration file, a tooling
 * module) is a real edge but not a node, so it is not traversable; including
 * it would produce dangling keys and confusing cycle reports.
 */
export function fileAdjacency(graph) {
  const adjacency = new Map();

  for (const [absolute, node] of graph.nodes) {
    const targets = [];

    for (const entry of node.imports) {
      if (entry.resolved.kind !== 'file') continue;
      if (!graph.nodes.has(entry.resolved.absolute)) continue;

      targets.push({ to: entry.resolved.absolute, via: entry });
    }

    adjacency.set(absolute, targets);
  }

  return adjacency;
}

/**
 * Every simple cycle in the file graph, reported once each.
 *
 * Because workspace packages resolve through `realpath` into their own source
 * files, a package-level cycle appears here as a file cycle crossing workspace
 * boundaries — which is what makes workspace cycles detectable at all.
 */
export function findCycles(graph) {
  const adjacency = fileAdjacency(graph);
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const reported = new Set();

  const walk = (node, trail) => {
    if (visiting.has(node)) {
      const start = trail.indexOf(node);
      if (start === -1) return;

      const cyclePath = [...trail.slice(start), node];
      // Canonical key so the same cycle found from different entry points is
      // reported once.
      const key = [...cyclePath].slice(0, -1).sort().join('|');
      if (reported.has(key)) return;
      reported.add(key);

      cycles.push(cyclePath.map((entry) => graph.nodes.get(entry)?.relative ?? entry));
      return;
    }

    if (visited.has(node)) return;

    visiting.add(node);
    for (const { to } of adjacency.get(node) ?? []) walk(to, [...trail, node]);
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of graph.nodes.keys()) walk(node, []);

  return cycles;
}
