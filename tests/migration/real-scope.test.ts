import { describe, expect, it } from 'vitest';

import { authorisedScopeIsReal, isRealHostName } from '@minhaj/contracts/migration';

/**
 * An AUTHORISED source's scope (Phase 30): real public DNS names only, an
 * `https` site-root base on one of them. Every host is judged — not only the
 * base URL's — so a literal address or a single-label name can never be
 * recorded beside a real one.
 */
describe('isRealHostName', () => {
  it.each(['www.minhaj.org', 'minhaj.info', 'thefatwa.com', 'www.irfan-ul-quran.com'])(
    'accepts %s',
    (host) => expect(isRealHostName(host)).toBe(true),
  );

  it.each([
    '93.184.216.34',
    '::1',
    '[2001:db8::1]',
    'localhost',
    'intranet',
    'videos.fixture.invalid',
    'site.invalid',
    'WWW.MINHAJ.ORG',
    '-bad.example.org',
    'bad-.example.org',
    'example..org',
    'example.org.',
    'example.123',
    'a'.repeat(64) + '.example.org',
  ])('refuses %s', (host) => expect(isRealHostName(host)).toBe(false));
});

describe('authorisedScopeIsReal', () => {
  it('accepts an https site root on one of its real hosts', () => {
    expect(authorisedScopeIsReal('https://www.minhaj.org/', ['www.minhaj.org'])).toBe(
      true,
    );
  });

  it('refuses a literal address or single-label name listed beside a real host', () => {
    expect(
      authorisedScopeIsReal('https://www.minhaj.org/', [
        'www.minhaj.org',
        '93.184.216.34',
      ]),
    ).toBe(false);
    expect(
      authorisedScopeIsReal('https://www.minhaj.org/', ['www.minhaj.org', 'localhost']),
    ).toBe(false);
  });

  it('refuses http, a non-root base, a query and a base off its hosts', () => {
    expect(authorisedScopeIsReal('http://www.minhaj.org/', ['www.minhaj.org'])).toBe(
      false,
    );
    expect(
      authorisedScopeIsReal('https://www.minhaj.org/english', ['www.minhaj.org']),
    ).toBe(false);
    expect(authorisedScopeIsReal('https://www.minhaj.org/?a=1', ['www.minhaj.org'])).toBe(
      false,
    );
    expect(authorisedScopeIsReal('https://minhaj.org/', ['www.minhaj.org'])).toBe(false);
  });
});
