import 'server-only';

import {
  createNewsletter,
  createPersonalDisposition,
  createPersonalExport,
  createPersonalHistory,
  createPersonalNotifications,
  createPersonalPurge,
  createPersonalSaved,
  createPersonalSettings,
  createRateLimiter,
  rateLimitKey,
  recipientDigest,
} from '@minhaj/database';

import {
  createAccountService,
  createHistoryService,
  createNewsletterService,
  createNotificationService,
  createSavedService,
  createSettingsService,
  type AccountService,
  type HistoryService,
  type LimitKey,
  type NewsletterService,
  type NotificationService,
  type PublicTargetPort,
  type SavedService,
  type SettingsService,
} from '@/contexts/personalisation-notifications';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { isPublicTarget } from './personal-targets';

/**
 * The Personalisation & Notifications runtime — Layer 4 wiring, authenticated
 * surfaces only (ARCHITECTURE.md §8.1).
 *
 * THERE IS NO PUBLIC-READ ROOT for this context, and none may be added: no
 * anonymous page reads saved state, notes, history, progress, preferences or
 * notifications (DOMAIN_MODEL.md §14.2 rule 6). Public pages reach a person's
 * own state only through the private `/api/my/*` handlers their island calls
 * after hydration.
 *
 * Personalisation depends on Identity alone. Everything it needs to know about
 * content — whether a target is public now — is answered here by the owners'
 * public read roots (`personal-targets.ts`), never imported by the context.
 */

interface PersonalisationRuntime {
  readonly saved: SavedService;
  readonly history: HistoryService;
  readonly settings: SettingsService;
  readonly notifications: NotificationService;
  readonly account: AccountService;
  readonly newsletter: NewsletterService;
}

const publicTargets: PublicTargetPort = { available: isPublicTarget };

let runtime: PersonalisationRuntime | null = null;

export function personalisationRuntime(): PersonalisationRuntime {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const limiter = createRateLimiter(configuration);
  const key: LimitKey = (purpose, subject) =>
    rateLimitKey({ purpose, subject, configuration });
  const saved = createPersonalSaved();
  const history = createPersonalHistory();
  const settings = createPersonalSettings();

  return (runtime = {
    saved: createSavedService({ saved, targets: publicTargets, limiter, key }),
    history: createHistoryService({ history, targets: publicTargets, limiter, key }),
    settings: createSettingsService({ settings, saved, history, limiter, key }),
    notifications: createNotificationService({
      notifications: createPersonalNotifications(),
      limiter,
      key,
    }),
    account: createAccountService({
      exports: createPersonalExport(),
      disposition: createPersonalDisposition(),
      purge: createPersonalPurge(),
      // Identity's OWN answer about its own lifecycle, and nothing more.
      accounts: {
        closedAccounts: (ids) => identityRuntime().administration.closedAccounts(ids),
      },
      limiter,
      key,
    }),
    newsletter: createNewsletterService({
      newsletter: createNewsletter(),
      limiter,
      key,
      digest: (email) => ({
        digest: recipientDigest(email, {
          key: environment.EMAIL_DIGEST_KEY,
          keyVersion: environment.EMAIL_DIGEST_KEY_VERSION,
        }),
        keyVersion: environment.EMAIL_DIGEST_KEY_VERSION,
      }),
      tokenKey: {
        key: environment.NEWSLETTER_TOKEN_KEY,
        version: environment.NEWSLETTER_TOKEN_KEY_VERSION,
      },
      // MARKETING scope: any provider bounce or complaint suppresses the
      // newsletter. The reverse never holds — nothing here can suppress
      // Identity's transactional mail (ARCHITECTURE.md §4.6.1).
      suppressed: (email) =>
        identityRuntime().suppression.isSuppressed({
          recipient: email,
          scope: 'marketing',
        }),
      enqueue: async (delivery) => {
        await identityRuntime().deliveries.enqueue({
          purpose: 'newsletter.confirmation',
          ...delivery,
        });
      },
      baseUrl: environment.AUTH_BASE_URL,
      authority: {
        permits: (actor, permission) =>
          identityRuntime().authorization.hasPermission(actor.accountId, permission),
      },
    }),
  });
}
