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
 * The MODULE-LEVEL DIRECTIVE PROLOGUE of one file.
 *
 * A directive prologue is the run of string-literal expression statements at
 * the very top of a module, and nothing else. The walk therefore stops at the
 * first statement of any other kind — an import, a declaration, an assignment —
 * because after one of those a string literal is an ordinary expression that
 * React and Next.js ignore entirely.
 *
 * That precision is the whole point. Both directives this repository acts on
 * are load-bearing security boundaries, so each must be recognised exactly
 * where the framework recognises it and nowhere else:
 *
 *   - text resembling a directive inside a COMMENT is not a directive, and the
 *     AST never presents it as one
 *   - a string in an ordinary expression position is not a directive
 *   - a directive placed AFTER any other statement is not a directive
 *   - `'use server'` inside a function body marks that function, and does NOT
 *     make the module a Server Action boundary
 *
 * Read from the parsed prologue, never from the filename. A file is a Client
 * Component because it says so — `widget.tsx` carrying `'use client'` is one,
 * and `thing.client.tsx` without it is not.
 */
export function moduleDirectives(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(file),
  );

  const directives = new Set();

  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) break;
    if (!ts.isStringLiteralLike(statement.expression)) break;

    directives.add(statement.expression.text);
  }

  return directives;
}

/** Does this file carry the module-level `'use client'` directive? */
export function hasUseClientDirective(file) {
  return moduleDirectives(file).has('use client');
}

/**
 * Does this file carry the module-level `'use server'` directive?
 *
 * A module carrying it is a SERVER ACTION BOUNDARY. ARCHITECTURE.md §7 names
 * Server Actions as the mutation path "for mutations from the platform's own
 * UI", and the framework's semantics are what make the boundary real: a Client
 * Component importing such a module receives a callable REFERENCE, and the
 * module's own implementation — and everything it imports — stays on the server
 * and is never bundled for the browser.
 *
 * This is deliberately NOT a general laundering marker (§7.1 of the hardening
 * contract). It is recognised only in the true directive prologue, so a
 * commented-out directive, a directive in a string, a misplaced one and a
 * function-level one all leave the module an ordinary module — and an ordinary
 * module that reaches server-only code from a client graph still fails.
 */
export function hasUseServerDirective(file) {
  return moduleDirectives(file).has('use server');
}

function hasModifier(node, kind) {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

/**
 * Is this a MINIMALLY VALID module-level Server Action boundary?
 *
 * Next.js requires every runtime export of a `'use server'` file to be an
 * async function. A directive alone is therefore not a boundary: treating
 * `export const value = 1` as one would let a trivially invalid module stop the
 * client walk and hide server-only code until a later build happened to see
 * it. We enforce the cheap, syntax-level minimum here and leave framework-
 * specific transformation details to the independent real Next build.
 *
 * The deliberately narrow convention accepts direct async declarations,
 * async function/arrow values, and local named/default exports of those. A
 * re-export or factory-produced value is not syntactically provable here, so it
 * does not earn boundary status; authors can export the async action directly.
 */
export function isServerActionBoundary(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(file),
  );

  const directives = new Set();
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) break;
    if (!ts.isStringLiteralLike(statement.expression)) break;
    directives.add(statement.expression.text);
  }
  if (!directives.has('use server')) return false;
  if (directives.has('use client')) return false;

  const localValues = new Map();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      localValues.set(statement.name.text, statement);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          localValues.set(declaration.name.text, declaration.initializer ?? null);
        }
      }
    }
  }

  const isAsyncValue = (node, seen = new Set()) => {
    if (node === undefined || node === null) return false;

    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      return isAsyncValue(node.expression, seen);
    }

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      return hasModifier(node, ts.SyntaxKind.AsyncKeyword);
    }

    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return false;
      seen.add(node.text);
      return isAsyncValue(localValues.get(node.text), seen);
    }

    return false;
  };

  let runtimeExports = 0;

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;

      const clause = statement.exportClause;
      if (clause === undefined || ts.isNamespaceExport(clause)) return false;

      for (const element of clause.elements) {
        if (element.isTypeOnly) continue;
        runtimeExports += 1;

        // Following arbitrary re-export graphs here would duplicate the
        // compiler. A direct action export is the fail-closed convention.
        if (statement.moduleSpecifier !== undefined) return false;

        const local = element.propertyName?.text ?? element.name.text;
        if (!isAsyncValue(localValues.get(local))) return false;
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      runtimeExports += 1;
      if (!isAsyncValue(statement.expression)) return false;
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      runtimeExports += 1;
      if (!isAsyncValue(statement)) return false;
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        runtimeExports += 1;
        if (!isAsyncValue(declaration.initializer)) return false;
      }
      continue;
    }

    // Classes, enums, namespaces and every other runtime declaration are not
    // async functions and are invalid in a module-level Server Action file.
    return false;
  }

  return runtimeExports > 0;
}

export { ts };
