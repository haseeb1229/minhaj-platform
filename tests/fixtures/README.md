# Architecture fixtures

Deliberately invalid source used to prove the architecture, server-only and RTL
rules reject what they claim to reject.

None of this is production source, and none of it ships. The checkers are
pointed at these trees explicitly by the tests in `tests/architecture/` and by
`scripts/check-server-only.mjs`; the repository's own validation runs
(`npm run check:architecture`, `npm run check:rtl`, `npm run lint`) cover
production source only.

This is why Phase 0B contains no intentionally broken production file: every
negative case lives here, and the tests PASS by proving the fixture is rejected.

## Layout

| Directory               | Purpose                                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowed/`              | Permitted dependencies in every import form. Must produce ZERO violations — a rule that also rejected these would be a wrong rule, not a strict one.                                                                                                                                                                 |
| `bypass/`               | One file per evasion route: relative path, dynamic `import()`, `require()`, `export … from`, explicit `.js` extension, deep traversal, inline `eslint-disable`, unknown context root, internals of an allowlisted context, prohibited Layer 0 package, and production `.js`/`.jsx`.                                  |
| `cycle/`                | A genuine module-level import cycle, detected in the real graph rather than in the allowlist table.                                                                                                                                                                                                                  |
| `rtl/`                  | Physical-direction layout in each form that previously evaded the rule: hoisted variable, class helper argument, template literal, important prefix and suffix, arbitrary and state variants, and inline style properties. Plus a logical control that must pass.                                                    |
| `next-client-boundary/` | An isolated Next application built by `npm run check:server-only`. `variants/` holds one Client Component per bypass (direct, dynamic, wrapper re-export, subpath); each is copied into `src/app/` for its own `next build` and must FAIL. The Server Component at `src/app/page.tsx` is the control and must BUILD. |

## Review #4 fixtures

These four reproduce the bypasses Independent Review #4 demonstrated. Each
asserts the SPECIFIC expected outcome — which rule, against which file,
resolving to which target — because "a violation occurred" would also be
satisfied by a fixture with a typo in it.

| Directory              | Reproduces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project-config/`      | **B1.** A nested `tsconfig.json` that no project references, remapping `~/contexts/quran` onto Learning. The workspace's real `tsc --noEmit -p tsconfig.json` resolves it to Quran, so the analyser must too. Also carries a genuinely _referenced_ composite project (`apps/app/src/referenced/`) with its own `^/*` alias, and a workspace inheriting `%/*` through `extends` — the fix must not have become "always use the workspace root config", which would break every legitimate composite build. |
| `next-env-bypass/`     | **B2.** `src/shared/next-env.d.ts` re-exporting a Quran internal declaration, with Messaging importing through it. The old analyser dropped the node on its BASENAME, so the laundered dependency was invisible.                                                                                                                                                                                                                                                                                           |
| `layer4/`              | **B3.** An application workspace composing several contexts' public interfaces (must PASS), reaching a context's internals (must FAIL), plus a Layer 0 package reaching a context and a `messaging -> quran` edge — so the three findings can be shown to carry three distinct rule codes.                                                                                                                                                                                                                 |
| `conditional-exports/` | **N1.** A package whose `react-server` and `browser` branches are different files and which declares no `default`. Its consuming project now DECLARES `customConditions: ["react-server"]`, so the branch resolves because the project asks for it. Paired with `conditional-unset/` below.                                                                                                                                                                                                                |

## Review #5 fixtures

Round 5 replaced the project ROOT FILE LIST with the real `ts.Program` closure,
and removed the directory-tier role default. These fixtures prove both, and
each asserts the exact rule against the exact file — Review #5 §28 is explicit
that an unrelated diagnostic must not be allowed to satisfy a test.

| Directory              | Reproduces                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `program-closure/`     | **B1.** A project that `exclude`s `src/shared/**`, an included Messaging source importing the excluded `barrel.d.ts`, and that declaration aliasing `@/contexts/quran/internal`. `tsc -p` loads it anyway and resolves the alias with the project's own `paths`. The test runs REAL `tsc --noEmit -p` and asserts it PASSES before asserting the architecture fails — the missing half in Round 4.                                                      |
| `root-declarations/`   | **B2**, five ways. `apps/plain/` carries a workspace-root `next-env.d.ts` in a workspace that is NOT a Next app (A) and an ordinary `types.d.ts` (B), proving the fix is general rather than another `next-env` special case. `apps/listed/` names its root declaration in `files` (C); `apps/excluded/` has it removed by `exclude` and imported anyway (D). `apps/web/` is the genuine generated Next declaration and must stay OUT of the graph (E). |
| `workspace-roles/`     | **B3.** An unknown `apps/*` importing only a context's PUBLIC interface — architecturally innocent, and it must STILL fail on the missing role — an unknown `packages/*` that imports nothing at all, and a workspace that declares its role explicitly and must pass.                                                                                                                                                                                  |
| `ambiguous-ownership/` | **§6 and §10.** One shared module compiled by two independent projects that map the same alias to different directories, so its imports mean two different things. Must report `ambiguous-typescript-project-ownership`. The same tree covers §10: the module sits outside every workspace directory and must still enter the graph, reported as `source-outside-any-workspace`.                                                                        |
| `conditional-unset/`   | **N1, the other direction.** The same conditional package, consumed by a project that declares NO `customConditions`. Real TypeScript resolves nothing, so the analyser must resolve nothing — the forced server-condition retry that made these disagree is gone.                                                                                                                                                                                      |

## Review #6 fixtures

Round 6 closed two blockers. B1: ownership STRENGTH (a declared root input
beating a closure-only claim) was allowed to discard an unrelated project's
incompatible claim, so the analyser answered for a build that was not the one
introducing the violation. B2: generated output was recognised by DIRECTORY
NAME, so authored source in `src/dist/` disappeared from the graph.

Every fixture below runs REAL `tsc` first: a fixture that no longer compiles
proves nothing, and the tests assert the exact diagnostic rather than merely
counting violations.

| Directory                   | Reproduces                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mixed-ownership/`          | **B1, exactly as Review #6 reproduced it.** `packages/contracts/src/contested.ts` is a ROOT input of the Contracts project and is pulled into the INDEPENDENT Web project's closure. Each maps `#target` to a different file — a safe local type, and a Quran internal. Both projects really compile; the test proves the resolutions differ, then asserts `ambiguous-typescript-project-ownership` naming BOTH configs. |
| `compatible-ownership/`     | **§8, the control.** The same ROOT + independent CLOSURE shape, but both projects resolve `#target` to the same file — expressed with DIFFERENT relative paths, so a serialized-options diff would wrongly call it ambiguous. No ambiguity may be reported, and the shared file must still be analysed.                                                                                                                  |
| `referenced-ownership/`     | **§9, the control that protects Review #5.** A genuine parent → project-reference → child, where the child owns its own source and maps `#target` to its own safe target. The reference relationship makes precedence deterministic, so differing options here are NOT ambiguity, and the child's alias must resolve as the child.                                                                                       |
| `three-compatible/`         | **§10.** One file claimed by four projects that all agree. Many claims are not ambiguity, and the file stays analysable.                                                                                                                                                                                                                                                                                                 |
| `mixed-claim-majority/`     | **§10, the other direction.** Two agreeing claims plus ONE incompatible independent claim. Ownership is not a majority vote: a single materially different claim fails closed, and the test also proves the verdict does not depend on discovery order.                                                                                                                                                                  |
| `authored-generated-names/` | **B2.** Authored barrels at `src/dist/`, `src/build/`, `src/coverage/`, `src/cache/`, plus the nested `src/features/dist/` and `src/something/build/`. Each launders Messaging → a Quran internal, and real `tsc` compiles them all. Every one must appear in the graph and have its prohibited dependency rejected.                                                                                                     |
| `generated-outdir/`         | **§18, the control.** A project with a CONFIGURED `outDir`. Output under that canonical root is genuinely generated and must stay out of the graph, while the workspace's authored sources stay in — proving the fix distinguishes identity from spelling.                                                                                                                                                               |

Note that five of the `authored-generated-names/` files are re-included
explicitly in `.gitignore` and `.dockerignore`. Those files exist precisely
because their directory names look generated, and the name-based patterns in
both ignore files would otherwise delete them from the repository and from the
Docker build context — the same class of mistake the fixture exists to catch.

## How a fixture workspace declares its architectural role

Round 5 removed the directory-tier default that silently made every unknown
`apps/*` a Layer 4 composition workspace and every unknown `packages/*` a
Layer 0 platform package. Fixtures therefore say what they are, in their own
manifest:

```json
{
  "name": "@fixture/example",
  "minhaj": { "architecturalRole": "composition" }
}
```

Valid values are the `ARCHITECTURAL_ROLES` in
`packages/config/eslint/contexts.js`. The approved production roster
(`workspaceRoles`) always wins, so this cannot promote a real package; an
unrecognised value is treated as no declaration at all and fails closed.

This is deliberately NOT a test-only privilege tier. `tests/fixtures/**` is not
whitelisted anywhere, and a fixture that omits the declaration fails exactly as
an unclassified production workspace would — which is what `workspace-roles/`
exists to prove.

## Why the directory structure mirrors production

`bypass/contexts/<slug>/` and `allowed/contexts/<slug>/` deliberately mirror
`apps/web/src/contexts/<slug>/`, so the checkers apply the same rules to the
fixtures as to real source with no special-casing. A fixture that needed
different rules would prove nothing about the rules that actually run.
