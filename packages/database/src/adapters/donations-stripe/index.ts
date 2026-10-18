import 'server-only';

/**
 * THE public entry of the Stripe payment adapter — SANDBOX ENGINEERING
 * ADAPTER, NOT PRODUCTION PROVIDER SELECTION.
 *
 * Semantic owner: the Donations bounded context, which depends on it only
 * through `PaymentProviderPort` (`@minhaj/contracts/donations`). It holds no
 * database capability; it is hosted here beside Donations' persistence adapter
 * so the context's two adapters live in one place.
 *
 * Exported: the factory, the pure configuration validator, the capability map
 * and the configuration type. The HTTP exchange, wire schemas, unit
 * conversion and webhook verifier stay private.
 */

export { createStripePaymentProvider, STRIPE_CAPABILITIES } from './provider.ts';
export {
  STRIPE_ORIGINS,
  validateStripeConfig,
  type StripeConfigInput,
  type StripeProviderConfig,
} from './config.ts';
