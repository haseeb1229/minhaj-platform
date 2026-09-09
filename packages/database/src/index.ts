/**
 * `@minhaj/database` — the PUBLIC runtime surface of the persistence platform.
 *
 * WHAT THIS PACKAGE PUBLISHES
 * ---------------------------
 * Context-owned persistence adapters, and nothing else.
 *
 * ARCHITECTURE.md §4.1 is explicit about what may not appear here:
 *
 *   - "Raw Prisma client construction is private infrastructure. It happens
 *      inside `packages/database` and nowhere else."
 *   - "Raw Prisma client, delegate, transaction handle and raw-query capability
 *      are never part of an ordinary application package's public API."
 *
 * This entry point previously exported `getDatabaseClient` and the
 * `DatabaseClient` type. Construction did indeed happen inside the package —
 * and then the constructed client was handed out through the front door, so
 * anything that imported `@minhaj/database` HELD a Prisma client. Under Model A
 * (§3.1.1) that is possession of raw database capability, which §3.2 says
 * neither `apps/web` nor `apps/realtime` ever has, and §6.3 rule 13 says a
 * wrapper cannot convert into permitted invocation. The export is removed.
 *
 * `getDatabaseClient` still exists, in `./client.ts`, and is still the one place
 * a Prisma client is constructed. It is reached by PACKAGE-INTERNAL relative
 * import only — by the adapters that will live under `./adapters/`, and by the
 * administrative tooling described below.
 *
 * WHAT REPLACES IT
 * ----------------
 * A context-owned persistence adapter: narrow persistence operations
 * implementing one bounded context's port, physically implemented here and
 * semantically owned by that context (§4.1, §6.3 rule 14). Ownership is
 * declared in this package's own `package.json`, under
 * `minhaj.persistenceAdapters`, and the architecture gate fails closed on an
 * adapter that no declaration owns.
 *
 * There are none yet, and this file therefore exports nothing. That is the
 * honest state: an adapter belongs to a bounded context, no bounded context has
 * been implemented, and inventing one to populate an export list is how a
 * platform package becomes the god-package §3.1 defines it not to be. The
 * convention is nonetheless declared and enforced now, so the first adapter
 * cannot arrive unowned.
 *
 * ADMINISTRATIVE TOOLING IS NOT THIS SURFACE
 * ------------------------------------------
 * §4.1: "Administrative migration, provisioning and recovery tooling is
 * classified separately from runtime persistence adapters. The two are not
 * interchangeable and are not governed by the same rules."
 *
 * Migration, provisioning, backup, restore, recovery proof and disposable
 * test-database lifecycle live under `./lifecycle/` and are invoked by the
 * executables in `../scripts/`. They legitimately use concrete database
 * capability, and they reach it the way this package's internals do — by
 * relative import. None of it is published here, because a convenience export
 * of a lifecycle capability on the application runtime API is the same mistake
 * as exporting the client itself.
 */

import 'server-only';

export {};
