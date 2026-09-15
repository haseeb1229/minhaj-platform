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
import { ts } from './architecture/parser.mjs';
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

/**
 * Object-literal properties, read from the REAL parse tree.
 *
 * These two rules are about INLINE STYLE OBJECTS, and an inline style object is
 * an object literal — so the check asks the parser for object literals rather
 * than asking a regular expression what a colon might mean.
 *
 * The previous form matched `<name>:` anywhere a `{`, `,` or space preceded it,
 * which is also the shape of a TypeScript type annotation. `function sameKey(
 * left: string, right: string)` was therefore reported as an inline style, and
 * every future `right: number` on an interface would have been too. Suppressing
 * that by renaming a parameter would leave the rule wrong and the next author
 * to discover it; reading the tree makes the rule mean what it says.
 *
 * `PropertyAssignment` occurs only inside an `ObjectLiteralExpression`.
 * Parameters, interface members, type literals and class properties are
 * different nodes and are not visited — which is the whole correction.
 */
function objectLiteralProperties(file, source) {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const properties = [];

  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name;
      const key = ts.isIdentifier(name)
        ? name.text
        : ts.isStringLiteralLike(name)
          ? name.text
          : null;

      if (key !== null) properties.push({ key, initializer: node.initializer });
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return properties;
}

/** Physical inline-style property keys, in object-literal position. */
function findPhysicalStyleKeys(properties) {
  const found = [];
  const seen = new Set();

  for (const { key } of properties) {
    const logical = physicalToLogicalStyleProperties[key];
    if (logical === undefined || seen.has(key)) continue;

    seen.add(key);
    found.push({ property: key, logical });
  }

  return found;
}

/**
 * Direction-neutral style properties carrying a PHYSICAL VALUE.
 *
 * Matched as property AND value together, so `textAlign: 'start'` passes and
 * only `textAlign: 'left'` fails.
 */
function findPhysicalStyleValues(properties) {
  const found = [];
  const seen = new Set();

  for (const { key, initializer } of properties) {
    const rule = physicalStyleValues[key];
    if (rule === undefined) continue;
    if (!ts.isStringLiteralLike(initializer)) continue;

    const logical = rule.prohibited[initializer.text];
    if (logical === undefined) continue;

    const signature = `${key}:${initializer.text}`;
    if (seen.has(signature)) continue;

    seen.add(signature);
    found.push({ property: key, value: initializer.text, logical });
  }

  return found;
}

/**
 * CSS carried in an HTML `style` attribute inside source.
 *
 * Reading the parse tree for style OBJECTS would otherwise have quietly
 * dropped the one place this platform writes CSS as text: the transactional
 * email bodies, which are HTML strings with inline styles because that is the
 * only styling a mail client reliably honours. Urdu and Arabic mail is RTL, so
 * a `margin-left` there breaks it exactly as it would in the application.
 *
 * Scoped to the contents of a `style` attribute rather than every string, so a
 * sentence that happens to contain `right:` is not a finding.
 */
function findStyleAttributeCss(literal) {
  const found = [];

  for (const match of literal.matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const css = match[1] ?? match[2] ?? '';
    for (const declaration of findPhysicalCssDeclarations(css)) {
      found.push(declaration);
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
      const raw = readFileSync(file, 'utf8');
      const source = stripComments(raw);

      for (const literal of extractStringLiterals(source)) {
        for (const { physical, logical } of findPhysicalDirectionUtilities(literal)) {
          violations.push({
            rule: 'physical-direction-utility',
            file: relative,
            detail: `"${literal.trim()}"`,
            message: `'${physical}-*' breaks RTL. Use '${logical}-*'.`,
          });
        }

        for (const { declaration, logical } of findStyleAttributeCss(literal)) {
          violations.push({
            rule: 'physical-css-declaration',
            file: relative,
            detail: declaration,
            message: `'${declaration}' breaks RTL. Use '${logical}'.`,
          });
        }
      }

      // The PARSE TREE, not the comment-stripped text: the parser discards
      // comments itself, and a style object is an object literal.
      const properties = objectLiteralProperties(file, raw);

      for (const { property, logical } of findPhysicalStyleKeys(properties)) {
        violations.push({
          rule: 'physical-inline-style',
          file: relative,
          detail: property,
          message: `Inline style '${property}' breaks RTL. Use '${logical}'.`,
        });
      }

      for (const { property, value, logical } of findPhysicalStyleValues(properties)) {
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
