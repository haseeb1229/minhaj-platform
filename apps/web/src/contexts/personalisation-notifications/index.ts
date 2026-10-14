/**
 * Personalisation & Notifications — the context's ONLY entry point
 * (DOMAIN_MODEL.md §14). It depends on Layer 0 and Identity & Access alone;
 * content is referenced by typed identifier and resolved at Layer 4, so no
 * content context is imported anywhere beneath this file.
 */
export {
  PERSONAL_REFUSAL_REASONS,
  PersonalRefusal,
  isPersonalRefusalReason,
  personalFailure,
  type PersonalRefusalReason,
} from './domain/refusal.ts';
export {
  WRITE_RULE,
  type LimitKey,
  type PersonalActor,
  type PublicTargetPort,
} from './application/shared.ts';
export { createSavedService, type SavedService } from './application/saved-service.ts';
export {
  HISTORY_RULE,
  createHistoryService,
  type HistoryService,
} from './application/history-service.ts';
export {
  createSettingsService,
  type SettingsService,
} from './application/settings-service.ts';
export {
  NOTIFICATION_BULK_RULE,
  createNotificationService,
  withDefaults,
  type NotificationService,
} from './application/notification-service.ts';
export {
  EXPORT_RULE,
  createAccountService,
  type AccountService,
  type ClosedAccountPort,
} from './application/account-service.ts';
export {
  NEWSLETTER_ADDRESS_RULE,
  NEWSLETTER_CLIENT_RULE,
  NEWSLETTER_LINK_RULE,
  createNewsletterLinkReader,
  createNewsletterService,
  type NewsletterLinkReader,
  type NewsletterService,
} from './application/newsletter-service.ts';
export { NEWSLETTER_MAIL_LOCALES } from './application/newsletter-mail.ts';
