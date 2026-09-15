import 'server-only';

import { createHmac } from 'node:crypto';

/**
 * Keyed recipient digests for the Layer-0 email concern.
 *
 * An email address is personal data. The delivery and suppression tables exist
 * to count attempts and to remember that a provider rejected an address —
 * neither needs to be able to read the address back, and storing it in clear
 * would put a list of everyone the platform has ever written to in an
 * infrastructure table (SECURITY_BASELINE.md §19.2).
 *
 * The digest is keyed rather than a bare hash: an unkeyed hash of an email
 * address is trivially reversible by dictionary, so it would be personal data
 * with extra steps.
 */

export interface DigestConfiguration {
  readonly key: string;
  /** Rotating the key changes every digest, so the version travels with it. */
  readonly keyVersion: number;
}

/** Matches `EmailDelivery.recipientDigest` / `EmailSuppression.recipientDigest`. */
export const DIGEST_LENGTH = 64;

export function recipientDigest(
  recipient: string,
  configuration: DigestConfiguration,
): string {
  // The address is canonicalised first so two spellings of one address cannot
  // produce two digests — which would let a suppressed address be written to
  // under a different capitalisation.
  const canonical = recipient.trim().toLowerCase();

  return createHmac('sha256', configuration.key)
    .update(canonical)
    .digest('base64url')
    .slice(0, DIGEST_LENGTH);
}
