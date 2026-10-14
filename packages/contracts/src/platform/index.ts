/**
 * `@minhaj/contracts/platform` — the Layer-0 abstraction surface.
 *
 * Database, storage, search, email, logging, auditing and rate limiting are
 * platform services exposed through interfaces, not bounded contexts
 * (DOMAIN_MODEL.md §1.1). A context depends on the interfaces here; it never
 * names the adapter behind one, and never imports a provider SDK.
 *
 * Browser-safe: types only.
 */

export type {
  AuditEvent,
  AuditPort,
  DeliveryAccepted,
  DeliveryFailureClass,
  DeliveryOperatorRecord,
  DeliveryOutcome,
  DeliveryPurpose,
  IdentityDeliveryPurpose,
  DeliveryRecord,
  DeliveryRejected,
  DeliveryStatus,
  DeliverySourcePort,
  DeliverySummary,
  DeliveryResolution,
  EmailDeliveryStorePort,
  EmailProviderPort,
  EmailSuppressionPort,
  EnqueueDelivery,
  OutboundMessage,
  ProviderEventAdmission,
  ProviderEventEffect,
  ProviderEventPort,
  ResolvedDelivery,
  RateLimitDecision,
  RateLimitRule,
  RateLimiterPort,
  SuppressionCount,
  SuppressionReason,
  SuppressionScope,
} from './ports.ts';
export { suppressionScopeOf } from './ports.ts';

export type {
  AssetAccessRequest,
  AssetAuthorizationPort,
  AssetPersistencePort,
  AssetRecord,
  AssetRejection,
  AssetState,
  AssetStream,
  ImageDimensions,
  ImageLimits,
  MalwareScannerPort,
  ScanOutcome,
  StorageServicePort,
  StoredAsset,
  UploadPolicy,
} from './storage.ts';
