import { describe, expect, it } from 'vitest';

import { FALLBACK_LOCALE } from '../../apps/web/src/config/locale.ts';
import * as contracts from '../../packages/contracts/src/index.ts';
import { localeSchema } from '../../packages/contracts/src/env/shared.ts';
import {
  UNPREFIXED_LOCALE,
  localizedPath,
  splitLocalePath,
} from '../../packages/contracts/src/locale-path.ts';

/**
 * THE localised-URL contract (ROUTE_MAP.md §1.1, Rebaseline R1).
 *
 * English is unprefixed (`/`, `/library`); Urdu and Arabic carry their prefix
 * (`/ur/library`, `/ar/library`). Every link, redirect, canonical URL and the
 * proxy build or parse an address through these two functions, so they are
 * proven here directly and exhaustively; the real-server behaviour is proven
 * by `locale-routing.integration.test.ts`.
 */

describe('the unprefixed locale', () => {
  it('is English, and is the routing configuration’s default locale', () => {
    expect(UNPREFIXED_LOCALE).toBe('en');
    // `apps/web/src/i18n/routing.ts` takes `defaultLocale` from this constant,
    // so the routing library and the URL builder cannot disagree.
    expect(FALLBACK_LOCALE).toBe(UNPREFIXED_LOCALE);
  });

  it('is the one the package entry point exports', () => {
    expect(contracts.UNPREFIXED_LOCALE).toBe(UNPREFIXED_LOCALE);
    expect(contracts.localizedPath).toBe(localizedPath);
    expect(contracts.splitLocalePath).toBe(splitLocalePath);
  });
});

describe('localizedPath', () => {
  it.each([
    ['en', '', '/'],
    ['en', '/', '/'],
    ['en', '/library', '/library'],
    ['en', '/watch/videos/a-lecture', '/watch/videos/a-lecture'],
    ['en', '/x?y=1', '/x?y=1'],
    ['en', '/x#h', '/x#h'],
    ['en', '/x/y?z=1&z=2#h', '/x/y?z=1&z=2#h'],
    ['en', '?q=1', '/?q=1'],
    ['en', '#h', '/#h'],
    ['ur', '', '/ur'],
    ['ur', '/', '/ur'],
    ['ur', '/library', '/ur/library'],
    ['ur', '/x?y=1', '/ur/x?y=1'],
    ['ur', '/x#h', '/ur/x#h'],
    ['ur', '?q=1', '/ur?q=1'],
    ['ur', '#h', '/ur#h'],
    ['ar', '', '/ar'],
    ['ar', '/', '/ar'],
    ['ar', '/watch/videos/a-lecture', '/ar/watch/videos/a-lecture'],
    ['ar', '/x/y?z=1&z=2#h', '/ar/x/y?z=1&z=2#h'],
    ['ar', '?q=1', '/ar?q=1'],
    ['ar', '#h', '/ar#h'],
  ])('localizedPath(%j, %j) is %j', (locale, path, expected) => {
    expect(localizedPath(locale, path)).toBe(expected);
  });

  it('never emits an `/en` prefix', () => {
    for (const path of ['', '/', '/my', '/library/books/x?offset=25', '?q=1', '#h']) {
      const built = localizedPath('en', path);
      expect(built, path).not.toMatch(/^\/en(?:[/?#]|$)/);
      expect(built.startsWith('/'), path).toBe(true);
    }
  });

  it('always yields a same-site absolute PATH, never a network-path reference', () => {
    for (const locale of localeSchema.options) {
      for (const path of ['', '/', '/x', '?q=1', '#h']) {
        const built = localizedPath(locale, path);
        expect(built.startsWith('/'), `${locale} ${path}`).toBe(true);
        expect(built.startsWith('//'), `${locale} ${path}`).toBe(false);
      }
    }
  });

  it.each([
    'library',
    'x?y=1',
    './x',
    '../x',
    ' /x',
    'https://evil.example/x',
    'evil.example',
  ])('throws on the relative or non-path value %j, in every locale', (path) => {
    for (const locale of localeSchema.options) {
      expect(() => localizedPath(locale, path), `${locale} ${path}`).toThrow(
        /must be empty or begin with/,
      );
    }
  });
});

describe('splitLocalePath', () => {
  it.each([
    ['/', { locale: 'en', rest: '', prefixed: false }],
    ['', { locale: 'en', rest: '', prefixed: false }],
    ['/library', { locale: 'en', rest: '/library', prefixed: false }],
    ['/library/books/x', { locale: 'en', rest: '/library/books/x', prefixed: false }],
    // `/en` is reported as PREFIXED English — the proxy redirects it.
    ['/en', { locale: 'en', rest: '', prefixed: true }],
    ['/en/', { locale: 'en', rest: '', prefixed: true }],
    ['/en/library', { locale: 'en', rest: '/library', prefixed: true }],
    ['/en/library/books/x', { locale: 'en', rest: '/library/books/x', prefixed: true }],
    ['/ur', { locale: 'ur', rest: '', prefixed: true }],
    ['/ur/', { locale: 'ur', rest: '', prefixed: true }],
    ['/ur/x/y', { locale: 'ur', rest: '/x/y', prefixed: true }],
    ['/ar', { locale: 'ar', rest: '', prefixed: true }],
    ['/ar/watch/videos/a', { locale: 'ar', rest: '/watch/videos/a', prefixed: true }],
    // Not a locale segment: English, and the segment stays part of the path.
    ['/enx', { locale: 'en', rest: '/enx', prefixed: false }],
    ['/enx/library', { locale: 'en', rest: '/enx/library', prefixed: false }],
    ['/urdu', { locale: 'en', rest: '/urdu', prefixed: false }],
    ['/fr/x', { locale: 'en', rest: '/fr/x', prefixed: false }],
    ['/EN/x', { locale: 'en', rest: '/EN/x', prefixed: false }],
    ['/Ur/x', { locale: 'en', rest: '/Ur/x', prefixed: false }],
    ['/en-GB/x', { locale: 'en', rest: '/en-GB/x', prefixed: false }],
    // Only the FIRST segment is a locale.
    ['/library/ur', { locale: 'en', rest: '/library/ur', prefixed: false }],
    ['/ur/en/x', { locale: 'ur', rest: '/en/x', prefixed: true }],
  ])('splitLocalePath(%j)', (pathname, expected) => {
    expect(splitLocalePath(pathname)).toEqual(expected);
  });

  it('inverts localizedPath for every locale', () => {
    for (const locale of localeSchema.options) {
      for (const rest of ['', '/x', '/library/books/a-book', '/my/saved']) {
        expect(splitLocalePath(localizedPath(locale, rest)), `${locale} ${rest}`).toEqual(
          {
            locale,
            rest,
            prefixed: locale !== UNPREFIXED_LOCALE,
          },
        );
      }
    }
  });

  it('rebuilds a legacy `/en` address as its canonical unprefixed one', () => {
    // The proxy's 301: split, then rebuild in the same locale.
    for (const [legacy, canonical] of [
      ['/en', '/'],
      ['/en/', '/'],
      ['/en/library', '/library'],
      ['/en/watch/videos/x', '/watch/videos/x'],
    ] as const) {
      const parts = splitLocalePath(legacy);
      expect(localizedPath(parts.locale, parts.rest), legacy).toBe(canonical);
    }
  });
});
