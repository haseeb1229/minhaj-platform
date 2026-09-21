import { clientAddressFrom } from './request-address';
import 'server-only';

import { headers as nextHeaders, cookies as nextCookies } from 'next/headers';

import type { RequestContext } from '@/contexts/identity-access';
import type { SetCookieHeaders } from '@minhaj/contracts/identity';
import { isSupportedLocale } from '@/config/locale';
import { serverEnv } from '@/config/server-env';

/**
 * Request plumbing for Layer 4.
 *
 * THE FRAMEWORK STOPS HERE. `next/headers` appears in this file and in route
 * components; it does not appear in a context, in `server-core`, or in
 * `packages/database`. An adapter that imported a framework cookie API would
 * be unusable by the realtime process and untestable without a request.
 */

/**
 * Applies `Set-Cookie` values an auth operation produced.
 *
 * The adapter returns cookies as DATA and Layer 4 writes them, which is what
 * keeps Next.js out of the packages beneath. Session rotation depends on this
 * running: a sign-in whose cookies were dropped leaves the person looking
 * signed out immediately after signing in.
 */
export async function applySetCookies(values: SetCookieHeaders): Promise<void> {
  if (values.length === 0) return;

  const store = await nextCookies();

  for (const value of values) {
    const parsed = parseSetCookie(value);
    if (parsed === null) continue;

    store.set({
      name: parsed.name,
      // DECODED, because the store will encode it again.
      //
      // What arrives here is a `Set-Cookie` header the auth library already
      // serialised, so its value is percent-encoded. Next's cookie store
      // serialises too, and handing it an already-encoded value encodes it
      // TWICE: a signature containing `+` goes out as `%252B`, comes back
      // decoded once to `%2B`, and no longer verifies.
      //
      // The failure mode is unusually nasty. Sign-in APPEARS to work — the
      // action's own response renders the destination with the session it just
      // created — and the very next page load is signed out, with no error
      // anywhere. Decoding once here makes the round trip exact.
      value: decodeCookieValue(parsed.value),
      ...(parsed.path === undefined ? {} : { path: parsed.path }),
      ...(parsed.maxAge === undefined ? {} : { maxAge: parsed.maxAge }),
      ...(parsed.expires === undefined ? {} : { expires: parsed.expires }),
      httpOnly: parsed.httpOnly,
      secure: parsed.secure,
      sameSite: parsed.sameSite,
    });
  }
}

/**
 * Reverses one round of percent-encoding, or leaves the value alone.
 *
 * A malformed sequence is returned as-is rather than throwing: a cookie this
 * layer cannot decode is still a cookie the browser sent, and dropping the
 * whole `Set-Cookie` because of it would sign somebody out to no purpose.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

interface ParsedCookie {
  name: string;
  value: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

/**
 * Parses one `Set-Cookie` header.
 *
 * Attributes are carried across rather than re-decided here. `HttpOnly`,
 * `Secure` and `SameSite` are security properties the auth library chose for
 * that specific cookie, and re-deriving them at this layer is how a session
 * cookie quietly loses one.
 */
function parseSetCookie(header: string): ParsedCookie | null {
  const [pair, ...attributes] = header.split(';');
  if (pair === undefined) return null;

  const separator = pair.indexOf('=');
  if (separator === -1) return null;

  const parsed: ParsedCookie = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    httpOnly: false,
    secure: false,
    sameSite: 'lax',
  };

  for (const attribute of attributes) {
    const [rawName, rawValue] = attribute.split('=');
    const name = rawName?.trim().toLowerCase();
    const value = rawValue?.trim();

    if (name === 'httponly') parsed.httpOnly = true;
    else if (name === 'secure') parsed.secure = true;
    else if (name === 'path' && value !== undefined) parsed.path = value;
    else if (name === 'max-age' && value !== undefined) {
      const maxAge = Number.parseInt(value, 10);
      if (Number.isFinite(maxAge)) parsed.maxAge = maxAge;
    } else if (name === 'expires' && value !== undefined) {
      const expires = new Date(value);
      if (!Number.isNaN(expires.getTime())) parsed.expires = expires;
    } else if (name === 'samesite' && value !== undefined) {
      const sameSite = value.toLowerCase();
      if (sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none') {
        parsed.sameSite = sameSite;
      }
    }
  }

  return parsed.name === '' ? null : parsed;
}

/**
 * The client address, for per-client rate limiting.
 *
 * Read from forwarding headers because the application sits behind NGINX in
 * every deployed environment — but ONLY where the deployment says so.
 *
 * WHY THAT CONDITION MATTERS. `X-Forwarded-For` is client-supplied unless
 * something trustworthy overwrites it. A process that reads it unconditionally
 * has a per-client budget any caller can reset by changing a header, which is
 * a control that looks present and is not. When no proxy is declared, every
 * request shares one subject — a strictly tighter bucket, never a looser one.
 *
 * The per-ACCOUNT budget is unaffected either way, and it is the one that
 * protects a specific person from credential stuffing and mail bombing
 * (SECURITY_BASELINE.md §15.2).
 *
 * The value is used ONLY as a limiter subject, where it is immediately
 * HMAC-digested. It is never stored in clear and never logged (§19.2).
 */

/**
 * Rebuilds the `Cookie` header from the cookie store rather than the request.
 *
 * WHY THE STORE AND NOT `headers()`. `headers()` is the frozen INCOMING
 * request, and a Server Action that rotates the session has already superseded
 * the token in it. The replacement is written to the cookie store, and Next
 * re-renders the current route inside that same response — so a render that
 * resolved its session from `headers()` would read the token the action just
 * revoked and conclude nobody is signed in.
 *
 * That is exactly what changing a password did: the change succeeded, the new
 * cookie went to the browser, and the immediate re-render sent the person to
 * `/signin` anyway. The store is the authoritative answer to "what is this
 * session NOW", which is the question the chokepoint is supposed to ask.
 *
 * Values are re-encoded on the way out. The store hands back DECODED values —
 * both for cookies the browser sent and for ones written by `applySetCookies`
 * — while a `Cookie` header carries them encoded, which is the form the auth
 * library parses. Skipping this is the same double-encoding trap in reverse.
 *
 * For a request that sets no cookie this reproduces what the browser sent, so
 * the ordinary path is unchanged.
 */
async function currentHeaders(source: Headers): Promise<Headers> {
  const store = await nextCookies();
  const headers = new Headers(source);

  const cookie = store
    .getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');

  if (cookie === '') headers.delete('cookie');
  else headers.set('cookie', cookie);

  return headers;
}

/** Builds the context every Identity operation takes. */
export async function requestContext(locale: string): Promise<RequestContext> {
  const source = await nextHeaders();

  return {
    headers: await currentHeaders(source),
    clientAddress: clientAddressFrom(source, serverEnv().TRUST_PROXY_HEADERS),
    locale: isSupportedLocale(locale) ? locale : 'en',
  };
}
