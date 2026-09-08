/**
 * Module-specifier extraction using the TypeScript Compiler API.
 *
 * Replaces the previous regular-expression scanner. Regex cannot reliably tell
 * a real import from the same text inside a string or a comment, and every
 * additional syntax form meant another fragile pattern. TypeScript 5.9 is
 * already a locked dependency and parses the language properly, so the AST is
 * both more correct and one less thing to maintain.
 *
 * Extracted forms:
 *   - `import … from '…'` and bare `import '…'`
 *   - `import type … from '…'`
 *   - `export … from '…'` and `export * from '…'`
 *   - `export * as ns from '…'` (barrels)
 *   - dynamic `import('…')`
 *   - `require('…')`
 *   - `import x = require('…')`
 *
 * Only STATICALLY resolvable specifiers are reported. A computed specifier
 * cannot be checked without executing the program, which is out of scope and
 * would be the wrong tool.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Script kind from the file extension, so JSX and TSX parse correctly. */
function scriptKindFor(file) {
  switch (path.extname(file)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/** Reads the literal text of a specifier node, or `null` when computed. */
function literalSpecifier(node) {
  if (node === undefined) return null;

  if (ts.isStringLiteralLike(node)) return node.text;

  // A template literal with no substitutions is statically knowable.
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  return null;
}

/**
 * Parses one file and returns every statically resolvable module specifier,
 * each with the 1-based line it appears on for diagnostics.
 */
export function extractModuleSpecifiers(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(file),
  );

  const found = new Map();

  const record = (specifierNode, kind) => {
    const specifier = literalSpecifier(specifierNode);
    if (specifier === null || specifier === '') return;

    if (found.has(specifier)) return;

    const { line } = source.getLineAndCharacterOfPosition(specifierNode.getStart(source));
    found.set(specifier, { specifier, kind, line: line + 1 });
  };

  const visit = (node) => {
    // import … from '…' | import '…'
    if (ts.isImportDeclaration(node)) {
      record(
        node.moduleSpecifier,
        node.importClause?.isTypeOnly ? 'import-type' : 'import',
      );
    }

    // export … from '…' | export * from '…' | export * as ns from '…'
    else if (
      (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) &&
      node.moduleSpecifier !== undefined
    ) {
      record(node.moduleSpecifier, node.isTypeOnly ? 'export-from-type' : 'export-from');
    }

    // import x = require('…')
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression, 'import-equals');
    }

    // dynamic import('…')
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node.arguments[0], 'dynamic-import');
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length > 0
      ) {
        record(node.arguments[0], 'require');
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return [...found.values()];
}

/**
 * Does this file carry the `'use client'` directive?
 *
 * Read from the parsed prologue, not from the filename. A file is a Client
 * Component because it says so — `widget.tsx` with `'use client'` is one, and
 * `thing.client.tsx` without it is not.
 */
export function hasUseClientDirective(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(file),
  );

  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) break;
    if (!ts.isStringLiteralLike(statement.expression)) break;

    if (statement.expression.text === 'use client') return true;
  }

  return false;
}

export { ts };
