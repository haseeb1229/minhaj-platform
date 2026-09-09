/**
 * EXPORTED SURFACE of one module, read from the TypeScript AST.
 *
 * WHY THIS EXISTS
 * ---------------
 * ARCHITECTURE.md §3.1.1 permits a caller to invoke an encapsulated service
 * that internally persists, while §3.1.2 forbids that caller from ever
 * receiving "a Prisma client, delegate, transaction handle or raw-query
 * facility". Both sentences are about the same module graph, and only one thing
 * separates them: WHAT THE ENCAPSULATING MODULE EXPORTS.
 *
 * A reachability walk cannot make that distinction. A context-owned persistence
 * adapter legitimately reaches Prisma — that is its job — so any rule phrased
 * as "must not reach the database" would ban the architecture it is meant to
 * enforce. What must be true instead is that the adapter's PUBLIC SURFACE hands
 * out narrow persistence operations and nothing else (§4.1).
 *
 * Without this, declaring a directory to be an "adapter" would be a laundering
 * marker: a module could be nominated as an encapsulation boundary, re-export
 * `getDatabaseClient`, and the capability walk would stop politely at it. §6.3
 * rule 13 says the opposite — "a wrapper that launders one into the other
 * violates this rule rather than satisfying it" — so a boundary earns its
 * status by having a surface that can be SHOWN to be narrow.
 *
 * WHAT IS EXTRACTED
 * -----------------
 * Everything needed to answer "does this exported name carry a raw-capability
 * type?", and nothing more:
 *
 *   - import bindings, so an identifier appearing in a type position can be
 *     traced back to the module it came from
 *   - re-exports, named and star alike, so a chain can be followed
 *   - each exported declaration, whether it carries an EXPLICIT type
 *     annotation, and every type identifier that annotation names
 *   - locally declared interfaces and type aliases, so an annotation naming a
 *     local type is expanded into the identifiers that type is built from
 *
 * FAIL CLOSED
 * -----------
 * An export with no explicit type annotation is reported as unverifiable rather
 * than assumed narrow. That is deliberate. `export function db() { return
 * getDatabaseClient(); }` has an inferred return type of `PrismaClient`, and no
 * syntactic analysis can see that — so a boundary is required to say what it
 * exports. This is the same discipline `isolatedDeclarations` enforces, applied
 * where the architecture actually depends on it.
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

/** Every type identifier a type node names, qualified names included. */
function typeIdentifiers(node, into = new Set()) {
  if (node === undefined || node === null) return into;

  const visit = (current) => {
    if (ts.isTypeReferenceNode(current) || ts.isExpressionWithTypeArguments(current)) {
      let name = ts.isTypeReferenceNode(current) ? current.typeName : current.expression;

      // `Prisma.TransactionClient` — the LEFTMOST identifier is the binding
      // that was imported, and it is the one that matters.
      while (name !== undefined && ts.isQualifiedName(name)) name = name.left;
      while (name !== undefined && ts.isPropertyAccessExpression(name))
        name = name.expression;

      if (name !== undefined && ts.isIdentifier(name)) into.add(name.text);
    }

    // `typeof getDatabaseClient` is a type position naming a VALUE binding.
    if (ts.isTypeQueryNode(current)) {
      let name = current.exprName;
      while (name !== undefined && ts.isQualifiedName(name)) name = name.left;
      if (name !== undefined && ts.isIdentifier(name)) into.add(name.text);
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return into;
}

/**
 * Broad type forms that cannot prove an adapter hands out a narrow value.
 *
 * An explicit annotation is not automatically an informative annotation:
 * `unknown`, `any`, `object`, `{}` and a type parameter such as `T` can all
 * conceal a Prisma client while allowing the declaration to look "typed".
 * The surface gate deliberately rejects those escape hatches. This is a
 * bounded export convention, not arbitrary data-flow analysis: a genuinely
 * narrow context-owned port remains expressible, while a value whose public
 * shape has been erased does not earn encapsulation-boundary status.
 */
function broadTypeReasons(node, typeParameters = new Set(), into = new Set()) {
  if (node === undefined || node === null) return into;

  const visit = (current, inheritedParameters = typeParameters) => {
    const scopedParameters = new Set(inheritedParameters);
    for (const parameter of current.typeParameters ?? []) {
      scopedParameters.add(parameter.name.text);
    }

    if (current.kind === ts.SyntaxKind.AnyKeyword) into.add("the broad type 'any'");
    if (current.kind === ts.SyntaxKind.UnknownKeyword)
      into.add("the broad type 'unknown'");
    if (current.kind === ts.SyntaxKind.ObjectKeyword) into.add("the broad type 'object'");

    if (ts.isTypeLiteralNode(current) && current.members.length === 0) {
      into.add("the empty object type '{}'");
    }

    if (ts.isTypeReferenceNode(current)) {
      let name = current.typeName;
      while (ts.isQualifiedName(name)) name = name.left;
      if (ts.isIdentifier(name) && scopedParameters.has(name.text)) {
        into.add(`the unconcretised type parameter '${name.text}'`);
      }
    }

    ts.forEachChild(current, (child) => visit(child, scopedParameters));
  };

  visit(node);
  return into;
}

function typeParameterNames(node) {
  return new Set((node.typeParameters ?? []).map((parameter) => parameter.name.text));
}

/**
 * Binding names whose VALUES can directly escape through an expression.
 *
 * This intentionally is not a general taint engine. It recognises identity-
 * preserving shapes (`return db`, `{ client: db }`, a returned delegate,
 * direct factory calls, aliases, arrays and conditionals) but does not call a
 * normal `database.message.create()` result "the database client". That keeps
 * real adapter operations viable while closing the simple structural-typing
 * bypass where a raw object is returned under a narrower annotation.
 */
function directValueReferences(expression, into = new Set()) {
  if (expression === undefined || expression === null) return into;

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression)
  ) {
    return directValueReferences(expression.expression, into);
  }

  if (ts.isIdentifier(expression)) {
    into.add(expression.text);
    return into;
  }

  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return directValueReferences(expression.expression, into);
  }

  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    // A directly called imported/local factory can itself be followed to its
    // declared surface. Arguments are not followed: `createStore(database)` is
    // the normal encapsulation pattern and the call result is what matters.
    if (ts.isIdentifier(expression.expression)) into.add(expression.expression.text);
    return into;
  }

  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property)) {
        directValueReferences(property.initializer, into);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        into.add(property.name.text);
      } else if (ts.isSpreadAssignment(property)) {
        directValueReferences(property.expression, into);
      } else if (ts.isMethodDeclaration(property)) {
        functionReturnReferences(property, into);
      }
    }
    return into;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) directValueReferences(element, into);
    return into;
  }

  if (ts.isConditionalExpression(expression)) {
    directValueReferences(expression.whenTrue, into);
    directValueReferences(expression.whenFalse, into);
    return into;
  }

  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    functionReturnReferences(expression, into);
  }

  return into;
}

function functionReturnReferences(node, into = new Set()) {
  const aliases = new Map();
  const returned = new Set();

  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
    directValueReferences(node.body, returned);
  } else if (node.body !== undefined) {
    const visit = (current) => {
      if (current !== node && ts.isFunctionLike(current)) return;

      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
        aliases.set(current.name.text, [...directValueReferences(current.initializer)]);
      }

      if (ts.isReturnStatement(current)) {
        directValueReferences(current.expression, returned);
        return;
      }

      ts.forEachChild(current, visit);
    };

    visit(node.body);
  }

  const queue = [...returned];
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);

    const source = aliases.get(name);
    if (source === undefined) into.add(name);
    else queue.push(...source);
  }

  return into;
}

/** Does this declaration carry the `export` modifier? */
function isExported(node) {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

/**
 * The surface of one class: whether every member states its type, and every
 * type identifier the class names.
 *
 * A class is a value whose shape IS its members, so "explicitly annotated"
 * means each member says what it is. An unannotated property initialised from
 * a Prisma client is precisely the leak this check exists to see.
 */
function classSurface(node) {
  const identifiers = new Set();
  const broadTypes = new Set();
  const valueReferences = new Set();
  const parameters = typeParameterNames(node);
  let annotated = true;

  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) typeIdentifiers(type, identifiers);
    for (const type of clause.types) broadTypeReasons(type, parameters, broadTypes);
  }

  for (const member of node.members) {
    const isPrivate = (ts.getModifiers(member) ?? []).some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    );

    // `#field` and `private`/`protected` members are not part of the surface.
    if (isPrivate) continue;
    if (member.name !== undefined && ts.isPrivateIdentifier(member.name)) continue;

    if (ts.isPropertyDeclaration(member)) {
      if (member.type === undefined) annotated = false;
      else {
        typeIdentifiers(member.type, identifiers);
        broadTypeReasons(member.type, parameters, broadTypes);
      }
      directValueReferences(member.initializer, valueReferences);
      continue;
    }

    if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) {
      if (member.type === undefined) annotated = false;
      else {
        typeIdentifiers(member.type, identifiers);
        broadTypeReasons(member.type, parameters, broadTypes);
      }
      for (const parameter of member.parameters) {
        typeIdentifiers(parameter.type, identifiers);
        broadTypeReasons(parameter.type, parameters, broadTypes);
      }
      functionReturnReferences(member, valueReferences);
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      for (const parameter of member.parameters) {
        typeIdentifiers(parameter.type, identifiers);
        broadTypeReasons(parameter.type, parameters, broadTypes);
        // A parameter property is a public field declared in the signature.
        const isParameterProperty = (ts.getModifiers(parameter) ?? []).some((m) =>
          [
            ts.SyntaxKind.PublicKeyword,
            ts.SyntaxKind.ReadonlyKeyword,
            ts.SyntaxKind.PrivateKeyword,
            ts.SyntaxKind.ProtectedKeyword,
          ].includes(m.kind),
        );
        if (isParameterProperty && parameter.type === undefined) annotated = false;
      }
    }
  }

  return {
    annotated,
    identifiers: [...identifiers],
    broadTypes: [...broadTypes],
    valueReferences: [...valueReferences],
  };
}

const surfaceCache = new Map();

/**
 * Describes one module's exported surface.
 *
 * Returns:
 *   `importBindings`  local name -> { specifier, typeOnly }
 *   `localTypes`      locally declared interface/type-alias name -> identifiers
 *   `starReexports`   [{ specifier }]
 *   `exports`         [{ name, kind, annotated, identifiers, from, localName }]
 *
 * On `exports`, `from` is set for a NAMED re-export (`export { a } from './b'`)
 * and `localName` for a local re-export of an imported binding
 * (`import { a } from './b'; export { a };`) — the two shapes that let a
 * surface be assembled somewhere other than where it is declared.
 */
export function describeExportSurface(file) {
  const cached = surfaceCache.get(file);
  if (cached !== undefined) return cached;

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    const empty = {
      unreadable: true,
      importBindings: new Map(),
      localTypes: new Map(),
      starReexports: [],
      exports: [],
    };
    surfaceCache.set(file, empty);
    return empty;
  }

  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(file),
  );

  const importBindings = new Map();
  const localTypes = new Map();
  const localBroadTypes = new Map();
  const starReexports = [];
  const exports = [];

  const declarations = new Map();

  // `imported` is the name the SOURCE module exports it under — the left half
  // of `import { a as b }`. Following a surface means asking the source module
  // about the name IT declares, not the name the importer chose.
  const bindImport = (name, specifier, typeOnly, imported) => {
    importBindings.set(name, { specifier, typeOnly, imported });
  };

  for (const statement of source.statements) {
    // ---- import … from '…' ---------------------------------------------
    if (ts.isImportDeclaration(statement)) {
      const specifier = ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
      if (specifier === null) continue;

      const clause = statement.importClause;
      if (clause === undefined) continue;

      const typeOnly = clause.isTypeOnly === true;
      if (clause.name !== undefined) {
        bindImport(clause.name.text, specifier, typeOnly, 'default');
      }

      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;

      if (ts.isNamespaceImport(bindings)) {
        // A namespace binding exposes the whole module under one name, so
        // there is no single source name to follow — '*' says so.
        bindImport(bindings.name.text, specifier, typeOnly, '*');
      } else {
        for (const element of bindings.elements) {
          bindImport(
            element.name.text,
            specifier,
            typeOnly || element.isTypeOnly,
            element.propertyName?.text ?? element.name.text,
          );
        }
      }
      continue;
    }

    // ---- import x = require('…') ----------------------------------------
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      bindImport(
        statement.name.text,
        statement.moduleReference.expression.text,
        false,
        '*',
      );
      continue;
    }

    // ---- export … from '…' | export { … } | export * from '…' -----------
    if (ts.isExportDeclaration(statement)) {
      const specifier =
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;

      const clause = statement.exportClause;

      if (clause === undefined) {
        // `export * from '…'` — the entire surface of another module becomes
        // part of this one, so it is followed rather than assumed narrow.
        if (specifier !== null) starReexports.push({ specifier });
        continue;
      }

      if (ts.isNamespaceExport(clause)) {
        // `export * as ns from '…'`. Every name of the target is exposed under
        // one binding, so the target's whole surface is in play.
        if (specifier !== null) starReexports.push({ specifier });
        continue;
      }

      for (const element of clause.elements) {
        const exported = element.name.text;
        const original = element.propertyName?.text ?? exported;

        if (specifier !== null) {
          exports.push({
            name: exported,
            kind: 'reexport',
            annotated: true,
            identifiers: [],
            from: specifier,
            sourceName: original,
            localName: null,
          });
          continue;
        }

        exports.push({
          name: exported,
          kind: 'local-export',
          annotated: true,
          identifiers: [],
          from: null,
          sourceName: original,
          localName: original,
        });
      }
      continue;
    }

    // ---- export default … ------------------------------------------------
    if (ts.isExportAssignment(statement)) {
      const named = ts.isIdentifier(statement.expression)
        ? statement.expression.text
        : null;

      exports.push({
        name: 'default',
        kind: named === null ? 'default-expression' : 'local-export',
        // A default export carries no declared type of its own.
        annotated: false,
        identifiers: [],
        from: null,
        sourceName: named,
        localName: named,
      });
      continue;
    }

    // ---- local type declarations (exported or not) -----------------------
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      const identifiers = [...typeIdentifiers(statement)];
      const broadTypes = [...broadTypeReasons(statement, typeParameterNames(statement))];
      localTypes.set(statement.name.text, identifiers);
      localBroadTypes.set(statement.name.text, broadTypes);

      const record = {
        name: statement.name.text,
        kind: 'type',
        annotated: true,
        identifiers,
        broadTypes,
        valueReferences: [],
        from: null,
        sourceName: null,
        localName: null,
      };
      declarations.set(statement.name.text, record);
      if (isExported(statement)) exports.push(record);
      continue;
    }

    // ---- exported value declarations -------------------------------------
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      const identifiers = new Set();
      const broadTypes = new Set();
      const parameters = typeParameterNames(statement);
      typeIdentifiers(statement.type, identifiers);
      broadTypeReasons(statement.type, parameters, broadTypes);
      for (const parameter of statement.parameters) {
        typeIdentifiers(parameter.type, identifiers);
        broadTypeReasons(parameter.type, parameters, broadTypes);
      }

      const record = {
        name: statement.name.text,
        kind: 'function',
        annotated: statement.type !== undefined,
        identifiers: [...identifiers],
        broadTypes: [...broadTypes],
        valueReferences: [...functionReturnReferences(statement)],
        from: null,
        sourceName: null,
        localName: null,
      };
      declarations.set(record.name, record);
      if (isExported(statement)) exports.push(record);
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      const { annotated, identifiers, broadTypes, valueReferences } =
        classSurface(statement);
      const record = {
        name: statement.name.text,
        kind: 'class',
        annotated,
        identifiers,
        broadTypes,
        valueReferences,
        from: null,
        sourceName: null,
        localName: null,
      };
      declarations.set(record.name, record);
      if (isExported(statement)) exports.push(record);
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      const record = {
        name: statement.name.text,
        kind: 'enum',
        annotated: true,
        identifiers: [],
        broadTypes: [],
        valueReferences: [],
        from: null,
        sourceName: null,
        localName: null,
      };
      declarations.set(record.name, record);
      if (isExported(statement)) exports.push(record);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;

        const record = {
          name: declaration.name.text,
          kind: 'variable',
          annotated: declaration.type !== undefined,
          identifiers: [...typeIdentifiers(declaration.type)],
          broadTypes: [
            ...broadTypeReasons(declaration.type, typeParameterNames(declaration)),
          ],
          valueReferences:
            declaration.initializer !== undefined &&
            (ts.isArrowFunction(declaration.initializer) ||
              ts.isFunctionExpression(declaration.initializer))
              ? [...functionReturnReferences(declaration.initializer)]
              : [...directValueReferences(declaration.initializer)],
          from: null,
          sourceName: null,
          localName: null,
        };
        declarations.set(record.name, record);
        if (isExported(statement)) exports.push(record);
      }
    }
  }

  const described = {
    unreadable: false,
    importBindings,
    localTypes,
    localBroadTypes,
    starReexports,
    exports,
    declarations,
  };

  surfaceCache.set(file, described);
  return described;
}

/** Clears the parsed-surface cache. Test support only. */
export function resetSurfaceCache() {
  surfaceCache.clear();
}

/**
 * Expands type identifiers through LOCALLY declared types.
 *
 * `type Store = { client: PrismaClient }` followed by
 * `export function make(): Store` names only `Store` at the boundary, and the
 * capability is one hop away inside the module. Following local declarations
 * closes that, and stops there: a type imported from elsewhere is traced by its
 * import binding instead, which is what identifies where it came from.
 */
export function expandLocalTypes(identifiers, localTypes) {
  const resolved = new Set();
  const queue = [...identifiers];

  while (queue.length > 0) {
    const name = queue.shift();
    if (resolved.has(name)) continue;
    resolved.add(name);

    for (const nested of localTypes.get(name) ?? []) {
      if (!resolved.has(nested)) queue.push(nested);
    }
  }

  return [...resolved];
}

export { ts };
