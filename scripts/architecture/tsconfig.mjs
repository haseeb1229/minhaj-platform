/**
 * TypeScript PROJECT discovery — the configuration that actually compiles a
 * source file.
 *
 * WHY THIS EXISTS
 * ---------------
 * Review #3 defeated the analyser with a workspace that declared its own alias:
 *
 *     { "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./src/*"] } } }
 *
 * so `import '~/contexts/quran'` from inside Messaging resolved for TypeScript
 * and for the build, but not for the checker — which understood exactly one
 * mapping, `@/*`, because that mapping had been hard-coded. The rule adopted in
 * response was: THE ANALYSER RESOLVES WHAT THE WORKSPACE'S OWN COMPILER
 * RESOLVES, read through the official TypeScript config APIs.
 *
 * That rule was right. Its IMPLEMENTATION was not. Round 3 selected the config
 * by NEAREST-UPWARD search, and Review #4 broke that in one move:
 *
 *     apps/app/tsconfig.json                  ~/* -> ./src/*        (the real project)
 *     apps/app/src/contexts/messaging/tsconfig.json
 *                                             ~/contexts/quran -> learning/index.ts
 *
 * Nothing selects that nested file. `npm run typecheck` runs
 * `tsc --noEmit -p tsconfig.json` at the WORKSPACE ROOT, and `tsc -p` resolves
 * `~/contexts/quran` to `contexts/quran/index.ts` — a forbidden
 * Messaging -> Quran edge. The analyser, searching upward from the importing
 * file, found the nested config first, resolved to Learning, and reported
 * nothing. An attacker needed only to drop a `tsconfig.json` beside their code.
 *
 * The defect is not "which upward file wins". It is that PROXIMITY was treated
 * as authority. A tsconfig governs a file because a PROJECT includes that file,
 * never because it sits nearby.
 *
 * WHAT REPLACES IT
 * ----------------
 * A project model:
 *
 *     workspace  ->  its declared project tsconfig  ->  parsed project
 *                ->  the file set that project compiles
 *                ->  the compiler options those files are compiled with
 *
 * Membership is computed by TypeScript itself. `ts.parseJsonConfigFileContent`
 * expands `files`, `include` and `exclude` into the exact ROOT list `tsc -p`
 * starts from, and `ts.resolveProjectReferencePath` walks `references` so a
 * genuinely referenced project governs its own sources. A file is governed by
 * the project that CLAIMS it; a config no project selects governs nothing.
 *
 * ROUND 5: THE ROOT LIST IS NOT THE PROGRAM
 * -----------------------------------------
 * Review #5 (B1) then broke the ROOT-LIST assumption. `fileNames` is where the
 * compiler STARTS, not what it compiles:
 *
 *     include: ["src/**\/*.ts"]      exclude: ["src/shared/**\/*"]
 *     src/contexts/messaging/index.ts   imports  ../../shared/barrel.d.ts
 *     src/shared/barrel.d.ts            imports  @/contexts/quran/internal
 *
 * `tsc -p` loads that excluded declaration anyway — an excluded file is only
 * excluded from ROOT DISCOVERY, never from the module closure — and resolves
 * its `@/*` alias with the project's own `paths`. The analyser called the file
 * "unowned", resolved it with alias-free fallback options, and the laundered
 * Messaging -> Quran-internal edge disappeared while `tsc` passed.
 *
 * So ownership is now taken from the real `ts.Program`. Each project is
 * instantiated once, `program.getSourceFiles()` is filtered to
 * repository-local files, and every one of them is owned by that project's
 * effective options. That set also SEEDS the graph (§9), which is what closes
 * B2: a module TypeScript genuinely compiles cannot be missing from the
 * architecture merely for living outside a preferred `src/` root.
 *
 * No option is reconstructed by hand, and no import closure is walked by hand.
 * Reimplementing TypeScript's own semantics is exactly the parallel system
 * Reviews #2, #3, #4 and #5 punished.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { discoverWorkspaces, repoRoot } from '../shared/workspaces.mjs';
import { extractModuleSpecifiers } from './parser.mjs';

/**
 * Diagnostic thrown when a workspace's TypeScript configuration cannot be read
 * or parsed.
 *
 * A configuration the analyser cannot understand must NOT degrade into
 * permissive defaults: that is how a workspace silently leaves enforcement.
 * The caller surfaces this as an architecture violation.
 */
export class TsconfigError extends Error {
  constructor(message, { configPath }) {
    super(message);
    this.name = 'TsconfigError';
    this.configPath = configPath;
  }
}

/** Cache keyed by resolved tsconfig path — parsing an extends chain is not free. */
const parsedConfigCache = new Map();

/**
 * A path in the form TypeScript uses internally: forward slashes, on every
 * platform.
 *
 * TypeScript normalises paths this way and ASSERTS on a mismatch. Passing a
 * Windows path straight to `parseJsonConfigFileContent` raised an internal
 * "Debug Failure" comparing the two spellings of the same path — so a genuinely
 * malformed tsconfig was reported with a message about separators instead of
 * about the malformed tsconfig. The rule still fired, but the diagnostic was
 * useless, and a diagnostic nobody can act on is most of the way to no
 * diagnostic at all.
 */
function toTsPath(filePath) {
  return filePath.split(path.sep).join('/');
}

/**
 * Repository-relative POSIX path, so a diagnostic reads the same on every
 * platform and a test can assert on it without branching.
 */
function relativeConfig(configPath) {
  return path.relative(repoRoot, configPath).split(path.sep).join('/');
}

/**
 * Filesystem identity used as a MAP KEY for project membership.
 *
 * Two spellings of one path must not become two members. On Windows the same
 * file arrives as `C:\…` from Node and `c:/…` from TypeScript, and on a
 * case-insensitive volume `Src` and `src` are one file. Keys are therefore
 * normalised to forward slashes, and lower-cased only where the platform's own
 * filesystem is case-insensitive — never on Linux, where `Src` and `src` are
 * genuinely two files and folding them would make the analyser see less than
 * the build does.
 */
function membershipKey(filePath) {
  const normalised = path.resolve(filePath).split(path.sep).join('/');
  return ts.sys.useCaseSensitiveFileNames ? normalised : normalised.toLowerCase();
}

/**
 * A TypeScript ParseConfigHost backed by the real filesystem.
 *
 * `ts.sys` already implements the interface; naming it makes the dependency
 * explicit and keeps the call sites readable.
 */
const parseConfigHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: ts.sys.readDirectory,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  getCurrentDirectory: () => repoRoot,
  trace: undefined,
};

/**
 * Reads and fully resolves one `tsconfig.json`.
 *
 * `ts.readConfigFile` parses JSONC; `ts.parseJsonConfigFileContent` walks the
 * `extends` chain, resolves relative `baseUrl`/`paths`/`outDir` against the
 * right config directory, expands `files`/`include`/`exclude` into the concrete
 * file list, and applies TypeScript's defaults. The result is the EFFECTIVE
 * project — the options the workspace compiles with and the files it compiles.
 *
 * Throws `TsconfigError` rather than falling back to defaults: an unreadable
 * configuration is a finding, never a licence to resolve permissively.
 */
export function readEffectiveConfig(configPath) {
  const cached = parsedConfigCache.get(configPath);
  if (cached !== undefined) {
    if (cached instanceof TsconfigError) throw cached;
    return cached;
  }

  const tsConfigPath = toTsPath(configPath);
  const readResult = ts.readConfigFile(tsConfigPath, ts.sys.readFile);

  if (readResult.error !== undefined) {
    const error = new TsconfigError(
      `Cannot read TypeScript configuration '${relativeConfig(configPath)}': ` +
        ts.flattenDiagnosticMessageText(readResult.error.messageText, ' '),
      { configPath },
    );
    parsedConfigCache.set(configPath, error);
    throw error;
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    parseConfigHost,
    toTsPath(path.dirname(configPath)),
    /* existingOptions */ undefined,
    tsConfigPath,
  );

  // Only CONFIGURATION errors matter here — a missing `include` match or an
  // unresolvable `extends` target means the analyser would resolve imports
  // differently from the build. Category-Error diagnostics from
  // `parseJsonConfigFileContent` are exactly those.
  //
  // TS18003 ("no inputs were found") is deliberately tolerated: an isolated
  // fixture workspace legitimately has no matching files at parse time, and it
  // says nothing about how specifiers resolve.
  const fatal = parsed.errors.filter(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code !== 18_003,
  );

  if (fatal.length > 0) {
    const error = new TsconfigError(
      `Invalid TypeScript configuration '${relativeConfig(configPath)}': ` +
        fatal
          .map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          )
          .join('; '),
      { configPath },
    );
    parsedConfigCache.set(configPath, error);
    throw error;
  }

  const result = Object.freeze({
    configPath,
    options: parsed.options,
    fileNames: parsed.fileNames,
    projectReferences: parsed.projectReferences ?? [],
  });

  parsedConfigCache.set(configPath, result);
  return result;
}

/**
 * The project tsconfig a workspace DECLARES, read from its own build scripts.
 *
 * The authority is the workspace's real `typecheck`/`build` command, because
 * that is what the repository actually runs and therefore what "the config that
 * compiles this file" means. Every workspace here runs:
 *
 *     tsc --noEmit -p tsconfig.json
 *
 * so the `-p` argument is parsed out rather than assumed. A workspace that
 * later points `-p` at `tsconfig.build.json` is then followed automatically,
 * and the analyser cannot drift from the build by omission.
 *
 * Falls back to `<workspace>/tsconfig.json` — the file `tsc -p` and `next build`
 * both default to — when no script names one explicitly.
 */
export function declaredProjectConfig(workspace) {
  const scripts = workspace?.manifest?.scripts ?? {};

  for (const key of ['typecheck', 'build']) {
    const command = scripts[key];
    if (typeof command !== 'string') continue;

    // `-p <path>` / `--project <path>`, in either spelling, with or without `=`.
    const match = command.match(/(?:-p|--project)[\s=]+("[^"]+"|'[^']+'|\S+)/u);
    if (match === null) continue;

    const declared = (match[1] ?? '').replace(/^["']|["']$/gu, '');
    if (declared === '') continue;

    const resolved = path.resolve(workspace.directory, declared);
    // `-p` accepts a directory, exactly as `tsc` does.
    const candidate =
      existsSync(resolved) && statSync(resolved).isDirectory()
        ? path.join(resolved, 'tsconfig.json')
        : resolved;

    if (existsSync(candidate)) return candidate;
  }

  const conventional = path.join(workspace.directory, 'tsconfig.json');
  return existsSync(conventional) ? conventional : null;
}

/**
 * Ownership strength, highest wins.
 *
 * Review #5 (B1) proved that a project's ROOT FILE LIST is not the set of files
 * the project compiles. `parseJsonConfigFileContent().fileNames` expands
 * `files`/`include`/`exclude` and stops there — but `tsc -p` then follows every
 * import out of those roots and compiles what it finds, `exclude`
 * notwithstanding. An excluded declaration imported by an included source is
 * loaded by the real compiler, with the real project's `paths`; the analyser
 * called it "unowned" and resolved its aliases with none, so a laundered
 * cross-context edge disappeared.
 *
 * So ownership now has two tiers rather than one:
 *
 *   ROOT    — the file is a declared input of the project (`files`/`include`).
 *   CLOSURE — the file is not an input, but the project's Program loaded it by
 *             following an import. `tsc -p` compiles it with THESE options.
 *
 * A ROOT claim outranks a CLOSURE claim ONLY BETWEEN RELATED PROJECTS: where
 * project A lists a file as an input and project B — which references A, or is
 * referenced by it — merely reaches it, A is the project that owns it, which is
 * what `tsc --build` compiles it with. Within a tier a REFERENCED CHILD is
 * visited first and claims before its parent.
 *
 * ROUND 6: STRENGTH IS NOT AUTHORITY OVER AN INDEPENDENT PROJECT
 * -------------------------------------------------------------
 * Review #6 (B1) broke the previous rule, which let a ROOT claim silently
 * discard ANY weaker claim — including one from a project with no relationship
 * to it whatsoever:
 *
 *     packages/contracts/tsconfig.json   ROOT     #target -> a safe file
 *     apps/web/tsconfig.json             CLOSURE  #target -> quran/internal.ts
 *
 * Both are real projects, both compile, and both genuinely load
 * `packages/contracts/src/contested.ts`. `tsc -p apps/web` resolves that file's
 * `#target` import to a Quran internal; the analyser took the Contracts claim
 * because it was ROOT, resolved `#target` to the safe file, and the forbidden
 * Messaging -> Quran edge was invisible in exactly the build that creates it.
 *
 * Ownership STRENGTH is useful metadata about which project declares a file. It
 * is not evidence that the other project's resolution does not happen. So the
 * compatibility check now runs BEFORE strength is allowed to decide, and
 * strength settles only what compatibility has already shown to be safe:
 *
 *   related projects (one references the other, directly or transitively)
 *     -> project-reference semantics apply; the stronger/child claim wins.
 *
 *   independent projects with equivalent resolution signatures
 *     -> harmless; both mean the same thing, so either may own the file.
 *
 *   independent projects with DIFFERENT resolution signatures
 *     -> no correct single answer exists; fail closed (§4A) and name both.
 */
const OWNERSHIP_ROOT = 2;
const OWNERSHIP_CLOSURE = 1;

/**
 * The options that decide WHERE A SPECIFIER POINTS.
 *
 * Two projects compiling one file is only a problem when they would resolve
 * its imports differently. This is the signature compared to decide that:
 * alias mappings, resolution mode, and the package-condition switches. Options
 * that affect type-CHECKING but not module MAPPING (`strict`, `target`, `lib`)
 * are deliberately absent — they cannot move an edge, and folding them in
 * would report ambiguity where none exists.
 */
function resolutionSignature(options) {
  return JSON.stringify({
    baseUrl: options.baseUrl === undefined ? null : toTsPath(options.baseUrl),
    paths: options.paths ?? null,
    moduleResolution: options.moduleResolution ?? null,
    module: options.module ?? null,
    customConditions: options.customConditions ?? null,
    resolvePackageJsonExports: options.resolvePackageJsonExports ?? null,
    resolvePackageJsonImports: options.resolvePackageJsonImports ?? null,
    rootDirs: options.rootDirs?.map(toTsPath) ?? null,
    typeRoots: options.typeRoots?.map(toTsPath) ?? null,
  });
}

/**
 * A minimal `ModuleResolutionHost` for the compatibility comparison.
 *
 * Resolution-only: it answers file/directory existence and reads, which is all
 * `ts.resolveModuleName` needs. The workspace `redirect` is applied so a
 * fixture tree's own packages resolve, matching `createProgramHost`.
 */
function createCompatibilityHost(redirect) {
  const map = (file) => (redirect === null ? file : redirect(file));

  return {
    fileExists: (file) => existsSync(map(file)),
    readFile: (file) => {
      try {
        return readFileSync(map(file), 'utf8');
      } catch {
        return undefined;
      }
    },
    directoryExists: (directory) => {
      const mapped = map(directory);
      return existsSync(mapped) && statSync(mapped).isDirectory();
    },
    realpath: (file) => map(file),
  };
}

/**
 * Does the difference between two option sets MATERIALLY affect THIS file?
 *
 * Signature equality is the fast path, but two configs can differ on paper and
 * still resolve one particular file identically — §6 warns against treating a
 * serialized-options mismatch as proof of ambiguity. `packages/contracts` is
 * the live example: `apps/web` adds `baseUrl` and an `@/*` alias that the
 * Contracts project does not declare, yet every Contracts source imports only
 * relative specifiers (`./shared.ts`) and bare packages (`zod`). No alias can
 * match any of them, so both projects resolve the file's imports to exactly the
 * same targets and there is nothing to be ambiguous about.
 *
 * So when signatures differ, the question is answered EMPIRICALLY, on the
 * file's real specifiers, using TypeScript's own resolver under each option
 * set. Only a specifier that genuinely lands somewhere different — or resolves
 * under one project and not the other — makes the projects incompatible.
 *
 * This is deliberately conservative in the fail-closed direction: anything that
 * cannot be read or resolved cleanly counts as a difference, so an unreadable
 * file is reported rather than waved through.
 */
function materiallyDifferentForFile(fileName, a, b, host) {
  if (resolutionSignature(a) === resolutionSignature(b)) return false;

  let specifiers;
  try {
    specifiers = specifiersForCompatibility(fileName);
  } catch {
    // Cannot prove equivalence, so do not assume it.
    return true;
  }

  // A file with no imports at all has no resolution to disagree about.
  if (specifiers.length === 0) return false;

  for (const specifier of specifiers) {
    const underA = resolveUnder(specifier, fileName, a, host);
    const underB = resolveUnder(specifier, fileName, b, host);

    if (underA !== underB) return true;
  }

  return false;
}

/**
 * Every module specifier a source file mentions.
 *
 * ONE AUTHORITATIVE EXTRACTOR — Review #7 (B2)
 * --------------------------------------------
 * This used to be a second, cut-down AST walk maintained here: it understood
 * `import`, `export … from`, dynamic `import()` and `require()`, and nothing
 * else. `parser.mjs` — the extractor the architecture GRAPH runs on — already
 * understood strictly more, and the gap between them was a bypass:
 *
 *     import target = require('#target');
 *
 * An `ImportEqualsDeclaration` is a real dependency that TypeScript resolves
 * through `paths` like any other. Review #7 gave two independent projects
 * conflicting `#target` mappings over one contested file whose ONLY dependency
 * was that form. Both projects compiled; the resolutions genuinely differed;
 * and this function reported a file with zero specifiers — so
 * `materiallyDifferentForFile` concluded there was nothing to disagree about
 * and the ROOT/CLOSURE ambiguity Round 6 closed reopened verbatim.
 *
 * Two extractors means the weaker one silently sets the security policy (§8).
 * There is now exactly one, shared with the graph, so any form the graph
 * learns to see participates in ownership compatibility automatically and
 * cannot drift back out.
 *
 * Cached: a contested file is asked about once per competing claim.
 *
 * Exported so the regression test can assert against the function ownership
 * analysis ACTUALLY calls. A test that re-parsed the snippets itself would
 * prove only that its own copy agrees with itself, which is precisely the
 * failure mode this fix removes.
 */
const specifierCache = new Map();

export function specifiersForCompatibility(fileName) {
  const cached = specifierCache.get(fileName);
  if (cached !== undefined) return cached;

  const specifiers = [
    ...new Set(extractModuleSpecifiers(fileName).map((entry) => entry.specifier)),
  ];

  specifierCache.set(fileName, specifiers);
  return specifiers;
}

/** Where one specifier lands under one option set, as a canonical key. */
function resolveUnder(specifier, containingFile, options, host) {
  try {
    const resolved = ts.resolveModuleName(
      specifier,
      toTsPath(containingFile),
      { ...options, allowJs: true, allowImportingTsExtensions: true },
      host,
    ).resolvedModule;

    return resolved === undefined
      ? '\u0000unresolved'
      : membershipKey(resolved.resolvedFileName);
  } catch {
    return '\u0000error';
  }
}

/**
 * Records `parent -> child` and keeps the relation TRANSITIVELY closed.
 *
 * A reference chain `A -> B -> C` makes C's sources governed deterministically
 * from A as well as from B, so storing only direct edges would report a false
 * ambiguity between A and C. Both directions are stored because the question
 * asked later — "are these two projects related at all?" — is symmetric; which
 * one is the parent is settled by ownership tier, not by this map.
 */
function recordReferenceEdge(related, parentKey, childKey) {
  const reach = (key) => {
    const existing = related.get(key);
    if (existing !== undefined) return existing;

    const created = new Set();
    related.set(key, created);
    return created;
  };

  const parentReach = reach(parentKey);
  const childReach = reach(childKey);

  // Everything the child already reaches becomes reachable from the parent,
  // and every project that already reaches the parent now reaches the child.
  const descendants = new Set([childKey, ...childReach]);

  for (const [key, reachable] of related) {
    if (key === parentKey || reachable.has(parentKey)) {
      for (const descendant of descendants) {
        if (descendant !== key) reachable.add(descendant);
      }
    }
  }

  for (const descendant of descendants) {
    if (descendant !== parentKey) parentReach.add(descendant);
  }

  // Keep the child's own record present even when it references nothing.
  void childReach;
}

/**
 * Are these two projects RELATED by an explicit project reference?
 *
 * `related` maps a project config path to every project reachable from it
 * through `references`, transitively, in both directions (see
 * `recordReferenceEdge`). A relationship means TypeScript itself defines whose
 * options govern a shared file — `tsc --build` compiles a referenced child's
 * sources as that child — so deterministic precedence between them is correct
 * rather than a guess (§5).
 *
 * Two projects with NO such relationship are independent. Neither one's build
 * knows the other exists, both genuinely happen, and neither can speak for the
 * other's resolution.
 */
function projectsAreRelated(related, a, b) {
  if (a === b) return true;
  return related.get(a)?.has(b) === true || related.get(b)?.has(a) === true;
}

/**
 * Records one project's claim over one file.
 *
 * Competition is settled by COMPATIBILITY FIRST and strength second (§4, §6).
 * Review #6 (B1) proved the reverse order hides a real edge: a ROOT claim was
 * allowed to discard an unrelated project's CLOSURE claim whose resolution
 * genuinely differed, so the analyser answered for a build that was not the one
 * introducing the violation.
 *
 * Ambiguity is RECORDED rather than thrown: one contested file must not abort
 * the whole run, and the caller reports it as an architecture violation
 * alongside everything else.
 */
function claimFile(membership, fileKey, parsed, strength, ambiguous, related, host) {
  const existing = membership.get(fileKey);

  if (existing === undefined) {
    membership.set(fileKey, { parsed, strength });
    return;
  }

  if (existing.parsed.configPath === parsed.configPath) return;

  // ---- Compatibility, BEFORE strength (§4) -----------------------------
  //
  // Two projects that would resolve this file's imports identically mean the
  // same thing by it, whatever tier each claimed it at. Nothing is contested,
  // so strength may settle which record is kept (§8). Judged on THIS FILE's
  // real specifiers, not on a serialized-options diff (§6).
  const compatible = !materiallyDifferentForFile(
    fileKey,
    existing.parsed.options,
    parsed.options,
    host,
  );

  // An explicit reference relationship is the ONE case where differing options
  // are still deterministic: TypeScript's own project-reference semantics say
  // whose options govern, and the referenced child's sources are compiled as
  // the child (§5). Ownership precedence below implements exactly that.
  const deterministic =
    compatible ||
    projectsAreRelated(related, existing.parsed.configPath, parsed.configPath);

  if (!deterministic) {
    // Independent projects, materially different module-resolution semantics.
    // Both builds genuinely happen and they disagree about what this file
    // imports, so no single answer is correct — fail closed and name both
    // (§4A). Recorded regardless of tier, so claim ORDER cannot change the
    // outcome (§10); the membership record is left as-is because the file is
    // reported rather than resolved.
    const recorded = ambiguous.get(fileKey) ?? new Set();
    recorded.add(existing.parsed.configPath);
    recorded.add(parsed.configPath);
    ambiguous.set(fileKey, recorded);
    return;
  }

  if (strength > existing.strength) {
    membership.set(fileKey, { parsed, strength });
  }
}

/**
 * Builds a TypeScript CompilerHost that can see workspace packages which have
 * no `node_modules` link.
 *
 * An isolated fixture tree has no npm links, so a workspace specifier would
 * not resolve and the Program's closure would stop at the workspace boundary —
 * hiding exactly the cross-package edges the graph exists to find. `redirect`
 * is supplied by the caller (`resolver.mjs` owns that mapping; it is passed in
 * so the two implementations cannot drift apart).
 */
function createProgramHost(options, redirect) {
  const host = ts.createCompilerHost(options, /* setParentNodes */ false);
  if (redirect === null) return host;

  const wrap = (method, decorate) => {
    const original = host[method]?.bind(host);
    if (original === undefined) return;
    host[method] = decorate(original);
  };

  wrap('fileExists', (original) => (file) => original(redirect(file)));
  wrap('readFile', (original) => (file) => original(redirect(file)));
  wrap('directoryExists', (original) => (directory) => original(redirect(directory)));
  wrap('getDirectories', (original) => (directory) => original(redirect(directory)));
  wrap('realpath', (original) => (file) => original(redirect(file)));
  wrap(
    'getSourceFile',
    (original) => (fileName, languageVersion, onError, shouldCreate) =>
      original(redirect(fileName), languageVersion, onError, shouldCreate),
  );

  return host;
}

/**
 * Is this path REPOSITORY-LOCAL source, as opposed to an external library?
 *
 * "Repository-local" means inside one of the workspace directories currently
 * under analysis, and outside `node_modules`. It deliberately does NOT mean
 * "inside `repoRoot`": an isolated fixture tree is a repository in its own
 * right — it carries its own root manifest and is discovered through the same
 * production path — and anchoring to the real repository root would give every
 * fixture an empty Program closure. A gate that silently stops working under
 * test is worse than one that fails, because the tests keep passing.
 *
 * `node_modules` is excluded on the RESOLVED path: an npm-linked workspace
 * realpaths out of `node_modules` into `packages/…` and stays local, while a
 * genuine third-party declaration does not.
 */
function isRepositoryLocal(filePath, analysisRoots) {
  const resolved = path.resolve(filePath);

  for (const root of analysisRoots) {
    const relative = path.relative(root, resolved);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    if (relative.split(path.sep).includes('node_modules')) continue;
    return true;
  }

  return false;
}

/** Cache keyed by config path — a Program is created at most once per project. */
const programCache = new Map();

/**
 * The repository-local source files one project's real `ts.Program` loaded.
 *
 * This is TypeScript's own answer to "what does `tsc -p` compile", which is
 * the authority this module always wanted and previously approximated with a
 * root file list. External libs, `node_modules` declarations and TypeScript's
 * own `lib.*.d.ts` are dropped: they are not repository architecture nodes,
 * and carrying them would push thousands of irrelevant files through every
 * later rule.
 *
 * A project with no roots at all gets no Program — one over nothing loads
 * nothing, and building it costs a default `lib` parse for no result.
 */
function programSourceFiles(parsed, redirect, analysisRoots) {
  // Keyed on the workspace set as well as the config, because which files count
  // as repository-local depends on which workspaces are under analysis.
  const cacheKey = `${parsed.configPath}\u0000${analysisRoots.join('\u0001')}`;
  const cached = programCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (parsed.fileNames.length === 0) {
    programCache.set(cacheKey, []);
    return [];
  }

  let local;

  try {
    // `noLib`/`noResolve` are deliberately NOT set: resolution must behave
    // exactly as the build's does. `noEmit` only prevents writing output that
    // would be discarded anyway.
    const options = { ...parsed.options, noEmit: true };
    const program = ts.createProgram({
      rootNames: parsed.fileNames.map(toTsPath),
      options,
      host: createProgramHost(options, redirect),
      projectReferences: parsed.projectReferences,
    });

    local = program
      .getSourceFiles()
      .map((sourceFile) => sourceFile.fileName)
      .filter((fileName) => isRepositoryLocal(fileName, analysisRoots));
  } catch {
    // A Program that cannot be instantiated must not take the whole run down.
    // Root-file ownership still applies, and every file the closure would have
    // added instead surfaces as unowned — reported, never resolved silently.
    local = [];
  }

  programCache.set(cacheKey, local);
  return local;
}

/**
 * Expands one project and every project it REFERENCES into membership records.
 *
 * `references` is the only mechanism by which a nested config legitimately
 * governs a source file. `ts.resolveProjectReferencePath` turns a reference
 * entry into the referenced config path exactly as `tsc --build` does, so a
 * genuine composite project keeps its own effective options while an
 * unreferenced config sitting next to a file governs nothing at all.
 *
 * Referenced projects are visited first, so a file claimed by a referenced
 * project keeps that project's options rather than the parent's — which is
 * what `tsc --build` compiles it with.
 *
 * Each project is then instantiated as a real `ts.Program`, and every
 * repository-local file that Program loaded — root inputs plus everything
 * reached by following their imports — is claimed at the CLOSURE tier (B1).
 */
function collectProjectMembership(configPath, state) {
  const { membership, seen, problems, ambiguous, programs, related } = state;

  const key = membershipKey(configPath);
  if (seen.has(key)) return;
  seen.add(key);

  let parsed;
  try {
    parsed = readEffectiveConfig(configPath);
  } catch (error) {
    problems.push(error);
    return;
  }

  // Depth first: a referenced project claims its files before its parent, so
  // the more specific project wins where both list the same source.
  for (const reference of parsed.projectReferences) {
    const referencedPath = ts.resolveProjectReferencePath(reference);
    if (typeof referencedPath !== 'string' || referencedPath === '') continue;

    const resolved = path.resolve(referencedPath);
    const referencedConfig =
      existsSync(resolved) && statSync(resolved).isDirectory()
        ? path.join(resolved, 'tsconfig.json')
        : resolved;

    if (!existsSync(referencedConfig)) continue;

    // Record the relationship BEFORE descending, so a claim made by the child
    // is already known to be related to this parent when the parent claims the
    // same file (§5). Recorded transitively: a grandchild's sources are still
    // governed deterministically from the root of the reference chain.
    recordReferenceEdge(related, parsed.configPath, membershipKey(referencedConfig));

    collectProjectMembership(referencedConfig, state);
  }

  for (const fileName of parsed.fileNames) {
    claimFile(
      membership,
      membershipKey(fileName),
      parsed,
      OWNERSHIP_ROOT,
      ambiguous,
      related,
      state.compatibilityHost,
    );
  }

  // ---- The actual Program closure (B1) ---------------------------------
  //
  // `fileNames` is the ROOT list. The Program is what `tsc -p` really loads:
  // the roots, plus every module they import, `exclude` notwithstanding.
  // Configured OUTPUT locations for this project, canonicalised. These are the
  // only directories whose contents this project genuinely GENERATES; the graph
  // filters on these rather than on directory NAMES (§13, B2).
  for (const configured of [parsed.options.outDir, parsed.options.declarationDir]) {
    if (typeof configured !== 'string' || configured === '') continue;
    state.generatedRoots.add(path.resolve(configured));
  }

  const closure = programSourceFiles(parsed, state.redirect, state.analysisRoots);
  programs.set(parsed.configPath, closure);

  for (const fileName of closure) {
    claimFile(
      membership,
      membershipKey(fileName),
      parsed,
      OWNERSHIP_CLOSURE,
      ambiguous,
      related,
      state.compatibilityHost,
    );
  }
}

/**
 * File -> owning project, across every workspace.
 *
 * Built once per workspace set and cached, because expanding `include` globs
 * and instantiating a Program per workspace is the expensive part of this
 * module.
 */
const projectIndexCache = new Map();

/**
 * Builds the project index for a set of workspaces.
 *
 * Returns `{ membership, problems, projects, ambiguous, programFiles }`, where
 * `membership` maps a canonical file key to `{ parsed, strength }` for the
 * project that compiles it, and `programFiles` lists every repository-local
 * file the projects' Programs loaded — the authoritative graph seed (§9).
 *
 * `redirect` maps a `node_modules/<workspace-package>/…` lookup onto that
 * workspace's real directory so an isolated fixture tree resolves its own
 * packages. It is supplied by the caller rather than reimplemented here.
 */
/**
 * The directory tree(s) an analysis covers.
 *
 * For the real repository this is `repoRoot`. For an isolated fixture tree it
 * is that tree's own root, derived from the workspaces themselves: the parent
 * of the `apps`/`packages` tier a workspace sits in. Deriving it rather than
 * assuming `repoRoot` is what lets a fixture behave as its own repository, and
 * what keeps a module shared BETWEEN two workspaces — sitting beside them
 * rather than inside either — inside the analysis.
 */
function analysisRootsFor(workspaces) {
  const roots = new Set();

  for (const workspace of workspaces) {
    // `<tree>/apps/<name>` and `<tree>/packages/<name>` both put the tree two
    // levels up. A workspace declared by literal path may sit elsewhere, so
    // its own parent is included too rather than assumed away.
    const directory = path.resolve(workspace.directory);
    roots.add(path.dirname(path.dirname(directory)));
  }

  return [...roots];
}

export function buildProjectIndex(workspaces = discoverWorkspaces(), redirect = null) {
  const cacheKey = workspaces
    .map((workspace) => `${workspace.name}\u0000${workspace.directory}`)
    .sort()
    .join('\u0001');

  const cached = projectIndexCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const state = {
    membership: new Map(),
    seen: new Set(),
    problems: [],
    ambiguous: new Map(),
    programs: new Map(),
    // Project config path -> every project reachable from it through
    // `references`, transitively. Consulted by `claimFile` to tell a
    // legitimate project-reference relationship (§5) from two independent
    // projects that merely happen to load the same file (§4).
    related: new Map(),
    // Canonical directories that are genuinely COMPILER OUTPUT: every parsed
    // project's configured `outDir`/`declarationDir`. Never directory names.
    generatedRoots: new Set(),
    // Module-resolution host used ONLY to decide whether two projects would
    // resolve a contested file's specifiers to different places (§6). Shares
    // the workspace redirect so an isolated fixture tree resolves its own
    // packages exactly as the Programs do.
    compatibilityHost: createCompatibilityHost(redirect),
    redirect,
    // What "repository-local" means for this analysis. A fixture tree is its
    // own repository, so the roots are the COMMON ANCESTORS of the discovered
    // workspaces — the tree that contains them — not the workspace
    // directories themselves. A shared module sitting beside `apps/` and
    // compiled by two of them is repository-local by any honest reading, and
    // anchoring to workspace directories would drop it from every Program
    // closure. See `isRepositoryLocal`.
    analysisRoots: analysisRootsFor(workspaces),
  };

  const projects = [];

  for (const workspace of workspaces) {
    const configPath = declaredProjectConfig(workspace);
    if (configPath === null) continue;

    const before = state.problems.length;
    projects.push({ workspace, configPath });
    collectProjectMembership(configPath, state);

    // Attribute every new problem to the workspace whose project raised it, so
    // the sources that consequently CANNOT BE VERIFIED can be named. A config
    // error reported only against the config file leaves a reader unable to see
    // which code went unchecked.
    for (let index = before; index < state.problems.length; index += 1) {
      state.problems[index].workspaceName = workspace.name;
      state.problems[index].workspaceDirectory = workspace.directory;
    }
  }

  // Every repository-local file any project's Program loaded, de-duplicated.
  // This is what SEEDS the graph, so a file TypeScript genuinely compiles
  // cannot be absent from it merely for living outside `src/` (B2).
  const programFiles = new Set();
  for (const files of state.programs.values()) {
    for (const file of files) programFiles.add(path.resolve(file));
  }

  const index = Object.freeze({
    membership: state.membership,
    problems: state.problems,
    projects,
    ambiguous: state.ambiguous,
    programFiles: [...programFiles].sort(),
    // Consumed by the graph's canonical generated-root predicate (§20), so
    // Program seeding and the recursive worklist cannot drift apart about what
    // counts as generated.
    configuredOutputRoots: [...state.generatedRoots].sort(),
  });

  projectIndexCache.set(cacheKey, index);
  return index;
}

/** Clears the caches. Test-only; a fixture tree may be rewritten between runs. */
export function resetProjectCaches() {
  parsedConfigCache.clear();
  projectIndexCache.clear();
  programCache.clear();
  specifierCache.clear();
}

/** The membership key for a path — exported so callers cannot drift from it. */
export function projectMembershipKey(filePath) {
  return membershipKey(filePath);
}

/**
 * Compiler options used when a source file belongs to no TypeScript project.
 *
 * Deliberately conservative and ALIAS-FREE. A file outside every project is
 * compiled by nothing, so it has no `paths` and no `baseUrl`, and inventing
 * some would resolve specifiers the build cannot resolve. `Bundler` matches the
 * repository's own `moduleResolution`, so extensionless imports, `index` files
 * and package `exports` maps behave as the real builds behave.
 *
 * Reaching these options is itself reportable — see `effectiveOptionsFor`.
 */
export const FALLBACK_OPTIONS = Object.freeze({
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  allowJs: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
});

/**
 * Effective compiler options governing one source file.
 *
 * Returns `{ options, configPath, unowned }`. `configPath` is the project that
 * genuinely compiles the file; `unowned` is true when NO project claims it, in
 * which case `FALLBACK_OPTIONS` apply and the caller reports the file rather
 * than resolving it as though a config had been found.
 *
 * Options are lightly adjusted in two places, and only where NOT doing so would
 * make the analyser see less than the build does:
 *
 *   - `allowJs` is forced on, because the analyser must inspect JavaScript that
 *     a TypeScript-only project would refuse to look at. A `.js` file inside a
 *     workspace is a finding in its own right (`production-must-be-typescript`)
 *     and cannot be allowed to vanish from the graph before that rule runs.
 *
 *   - `allowImportingTsExtensions` is forced on, because this repository's
 *     packages are consumed as TypeScript source and their imports carry
 *     explicit `.ts` extensions.
 *
 * Neither loosens how a specifier maps to a file. Every option that DOES affect
 * mapping — `baseUrl`, `paths`, `moduleResolution`, `customConditions`,
 * `resolvePackageJsonExports`/`Imports` — is taken verbatim from the project.
 */
export function effectiveOptionsFor(sourceFile, { projectIndex = null } = {}) {
  const index = projectIndex ?? buildProjectIndex();
  const key = membershipKey(sourceFile);
  const owner = index.membership.get(key);

  if (owner === undefined) {
    return {
      configPath: null,
      unowned: true,
      ownership: null,
      ambiguous: false,
      options: { ...FALLBACK_OPTIONS },
    };
  }

  return {
    configPath: owner.parsed.configPath,
    unowned: false,
    // Which tier claimed the file: a declared input, or a module the project's
    // Program loaded by following an import (B1). Reported so a reader can see
    // WHY a given configuration governs a file that no `include` names.
    ownership: owner.strength === OWNERSHIP_ROOT ? 'root' : 'closure',
    ambiguous: index.ambiguous?.has(key) === true,
    options: {
      ...owner.parsed.options,
      allowJs: true,
      allowImportingTsExtensions: true,
    },
  };
}

export { ts };
