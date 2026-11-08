import 'server-only';

import { randomBytes } from 'node:crypto';

import {
  createAuditWriter,
  createAuthorizationPersistence,
  createAuthorizationReader,
  createClassAdmin,
  createDonationActivationReader,
  createDonationCampaigns,
  createDonationCatalogueReader,
  createDonationDisposition,
  createDonationDonor,
  createDonationLedger,
  createDonationOwner,
  createDonationRefunds,
  createDonationStaff,
  createEditorialPublicReader,
  createIdentityPersistence,
  createLearner,
  createLearningActivation,
  createLearningDisposition,
  createLearningExport,
  createLearningPersistence,
  createLearningRelationshipReader,
  createLibraryPublicReader,
  createMediaPublicReader,
  createMembershipApplicant,
  createMembershipCatalogue,
  createMembershipDisposition,
  createMembershipExport,
  createMembershipStaff,
  createMessagingPersistence,
  createPeoplePersistence,
  createPeopleReader,
  createPersonalDisposition,
  createPersonalExport,
  createPersonalHistory,
  createPersonalPurge,
  createPersonalSaved,
  createPersonalSettings,
  createRateLimiter,
  createStripePaymentProvider,
  createTaxonomyPersistence,
  createTaxonomyReader,
  createTeaching,
  rateLimitKey,
  validateStripeConfig,
} from '@minhaj/database';
import type { PaymentProviderPort } from '@minhaj/contracts/donations';
import type {
  IdentityPersistencePort,
  PermissionKey,
  PrivilegedActor,
  ResolvedSession,
} from '@minhaj/contracts/identity';
import type {
  LearningReferencesPort,
  LearningTeachingAuthorityPort,
} from '@minhaj/contracts/learning';
import type { MessagingAttachmentStoragePort } from '@minhaj/contracts/messaging';
import { createAuthorizationService as createAuthorizationRuntime } from '@minhaj/server-core/authorization';
import {
  createMessagingService,
  denyAllPeers,
  type MessagingService,
} from '@minhaj/server-core/messaging';
import { createLearningRelationshipService } from '@minhaj/server-core/relationships';

import {
  createDonationsAccountService,
  createDonationsAdminService,
  createDonationsDonorService,
  createDonationsOwnerService,
} from '../contexts/donations/index.ts';
import { createAuthorizationService } from '../contexts/identity-access/index.ts';
import {
  createClassAdminService,
  createLearnerService,
  createLearningAccountService,
  createLearningService,
  createTeachingService,
} from '../contexts/learning/index.ts';
import {
  createMembershipAccountService,
  createMembershipAdminService,
  createMembershipApplicantService,
} from '../contexts/membership/index.ts';
import {
  createPeopleReadService,
  createPeopleService,
} from '../contexts/people-contributors/index.ts';
import {
  createAccountService,
  createHistoryService,
  createSavedService,
  createSettingsService,
  type PublicTargetPort,
} from '../contexts/personalisation-notifications/index.ts';
import { createTaxonomyService } from '../contexts/taxonomy/index.ts';

/**
 * The STAGING DEMONSTRATION tooling's composition root — Layer 4 (Rebaseline
 * R2; owner decision 2026-11-06, OPEN_DECISIONS.md §4.2).
 *
 * WHY A ROOT OF ITS OWN. The demo seeder (`scripts/demo/demo-runtime.ts`) runs
 * under plain Node in the operations image, outside the Next bundler, like the
 * migration tooling (`./migration-runner.ts`), and holds no database
 * capability of its own. This wires each context's services to their adapters
 * exactly as the web roots do — the SAME services, the SAME live authority —
 * without those roots' Next-only imports. Nothing here is a demo MODE: every
 * service is the production service, and the application never learns that
 * demo data exists.
 *
 * WHAT DIFFERS FROM THE WEB PROCESS, AND WHY
 *
 *   - THE RATE LIMITER'S DIGEST KEY is generated per run (the operations image
 *     holds no application secret). The limits are real and spent, in buckets
 *     no web request shares.
 *   - PAST CLASSES are scheduled by a class administration whose clock is set
 *     to the day before each class (`pastClasses`): a class that already took
 *     place cannot be scheduled "now", and the service's own scheduling rules
 *     still apply to it. Holding it and its attendance go through the real
 *     teacher service on the real clock.
 *   - PAYMENTS go to the Stripe protocol SIMULATOR started on loopback inside
 *     this process (`fixturePayments`): the `fixture` environment, synthetic
 *     credentials, no network, no money. The adapter's loopback-only rule is
 *     unchanged.
 *   - MAIL: none is sent from here. Services that owe a message write their
 *     durable intent as always; the web process relays it, and the transport
 *     refuses every `.invalid` recipient, which every persona is.
 *
 * THE DATABASE is whatever `DATABASE_URL` names — the RUNTIME principal's URL.
 * Personas and activations are the OWNER's acts and are not reachable here.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** Messaging's storage port for a process that stores no attachment. */
const NO_ATTACHMENTS: MessagingAttachmentStoragePort = {
  store: () => Promise.reject(new Error('The demo tooling stores no attachment.')),
  open: () => Promise.resolve(null),
  release: () => Promise.reject(new Error('The demo tooling releases no attachment.')),
};

/** One run's limiter configuration: a fresh key, so no bucket is shared with the web. */
function limiterConfiguration() {
  return { digestKey: randomBytes(32).toString('base64url'), digestKeyVersion: 1 };
}

export function composeStagingDemoRunner(options: {
  /** A Stripe provider bound to the demo's fixture scope, or `null` (no donations). */
  readonly payments: PaymentProviderPort | null;
  /** The base URL donations' return addresses are built from. */
  readonly baseUrl: string;
}) {
  const configuration = limiterConfiguration();
  const limiter = createRateLimiter(configuration);
  const key = (purpose: string, subject: string) =>
    rateLimitKey({ purpose, subject, configuration });

  const authorization = createAuthorizationRuntime({
    reader: createAuthorizationReader(),
  });
  const authorizationPersistence = createAuthorizationPersistence();
  const audit = createAuditWriter();
  const permits = (accountId: string, permission: PermissionKey) =>
    authorization.hasPermission(accountId, permission);
  const closedAccounts = async (ids: readonly string[]) =>
    ids.length === 0 ? [] : authorizationPersistence.closedAccountIds(ids);

  const identity = createAuthorizationService({
    authorization: authorizationPersistence,
    verifyActor: (input) => authorization.verifyPrivilegedActor(input),
  });

  const taxonomy = createTaxonomyService({
    reader: createTaxonomyReader(),
    taxonomy: createTaxonomyPersistence(),
  });
  const peopleRead = createPeopleReadService({ reader: createPeopleReader() });
  const references: LearningReferencesPort = {
    async validPeople(ids) {
      if (ids.length === 0) return true;
      const unique = [...new Set(ids)];
      return (
        (await peopleRead.contributorReferences(unique, 'en')).length === unique.length
      );
    },
    async validTopics(ids) {
      if (ids.length === 0) return true;
      return (await taxonomy.topicReferences([...ids], 'en')).length === ids.length;
    },
    async validLanguage(code) {
      const active = await taxonomy.listLanguages({ includeRetired: false });
      return active.some((entry) => entry.code === code);
    },
  };

  const teachingAuthority: LearningTeachingAuthorityPort = {
    permits,
    liveTeachingAssignments: (accountId) =>
      authorizationPersistence.liveAssignmentsCarrying(accountId, 'teaching.perform'),
  };
  const activation = createLearningActivation();
  const directory = {
    teacherAccounts: async (accountIds: readonly string[]) =>
      (await peopleRead.publicTeachers(accountIds, 'en')).map((entry) => entry.accountId),
  };
  const classAdmin = (clock?: () => Date) =>
    createClassAdminService({
      admin: createClassAdmin(),
      authority: teachingAuthority,
      activation,
      directory,
      audit,
      ...(clock === undefined ? {} : { clock }),
    });

  // Public records a person may save: each owner's PUBLIC reader, asked the
  // question the web's target resolver asks, strictly.
  const library = createLibraryPublicReader();
  const media = createMediaPublicReader();
  const editorial = createEditorialPublicReader();
  const targets: PublicTargetPort = {
    async available(target) {
      switch (target.kind) {
        case 'work':
          return (await library.workReferences([target.id])).length === 1;
        case 'video':
          return (await media.videoReferences([target.id])).length === 1;
        case 'article':
          return (await editorial.memberTargets('article', [target.id])).length === 1;
        default:
          // The demo saves no Ayah or Hadith: neither corpus is approved.
          return false;
      }
    },
  };
  const saved = createPersonalSaved();
  const history = createPersonalHistory();

  const messaging: MessagingService = createMessagingService({
    persistence: createMessagingPersistence(),
    teaching: createLearningRelationshipService({
      reader: createLearningRelationshipReader(),
      identity: { liveTeachingAssignments: teachingAuthority.liveTeachingAssignments },
    }),
    authority: { permits },
    accounts: { closedAccounts },
    peers: denyAllPeers,
    storage: NO_ATTACHMENTS,
    audit,
    limiter,
    limitKey: key,
  });

  const donationLedger = createDonationLedger();
  const donationRefunds = createDonationRefunds();
  const identityPersistence: IdentityPersistencePort = createIdentityPersistence();

  return {
    /**
     * Identity's privileged-action gate under `privilege-administration`: the
     * actor role administration demands, or `null` with the reason refused.
     */
    async requireAdministrationActor(
      session: ResolvedSession,
      permission: 'roles.administer' | 'permissions.grant',
    ): Promise<PrivilegedActor | null> {
      const outcome = await authorization.requirePrivilegedAction({
        session,
        permission,
        stepUp: 'privilege-administration',
      });
      return outcome.state === 'allowed' ? outcome.actor : null;
    },
    identity,
    /** Identity's closure of an account — the write its own service makes. */
    closeAccount: identityPersistence.closeAccount.bind(identityPersistence),
    people: createPeopleService({
      reader: createPeopleReader(),
      people: createPeoplePersistence(),
      accounts: {
        capabilities: (accountId) => authorization.contributorCapabilities(accountId),
        closedAccounts,
      },
      // The demo sets no portrait.
      images: { servableImages: async () => new Set<string>() },
    }),
    peopleRead,
    learning: createLearningService({
      persistence: createLearningPersistence(),
      authority: { permits },
      references,
    }),
    learner: createLearnerService({ learner: createLearner(), limiter, key }),
    classes: classAdmin(),
    /** The class administration as of `clock` — for classes that already took place. */
    pastClasses: (clock: () => Date) => classAdmin(clock),
    teaching: createTeachingService({
      teaching: createTeaching(),
      authority: teachingAuthority,
      activation,
      audit,
      limiter,
      key,
    }),
    learningAccount: createLearningAccountService({
      exports: createLearningExport(),
      disposition: createLearningDisposition(),
      accounts: { closedAccounts },
      limiter,
      key,
    }),
    messaging,
    membership: {
      admin: createMembershipAdminService({
        catalogue: createMembershipCatalogue(),
        staff: createMembershipStaff(),
        authority: { permits },
        accounts: { closedAccounts },
      }),
      applicant: createMembershipApplicantService({
        applicant: createMembershipApplicant(),
        exporter: createMembershipExport(),
        limiter,
        key,
      }),
      account: createMembershipAccountService({
        disposition: createMembershipDisposition(),
        accounts: { closedAccounts },
      }),
    },
    personal: {
      saved: createSavedService({ saved, targets, limiter, key }),
      history: createHistoryService({ history, targets, limiter, key }),
      settings: createSettingsService({
        settings: createPersonalSettings(),
        saved,
        history,
        limiter,
        key,
      }),
      account: createAccountService({
        exports: createPersonalExport(),
        disposition: createPersonalDisposition(),
        purge: createPersonalPurge(),
        accounts: { closedAccounts },
        limiter,
        key,
      }),
    },
    /** Published public records the demo may point at, newest first. */
    publicChoices: {
      works: (limit: number) => library.workChoices(null, limit),
      videos: (limit: number) => media.videoChoices(null, limit),
      articles: (limit: number) => editorial.memberChoices('article', null, limit),
    },
    donations: {
      admin: createDonationsAdminService({
        campaigns: createDonationCampaigns(),
        staff: createDonationStaff(),
        refunds: donationRefunds,
        ledger: donationLedger,
        provider: options.payments,
        authority: { permits },
      }),
      donor: createDonationsDonorService({
        donor: createDonationDonor(),
        catalogue: createDonationCatalogueReader(),
        activation: createDonationActivationReader(),
        ledger: donationLedger,
        provider: options.payments,
        limiter,
        key,
        baseUrl: options.baseUrl,
      }),
      owner: createDonationsOwnerService({ owner: createDonationOwner(), limiter, key }),
      account: createDonationsAccountService({
        disposition: createDonationDisposition(),
        accounts: { closedAccounts },
      }),
    },
  };
}

export type StagingDemoRunner = ReturnType<typeof composeStagingDemoRunner>;

/**
 * A Stripe provider in the `fixture` environment, bound to the simulator the
 * caller started on loopback — the adapter validates the synthetic
 * credentials and the loopback origin exactly as for the browser suite.
 */
export function fixturePayments(input: {
  readonly origin: string;
  readonly accountKey: string;
  readonly secretKey: string;
  readonly webhookSecret: string;
}): PaymentProviderPort {
  return createStripePaymentProvider(
    validateStripeConfig({
      environment: 'fixture',
      accountKey: input.accountKey,
      secretKey: input.secretKey,
      webhookSecret: input.webhookSecret,
      apiOrigin: input.origin,
      checkoutOrigin: input.origin,
      timeoutMs: 10_000,
    }),
  );
}
