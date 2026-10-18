import 'server-only';

import { cookies } from 'next/headers';

import type { Locale } from '@minhaj/contracts';

import {
  DONATION_STATUS_COOKIE,
  DONATION_STATUS_COOKIE_SECONDS,
  donationStatusCookiePath,
} from '@/components/donations/presentation';
import { serverEnv } from '@/config/server-env';

/**
 * WRITES the anonymous donation's status cookie — and nothing else
 * (DELIVERY_PLAN.md Phase 27).
 *
 * WHY IT LIVES HERE AND NOT IN THE GIVING ACTION. The anonymous `/donate`
 * action belongs to the public tree, which reads no cookie, no session and no
 * header beyond the limiter's address (ARCHITECTURE.md §8.1). Setting this
 * one cookie is the only cookie operation the giving flow needs, so it is
 * this one narrow writer: it calls `.set` once and has no way to read,
 * enumerate or delete any cookie — the architecture suite proves it. The
 * provider's return page, outside the public tree, is the only reader.
 *
 * WHAT IT HOLDS. The opaque 43-character status token — a bearer that reads
 * ONE donation's status and nothing else, stored only as a digest. HttpOnly,
 * so no script reads it; `SameSite=Lax`, so the top-level return from the
 * provider carries it; scoped to the giving pages of the donor's locale;
 * `Secure` whenever the application's own origin is HTTPS; one day.
 */
export async function writeDonationStatusCookie(
  locale: Locale,
  token: string,
): Promise<void> {
  (await cookies()).set(DONATION_STATUS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(serverEnv().AUTH_BASE_URL).protocol === 'https:',
    path: donationStatusCookiePath(locale),
    maxAge: DONATION_STATUS_COOKIE_SECONDS,
  });
}
