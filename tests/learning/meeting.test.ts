import { describe, expect, it } from 'vitest';

import {
  MEETING_PROVIDERS,
  googleMeetProvider,
  meetingInputSchema,
  normaliseMeeting,
} from '../../packages/contracts/src/learning/index.ts';

/**
 * Phase 23 — the manual Google Meet provider (SECURITY_BASELINE.md §11): only
 * an HTTPS `meet.google.com` meeting code, canonicalised, and every lookalike
 * the standard parser could be talked into is refused on the raw text.
 */

const CANONICAL = 'https://meet.google.com/abc-defg-hij';

describe('the Google Meet provider', () => {
  it('is the only V1 provider, and canonicalises a real address', () => {
    expect([...MEETING_PROVIDERS]).toEqual(['google-meet']);
    expect(googleMeetProvider.normalise(CANONICAL)).toBe(CANONICAL);
    expect(googleMeetProvider.normalise('https://meet.google.com/abc-defg-hij/')).toBe(
      CANONICAL,
    );
    expect(googleMeetProvider.normalise('  HTTPS://MEET.GOOGLE.COM/ABC-DEFG-HIJ ')).toBe(
      CANONICAL,
    );
    expect(googleMeetProvider.normalise('https://meet.google.com:443/abc-defg-hij')).toBe(
      CANONICAL,
    );
  });

  it.each([
    ['http://meet.google.com/abc-defg-hij', 'plain HTTP'],
    ['//meet.google.com/abc-defg-hij', 'protocol-relative'],
    ['meet.google.com/abc-defg-hij', 'bare host'],
    ['https://meet.google.com.evil.example/abc-defg-hij', 'suffixed host'],
    ['https://evil.example/meet.google.com/abc-defg-hij', 'host in the path'],
    ['https://user:pass@meet.google.com/abc-defg-hij', 'credentials'],
    ['https://meet.google.com@evil.example/abc-defg-hij', 'host as userinfo'],
    ['https://meet.google.com\\@evil.example/abc-defg-hij', 'backslash lookalike'],
    ['https://meet%2egoogle.com/abc-defg-hij', 'encoded host'],
    ['https://meet.google.com/abc-defg-hij?authuser=1', 'query'],
    ['https://meet.google.com/abc-defg-hij#x', 'fragment'],
    ['https://meet.google.com:8443/abc-defg-hij', 'unsafe port'],
    ['https://meet.google.com/lookup/abcdef', 'not a meeting code'],
    ['https://meet.google.com/', 'no code'],
    ['https://xn--meet-google.com/abc-defg-hij', 'punycode lookalike'],
    ['https://meet.googIe.com/abc-defg-hij', 'homoglyph host'],
    ['javascript:alert(1)', 'not a URL'],
    ['', 'empty'],
  ])('refuses %s (%s)', (raw) => {
    expect(googleMeetProvider.normalise(raw)).toBeNull();
  });

  it('refuses an address inconsistent with its provider, and an unknown provider', () => {
    expect(normaliseMeeting({ provider: 'google-meet', url: CANONICAL })).toEqual({
      provider: 'google-meet',
      url: CANONICAL,
    });
    expect(normaliseMeeting({ provider: 'zoom', url: CANONICAL })).toBeNull();
    expect(
      normaliseMeeting({ provider: 'google-meet', url: 'https://zoom.us/j/1' }),
    ).toBeNull();
    expect(
      meetingInputSchema.safeParse({ provider: 'zoom', url: CANONICAL }).success,
    ).toBe(false);
    expect(
      meetingInputSchema.safeParse({ provider: 'google-meet', url: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });
});
