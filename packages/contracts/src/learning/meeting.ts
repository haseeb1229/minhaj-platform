/**
 * The `MeetingProvider` abstraction (ARCHITECTURE.md §4.7; DOMAIN_MODEL.md
 * §13.1; SECURITY_BASELINE.md §11) — Phase 23.
 *
 * V1 IS MANUAL. A teacher or an administrator creates the meeting in Google
 * themselves and pastes the link; the platform validates and stores a STRING.
 * It never calls a Google API, holds no OAuth, Calendar or Meet credential and
 * never embeds a meeting — the join link is rendered as an ordinary described
 * external link on a private page. Automated provisioning is a later,
 * separately approved integration; this interface is the seam it would fill,
 * and nothing more.
 *
 * ONE PROVIDER, STRICTLY VALIDATED. For Google Meet only an HTTPS address on
 * exactly `meet.google.com` is accepted — parsed by the standard URL parser,
 * never by a regular expression over the raw text — with no credentials, no
 * port, no query, no fragment, and a path that is a meeting code. The RAW
 * input is refused before parsing when it carries a backslash or a percent
 * escape, because the parser would otherwise normalise `meet%2egoogle.com`
 * and `meet.google.com\@evil.example` into something that passes.
 *
 * PURE AND BROWSER-SAFE: no clock, no network, no storage.
 */

export const MEETING_PROVIDERS = Object.freeze(['google-meet'] as const);
export type MeetingProviderKey = (typeof MEETING_PROVIDERS)[number];

export interface MeetingProvider {
  readonly key: MeetingProviderKey;
  /** The host every accepted address names, exactly. */
  readonly host: string;
  /**
   * The canonical form of a meeting address this provider accepts, or `null`.
   * Canonical means: lower-case code, no trailing slash, nothing but the
   * scheme, the host and the code.
   */
  normalise(raw: string): string | null;
}

/** A Google Meet code: three, four and three lower-case letters. */
const MEET_CODE = /^\/([a-z]{3})-([a-z]{4})-([a-z]{3})\/?$/;

/** The longest address worth parsing. A Meet link is under sixty characters. */
const MAX_RAW_LENGTH = 200;

export const googleMeetProvider: MeetingProvider = Object.freeze({
  key: 'google-meet',
  host: 'meet.google.com',
  normalise(raw: string): string | null {
    const value = raw.trim();
    if (value.length === 0 || value.length > MAX_RAW_LENGTH) return null;
    // Refused on the RAW text: a backslash is a lookalike separator some
    // parsers accept, and a percent escape lets a host be spelled past a
    // host comparison. Neither has a place in a real Meet address.
    if (value.includes('\\') || value.includes('%')) return null;
    // Protocol-relative, scheme-relative and bare-host spellings never parse
    // as HTTPS on their own; they are not "fixed up".
    if (!/^https:\/\//i.test(value)) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.hostname !== this.host || url.port !== '') return null;
    if (url.search !== '' || url.hash !== '') return null;
    const match = MEET_CODE.exec(url.pathname.toLowerCase());
    if (match === null) return null;
    return `https://${this.host}/${match[1]}-${match[2]}-${match[3]}`;
  },
});

const PROVIDERS: Readonly<Record<MeetingProviderKey, MeetingProvider>> = Object.freeze({
  'google-meet': googleMeetProvider,
});

export function meetingProviderFor(key: MeetingProviderKey): MeetingProvider {
  return PROVIDERS[key];
}

/**
 * A provider and the address a person entered, as the platform may store them:
 * consistent, canonical, or refused. The ONLY way a meeting address reaches a
 * ClassSession.
 */
export function normaliseMeeting(input: {
  readonly provider: string;
  readonly url: string;
}): { readonly provider: MeetingProviderKey; readonly url: string } | null {
  if (!(MEETING_PROVIDERS as readonly string[]).includes(input.provider)) return null;
  const provider = input.provider as MeetingProviderKey;
  const url = meetingProviderFor(provider).normalise(input.url);
  return url === null ? null : { provider, url };
}
