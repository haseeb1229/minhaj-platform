/**
 * THE canonical generated-output policy, shared by every enforcement gate.
 *
 * WHY THIS MODULE EXISTS — Review #8 (B8-1)
 * -----------------------------------------
 * Round 6 and Round 7 established, for the architecture analyser, that
 * generated output is recognised by PATH IDENTITY and never by directory name:
 * a segment spelled `dist`, `build` or `coverage` is a name someone chose, and
 * granting it security meaning switches enforcement off for anyone willing to
 * choose it.
 *
 * That principle was applied to the architecture gate and to nothing else. The
 * RTL scanner kept its own basename skip list, so Review #8 planted:
 *
 *     apps/app/src/dist/bad.tsx
 *     export const physicalDirectionStyle = { borderLeftWidth: 1 };
 *
 * Real `tsc` compiles it. The architecture gate includes it. `check:rtl`
 * checked ZERO files, ESLint reported "File ignored because of a matching
 * ignore pattern", and a physical-direction inline style shipped with no
 * diagnostic anywhere — while a DIRECT scan of that same directory reported it
 * correctly, proving the rule worked and only discovery was blind.
 *
 * One principle enforced in one gate and not the others is not a principle; it
 * is a coincidence. So the policy now lives here, in ONE place, and every gate
 * imports it. A future gate that needs to exclude build output has an obvious
 * correct thing to call, and cannot quietly grow a fourth basename list.
 *
 * Deliberately dependency-light — `node:fs` and `node:path` only. The RTL
 * scanner must not have to pull in the TypeScript compiler API to answer
 * "is this file generated output?", and a shared policy that is expensive to
 * import is a shared policy people work around.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Canonical identity of a path on disk.
 *
 * `realpathSync` follows symlinks and normalises casing to what the filesystem
 * actually reports, so two spellings naming one file always produce one key.
 * A path that does not exist is normalised lexically instead — it cannot be
 * canonicalised, and reporting it is still better than dropping it.
 *
 * Lives here rather than in `resolver.mjs` because the generated-root test is
 * built on it and this module must stay importable without the TypeScript
 * compiler API. `resolver.mjs` re-exports it, so every existing caller is
 * unchanged and there is still exactly one implementation.
 */
export function canonicalise(absolutePath) {
  try {
    return realpathSync.native(absolutePath);
  } catch {
    return path.normalize(absolutePath);
  }
}

/** Does this workspace manifest declare a dependency on Next? */
function dependsOnNext(workspace) {
  const manifest = workspace?.manifest ?? {};

  return (
    manifest.dependencies?.next !== undefined ||
    manifest.devDependencies?.next !== undefined
  );
}

/**
 * The canonical directories that genuinely hold GENERATED OUTPUT.
 *
 * Round 6 (B2) replaced a path-SEGMENT test with this. The previous rule
 * discarded any file with a segment named `dist`, `build`, `coverage` or
 * `.next` anywhere in its path, and Review #6 walked straight through it:
 *
 *     src/contexts/messaging/index.ts -> src/dist/barrel.ts
 *                                     -> src/contexts/quran/internal.ts
 *
 * `src/dist/barrel.ts` is AUTHORED source. The workspace tsconfig includes
 * every `.ts` under `src`, real `tsc` compiles it, and it is an ordinary file
 * that merely sits in a directory someone named `dist`.
 *
 * Generated output is instead identified by IDENTITY — the actual roots this
 * repository's tooling is configured to write:
 *
 *   - every workspace's real `node_modules` (third-party, never our source)
 *   - `<workspace>/.next` for a workspace that genuinely depends on Next
 *   - every parsed project's configured `outDir` / `declarationDir`
 *
 * A file is generated only when it is a DESCENDANT of one of those roots.
 * `src/dist/barrel.ts`, `src/build/helpers.ts`, `src/features/dist/barrel.ts`
 * and `src/dist/bad.tsx` are authored source and stay under every gate.
 *
 * `configuredOutputRoots` is supplied by the caller. The architecture analyser
 * passes the roots its parsed TypeScript project index already computed; the
 * RTL scanner, which parses no projects, passes the roots read by
 * `configuredOutputRootsFor` below. Both arrive here and are treated
 * identically, which is the point.
 */
export function generatedRootsFor(workspaces, configuredOutputRoots = []) {
  const roots = new Set();

  for (const root of configuredOutputRoots) roots.add(canonicalise(root));

  for (const workspace of workspaces) {
    const directory = canonicalise(workspace.directory);

    // Third-party dependency trees. Anchored to a workspace's OWN
    // `node_modules` directory rather than to the name appearing anywhere in a
    // path, so an authored directory that happened to carry the name elsewhere
    // in the tree is not silently exempted.
    roots.add(canonicalise(path.join(directory, 'node_modules')));

    // `.next` counts only for a workspace that really is a Next application,
    // proven by its own manifest rather than by its path.
    if (dependsOnNext(workspace)) {
      roots.add(canonicalise(path.join(directory, '.next')));
    }
  }

  return [...roots];
}

/**
 * WHICH canonical generated root contains this file, or `null` for none.
 *
 * Compared on canonical (realpath) paths with `path.relative`, so the test is a
 * genuine ancestor check on both Windows and Linux rather than string
 * prefixing — `…/distant/file.ts` is not inside `…/dist`.
 *
 * The most DEEPLY nested matching root wins, so a `declarationDir` inside an
 * `outDir` is named as itself rather than as its parent.
 */
export function generatedRootOf(file, generatedRoots) {
  const canonical = canonicalise(file);

  let best = null;

  for (const root of generatedRoots) {
    const relative = path.relative(root, canonical);
    const inside =
      relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (inside && (best === null || root.length > best.length)) best = root;
  }

  return best;
}

/**
 * Is this file a descendant of a canonical generated root?
 *
 * Written in terms of `generatedRootOf` so the two can never disagree.
 */
export function isUnderGeneratedRoot(file, generatedRoots) {
  return generatedRootOf(file, generatedRoots) !== null;
}

/**
 * Strips comments from JSONC so a `tsconfig.json` can be read without the
 * TypeScript compiler API.
 *
 * Deliberately minimal, and it does NOT try to be a JSONC parser: it removes
 * block and line comments outside string literals, which is the only JSONC
 * feature these files use. `readConfiguredOutputRoots` treats any failure as
 * "no configured roots", which is the fail-OPEN-for-discovery direction and
 * therefore the safe one here — an unreadable tsconfig means MORE files are
 * scanned by RTL, never fewer.
 */
function stripJsonComments(text) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      result += '\n';
      continue;
    }

    if (character === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
}

/**
 * Reads `outDir` / `declarationDir` from a workspace's own tsconfig files.
 *
 * The architecture analyser gets these from its full TypeScript project index,
 * which resolves `extends` chains and applies compiler defaults. The RTL
 * scanner has no such index and should not build one — it would make a style
 * check depend on the compiler API and on project parsing succeeding.
 *
 * So this reads the configured roots directly. It is INTENTIONALLY narrower
 * than the analyser's version, and narrower in the safe direction: a root this
 * misses is a directory the RTL scanner will SCAN rather than skip. Scanning
 * genuine build output can only produce a false positive, which is visible and
 * fixable; skipping authored source produces a silent bypass, which is B8-1.
 *
 * `extends` is followed one level, because the repository's own configs use it
 * to inherit a shared base; a base that itself extends is not something this
 * repository does, and guessing further would be inventing behaviour.
 */
export function configuredOutputRootsFor(workspaces) {
  const roots = new Set();

  const readConfig = (configPath, depth = 0) => {
    if (depth > 4) return;
    if (!existsSync(configPath)) return;

    let config;
    try {
      config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')));
    } catch {
      // Unreadable config: scan everything under this workspace rather than
      // guessing at exclusions.
      return;
    }

    const directory = path.dirname(configPath);
    const options = config?.compilerOptions ?? {};

    for (const configured of [options.outDir, options.declarationDir]) {
      if (typeof configured !== 'string' || configured === '') continue;
      roots.add(canonicalise(path.resolve(directory, configured)));
    }

    const extended = config?.extends;
    if (typeof extended !== 'string' || extended === '') return;

    // Only a RELATIVE extends is followed. A package specifier would need node
    // resolution, and the failure mode of skipping it is again the safe one.
    if (!extended.startsWith('.')) return;

    const target = path.resolve(directory, extended);
    readConfig(target.endsWith('.json') ? target : `${target}.json`, depth + 1);
  };

  for (const workspace of workspaces) {
    readConfig(path.join(workspace.directory, 'tsconfig.json'));
  }

  return [...roots];
}
