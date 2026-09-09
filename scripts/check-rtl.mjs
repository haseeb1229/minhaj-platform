#!/usr/bin/env node
/**
 * RTL convention validation across production source and stylesheets.
 *
 * ESLint covers TS/TSX class strings and inline styles. It does NOT parse CSS,
 * so stylesheets need their own gate — and running as a standalone process
 * means an inline `eslint-disable` cannot suppress either half.
 *
 * Source roots are DISCOVERED from the root `package.json` workspaces, shared
 * with the architecture analyser. A future `packages/ui` is covered the moment
 * it exists; nothing here invents one.
 *
 * TECH_STACK.md §5, ARCHITECTURE.md §9: Urdu and Arabic are RTL from day one,
 * and physical-direction layout breaks them silently.
 *
 * Usage:
 *   node scripts/check-rtl.mjs
 *   node scripts/check-rtl.mjs --roots a,b
 *   node scripts/check-rtl.mjs --workspace-root <dir>
 *   node scripts/check-rtl.mjs --json
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findPhysicalCssDeclarations,
  findPhysicalDirectionUtilities,
  physicalStyleValues,
  physicalToLogicalStyleProperties,
} from '../packages/config/eslint/rtl.js';
import {
  configuredOutputRootsFor,
  generatedRootsFor,
  isUnderGeneratedRoot,
} from './shared/generated-roots.mjs';
import {
  discoverSourceRoots,
  discoverWorkspaces,
  repoRoot,
} from './shared/workspaces.mjs';

/** Extensions carrying class strings or inline styles. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/**
 * Files exempt from RTL scanning because they DEFINE the rules.
 *
 * `rtl.js` necessarily names every prohibited utility and property — that is
 * its entire content. Scanning it reports its own tables as violations, which
 * is a self-reference artifact, not a finding. Nothing in it renders anything.
 *
 * Kept as an explicit list rather than a pattern, so a genuine UI file can
 * never quietly acquire an exemption.
 */
const RULE_DEFINITION_FILES = new Set(['packages/config/eslint/rtl.js']);

/** Extensions carrying stylesheets. */
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);

/**
 * Collects files beneath a root, filtered by extension set.
 *
 * DISCOVERY DOES NOT TRUST DIRECTORY NAMES — Review #8 (B8-1)
 * -----------------------------------------------------------
 * This walk used to skip any directory whose basename appeared in
 * `IGNORED_DIRECTORIES` — `dist`, `build`, `coverage`, `.turbo`. Review #8
 * planted authored production source at:
 *
 *     apps/app/src/dist/bad.tsx
 *     export const physicalDirectionStyle = { borderLeftWidth: 1 };
 *
 * Real `tsc` compiles it, the architecture gate includes it, and a DIRECT scan
 * of that directory reports `physical-inline-style` correctly — so the rule was
 * never the problem. Discovery was: `check:rtl` walked past the directory and
 * checked zero files, ESLint ignored it by glob, and the violation shipped.
 *
 * A directory name is chosen by whoever writes the code. The architecture gate
 * stopped granting names authority in Round 6; this scanner now uses the SAME
 * shared policy (`shared/generated-roots.mjs`) rather than a second, weaker one
 * of its own. Only positively identified canonical generated roots are skipped:
 * a real `node_modules`, a real Next `.next`, a configured `outDir` or
 * `declarationDir`.
 */
function collectFiles(root, extensions, generatedRoots = []) {
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

        // Git's object store holds no authored source and nothing in it renders
        // anything. This is the only name-based skip, and it is not a security
        // exclusion — everything else is an identity test.
        if (entry.name === '.git') continue;

        if (isUnderGeneratedRoot(child, generatedRoots)) continue;

        walk(child);
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        files.push(path.join(directory, entry.name));
      }
    }
  };

  if (existsSync(root) && statSync(root).isDirectory()) walk(root);

  return files.sort();
}

/** Every string and template chunk that could be a class list. */
function extractStringLiterals(source) {
  const literals = [];

  for (const match of source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
    literals.push(match[1] ?? match[2] ?? '');
  }
  for (const match of source.matchAll(/`([^`]*)`/g)) {
    for (const chunk of (match[1] ?? '').split(/\$\{[^}]*\}/)) {
      literals.push(chunk);
    }
  }

  return literals;
}

/** Physical inline-style property keys, in object-literal position. */
function findPhysicalStyleKeys(source) {
  const found = [];

  for (const property of Object.keys(physicalToLogicalStyleProperties)) {
    const pattern = new RegExp(`(?:^|[{,\\s])['"]?${property}['"]?\\s*:`, 'm');
    if (pattern.test(source)) {
      found.push({
        property,
        logical: physicalToLogicalStyleProperties[property],
      });
    }
  }

  return found;
}

/**
 * Direction-neutral style properties carrying a PHYSICAL VALUE.
 *
 * Matched as property AND value together, so `textAlign: 'start'` passes and
 * only `textAlign: 'left'` fails.
 */
function findPhysicalStyleValues(source) {
  const found = [];

  for (const [property, { prohibited }] of Object.entries(physicalStyleValues)) {
    for (const [value, logical] of Object.entries(prohibited)) {
      const pattern = new RegExp(
        `(?:^|[{,\\s])['"]?${property}['"]?\\s*:\\s*['"]${value}['"]`,
        'm',
      );
      if (pattern.test(source)) {
        found.push({ property, value, logical });
      }
    }
  }

  return found;
}

/** Strips comments, which legitimately name the prohibited forms. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export async function validateRtl(roots, { workspaceRoot = null } = {}) {
  const workspaces = discoverWorkspaces(workspaceRoot ?? repoRoot);
  const targets = roots ?? discoverSourceRoots(workspaces);

  // The SAME canonical generated-root policy the architecture analyser uses
  // (Review #8, B8-1). Computed once per run: a real `node_modules`, a real
  // Next `.next`, and each workspace's configured `outDir`/`declarationDir`.
  // Nothing else is skipped, and no directory NAME grants an exemption.
  const generatedRoots = generatedRootsFor(
    workspaces,
    configuredOutputRootsFor(workspaces),
  );

  const violations = [];
  let filesChecked = 0;

  for (const root of targets) {
    for (const file of collectFiles(root, SOURCE_EXTENSIONS, generatedRoots)) {
      const relative = path.relative(repoRoot, file).split(path.sep).join('/');
      if (RULE_DEFINITION_FILES.has(relative)) continue;

      filesChecked += 1;
      const source = stripComments(readFileSync(file, 'utf8'));

      for (const literal of extractStringLiterals(source)) {
        for (const { physical, logical } of findPhysicalDirectionUtilities(literal)) {
          violations.push({
            rule: 'physical-direction-utility',
            file: relative,
            detail: `"${literal.trim()}"`,
            message: `'${physical}-*' breaks RTL. Use '${logical}-*'.`,
          });
        }
      }

      for (const { property, logical } of findPhysicalStyleKeys(source)) {
        violations.push({
          rule: 'physical-inline-style',
          file: relative,
          detail: property,
          message: `Inline style '${property}' breaks RTL. Use '${logical}'.`,
        });
      }

      for (const { property, value, logical } of findPhysicalStyleValues(source)) {
        violations.push({
          rule: 'physical-inline-style-value',
          file: relative,
          detail: `${property}: '${value}'`,
          message:
            `'${property}: "${value}"' is a physical direction and breaks RTL. ` +
            `Use '${property}: "${logical}"'.`,
        });
      }
    }

    for (const stylesheet of collectFiles(root, STYLE_EXTENSIONS, generatedRoots)) {
      filesChecked += 1;
      const relative = path.relative(repoRoot, stylesheet).split(path.sep).join('/');
      const css = readFileSync(stylesheet, 'utf8');

      for (const { declaration, logical } of findPhysicalCssDeclarations(css)) {
        violations.push({
          rule: 'physical-css-declaration',
          file: relative,
          detail: declaration,
          message: `'${declaration}' breaks RTL. Use '${logical}'.`,
        });
      }
    }
  }

  return { violations, filesChecked };
}

function isMain() {
  const invoked = process.argv[1];
  return (
    invoked !== undefined &&
    path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url))
  );
}

if (isMain()) {
  const args = process.argv.slice(2);

  const rootsFlag = args.indexOf('--roots');
  const roots =
    rootsFlag === -1
      ? null
      : (args[rootsFlag + 1] ?? '')
          .split(',')
          .filter(Boolean)
          .map((entry) => path.resolve(repoRoot, entry));

  const workspaceFlag = args.indexOf('--workspace-root');
  const workspaceRoot =
    workspaceFlag === -1 ? null : path.resolve(repoRoot, args[workspaceFlag + 1] ?? '');

  const { violations, filesChecked } = await validateRtl(roots, { workspaceRoot });

  if (args.includes('--json')) {
    console.log(JSON.stringify({ violations, filesChecked }, null, 2));
  } else if (violations.length === 0) {
    console.log(`RTL OK — ${filesChecked} file(s) use logical-direction layout only.`);
  } else {
    console.error(`\nRTL validation FAILED — ${violations.length} violation(s):\n`);
    for (const violation of violations) {
      console.error(`  [${violation.rule}] ${violation.file}`);
      console.error(`    ${violation.detail}`);
      console.error(`    ${violation.message}\n`);
    }
  }

  process.exit(violations.length === 0 ? 0 : 1);
}
