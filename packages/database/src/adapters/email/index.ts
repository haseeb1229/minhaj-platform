import 'server-only';

/**
 * THE public entry of the Layer-0 `email` concern.
 *
 * Semantic owner: the Layer-0 `email` concern declared in this package's
 * manifest — infrastructure, not a bounded context (DOMAIN_MODEL.md §1.1).
 * It depends on no bounded context and no Identity service; contexts reach it
 * only through the `@minhaj/contracts/platform` interfaces.
 *
 * WHY IT LIVES IN THIS PACKAGE. ARCHITECTURE.md §4.6.1 gives the shared email
 * concern BOTH the provider contract and the delivery metadata, and the
 * metadata is relational state that needs the private Prisma client. Splitting
 * one concern across two packages to keep the provider away from the database
 * would put its two halves in different places for no gain. The alternative —
 * a new Layer-0 package — is an architecture decision about workspace roles,
 * not something to invent while implementing (see the Stage-B report).
 */

export {
  classifyProviderStatus,
  createResendProvider,
  providerFailureCode,
  type ResendConfiguration,
} from './provider.ts';
export {
  createEmailDeliveryStore,
  createEmailSuppression,
  createProviderEventStore,
  type DeliveryStoreConfiguration,
} from './delivery.ts';
export {
  messageIdFromEvent,
  recipientFromEvent,
  verifyResendWebhook,
  type WebhookConfiguration,
  type WebhookHeaders,
  type WebhookRejection,
  type WebhookVerification,
} from './webhook.ts';
export { recipientDigest, type DigestConfiguration } from './digest.ts';
