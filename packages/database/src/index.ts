/**
 * `@minhaj/database` — the PUBLIC runtime surface of the persistence platform.
 *
 * WHAT THIS PACKAGE PUBLISHES
 * ---------------------------
 * Narrow, owned adapter surfaces, and nothing else.
 *
 * ARCHITECTURE.md §4.1 is explicit about what may not appear here:
 *
 *   - "Raw Prisma client construction is private infrastructure. It happens
 *      inside `packages/database` and nowhere else."
 *   - "Raw Prisma client, delegate, transaction handle and raw-query capability
 *      are never part of an ordinary application package's public API."
 *
 * This entry point once exported `getDatabaseClient` and the `DatabaseClient`
 * type. Construction did indeed happen inside the package — and then the
 * constructed client was handed out through the front door, so anything that
 * imported `@minhaj/database` HELD a Prisma client. Under Model A (§3.1.1) that
 * is possession of raw database capability, which §3.2 says neither `apps/web`
 * nor `apps/realtime` ever has, and §6.3 rule 13 says a wrapper cannot convert
 * into permitted invocation. The export is gone and stays gone.
 *
 * `getDatabaseClient` still exists, in `./client.ts`, and is still the one
 * place a Prisma client is constructed. It is reached by PACKAGE-INTERNAL
 * relative import only — by the adapters below, and by the administrative
 * tooling described at the end.
 *
 * ONE ENTRY POINT, DELIBERATELY
 * -----------------------------
 * Each adapter could have been published at its own subpath. It is not, because
 * an adapter directory published directly becomes a PACKAGE public entry, and a
 * package entry that reaches Prisma is raw capability on the public API — the
 * exact thing above. Re-exporting the narrow surfaces through one entry keeps
 * the declared adapter entries as the encapsulation boundary they are meant to
 * be, and keeps the capability walk stopping there.
 *
 * WHO OWNS WHAT
 * -------------
 * Physical placement transfers no semantic ownership (§4.1, §6.3 rule 14).
 * Ownership is DECLARED in this package's own `package.json` under
 * `minhaj.persistenceAdapters`, and the architecture gate fails closed on an
 * adapter no declaration owns:
 *
 *   - `identity-access` — the Identity & Access CONTEXT owns it
 *   - `people-contributors` — the People & Contributors CONTEXT owns it
 *   - `taxonomy` — the Taxonomy CONTEXT owns it
 *   - `email`, `rate-limiting`, `auditing` — Layer-0 platform CONCERNS own
 *     them, and a Layer-0 adapter may reach no bounded context at all
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

/* ---- Identity & Access (context-owned) ---------------------------------- */

export {
  AuthMechanicsError,
  createAuthMechanicsAdapter,
  createIdentityPersistence,
  tombstoneEmail,
} from './adapters/identity-access/index.ts';

export type {
  AuthMechanicsConfiguration,
  AuthMechanicsFailure,
} from './adapters/identity-access/index.ts';

export {
  AuthorizationDataError,
  createAuthorizationPersistence,
  createAuthorizationReader,
} from './adapters/identity-access/index.ts';

/* ---- People & Contributors (context-owned) ------------------------------ */

export {
  PeopleDataError,
  createPeoplePersistence,
  createPeopleReader,
} from './adapters/people-contributors/index.ts';

/* ---- Taxonomy (context-owned) ------------------------------------------- */

export {
  TaxonomyDataError,
  createTaxonomyPersistence,
  createTaxonomyReader,
} from './adapters/taxonomy/index.ts';

/* ---- Layer-0: email ----------------------------------------------------- */

export {
  classifyProviderStatus,
  createEmailDeliveryStore,
  createEmailSuppression,
  createProviderEventStore,
  createResendProvider,
  providerFailureCode,
  recipientDigest,
  recipientFromEvent,
  verifyResendWebhook,
} from './adapters/email/index.ts';

export type {
  DeliveryStoreConfiguration,
  DigestConfiguration,
  ResendConfiguration,
  WebhookConfiguration,
  WebhookHeaders,
  WebhookRejection,
  WebhookVerification,
} from './adapters/email/index.ts';

/* ---- Layer-0: auditing -------------------------------------------------- */

export { createAuditWriter } from './adapters/auditing/index.ts';

/* ---- Layer-0: rate limiting --------------------------------------------- */

export {
  createRateLimiter,
  rateLimitKey,
  sameKey,
} from './adapters/rate-limiting/index.ts';

export type { RateLimiterConfiguration } from './adapters/rate-limiting/index.ts';

export {
  createEditorialPersistence,
  createEditorialPublicReader,
} from './adapters/editorial/index.ts';
export { createCorrespondencePersistence } from './adapters/editorial/index.ts';

export { createAssetPersistence } from './adapters/storage/index.ts';

export {
  createLibraryPersistence,
  createLibraryPublicReader,
} from './adapters/library/index.ts';

/* ---- Layer-0: search ----------------------------------------------------- */

export { createSearchIndex } from './adapters/search/index.ts';

/* ---- Media (context-owned) ---------------------------------------------- */

export {
  createMediaAssetRelations,
  createMediaPersistence,
  createMediaPublicReader,
  createMediaReferences,
} from './adapters/media/index.ts';

/* ---- Global Network (context-owned) ------------------------------------- */

export {
  createGlobalPersistence,
  createGlobalPublicReader,
  createGlobalReferences,
} from './adapters/global-network/index.ts';
