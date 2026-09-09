import { describe, expect, it } from 'vitest';

import {
  FALLBACK_LOCALE,
  directionOf,
  resolveDefaultLocale,
} from '../../apps/web/src/config/locale.ts';

/**
 * N2 — locale configuration must behave as it is documented to behave.
 *
 * Review #3 found `NEXT_PUBLIC_DEFAULT_LOCALE` resolved with `.catch('en')`,
 * silently replacing an invalid explicit value with English, while the comment
 * beside it claimed invalid configuration fails.
 *
 * Silently discarding a deliberate value is the worse of the two failures the
 * code could have: the build passes, the site renders in the wrong language and
 * the wrong text DIRECTION, and nothing anywhere explains why. For a
 * trilingual platform with two RTL locales (ROUTE_MAP.md §1.2) that is not a
 * cosmetic bug.
 *
 * The distinction now enforced:
 *   - unset or blank  → the documented default, because nothing was configured
 *   - present, valid  → that locale
 *   - present, invalid → a build failure naming the variable
 */

describe('N2 — absent configuration uses the documented default', () => {
  it('falls back when the variable is unset', () => {
    expect(resolveDefaultLocale(undefined)).toBe(FALLBACK_LOCALE);
    expect(FALLBACK_LOCALE).toBe('en');
  });

  it('falls back when the variable is blank', () => {
    // `.env.example` is valueless by policy (SECURITY_BASELINE.md §18.1), so
    // copying it yields `NEXT_PUBLIC_DEFAULT_LOCALE=` — the documented, working
    // local configuration. Failing here would break the documented setup.
    expect(resolveDefaultLocale('')).toBe(FALLBACK_LOCALE);
  });

  it('falls back when the variable is whitespace only', () => {
    expect(resolveDefaultLocale('   ')).toBe(FALLBACK_LOCALE);
  });
});

describe('N2 — every supported locale resolves to itself', () => {
  it.each(['en', 'ur', 'ar'] as const)('accepts %s', (locale) => {
    expect(resolveDefaultLocale(locale)).toBe(locale);
  });

  it('resolves the correct direction for each', () => {
    // The reason an invalid value must not be swallowed: direction follows
    // locale, and a wrong direction is a visibly broken page.
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('ur')).toBe('rtl');
    expect(directionOf('ar')).toBe('rtl');
  });
});

describe('N2 — an explicitly invalid locale FAILS rather than falling back', () => {
  it('throws for an unsupported language code', () => {
    // Someone wrote `de` and meant it. Substituting English hides a real
    // configuration error behind a working-looking build.
    expect(() => resolveDefaultLocale('de')).toThrow(/NEXT_PUBLIC_DEFAULT_LOCALE/);
  });

  it('throws for a plausible-but-wrong value', () => {
    // `en-GB` is the shape of a locale and is not one of the three supported.
    expect(() => resolveDefaultLocale('en-GB')).toThrow(/NEXT_PUBLIC_DEFAULT_LOCALE/);
  });

  it('throws for a value differing only in case', () => {
    expect(() => resolveDefaultLocale('EN')).toThrow(/NEXT_PUBLIC_DEFAULT_LOCALE/);
  });

  it('names the supported locales so the error is actionable', () => {
    expect(() => resolveDefaultLocale('de')).toThrow(/en, ur, ar/);
  });

  it('explains that leaving it unset is the supported way to get the default', () => {
    // Without this, the obvious "fix" for the error is to delete the check.
    expect(() => resolveDefaultLocale('de')).toThrow(/unset/);
  });
});

describe('N2 — the documentation and the behaviour agree', () => {
  it('no longer swallows invalid configuration with `.catch`', async () => {
    // The specific defect: `localeSchema.catch('en')`. Asserting its absence
    // stops it returning as a convenient fix for a failing build.
    //
    // Matched as a real CALL on the schema, not as the bare substring, so the
    // module may still name the defect it was written to correct.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('apps/web/src/config/locale.ts', 'utf8');

    expect(source).not.toMatch(/localeSchema[\s\S]{0,20}\.catch\(/);
  });

  it('keeps locale resolution off the render path', async () => {
    // ARCHITECTURE.md §8: the anonymous public tree must stay cacheable.
    // Reading configuration during render would force every route dynamic —
    // the regression this module exists to avoid — so the value stays a
    // build-time constant and no route declares `dynamic = 'force-dynamic'`.
    //
    // Matched as the real ROUTE SEGMENT EXPORT rather than as the bare string,
    // because these files legitimately discuss the regression in prose and a
    // test that forbids explaining itself is a bad test.
    const { readFile } = await import('node:fs/promises');
    const forceDynamicExport =
      /export\s+const\s+dynamic\s*(:[^=]+)?=\s*['"]force-dynamic['"]/;

    for (const file of [
      'apps/web/src/config/locale.ts',
      'apps/web/src/app/layout.tsx',
      'apps/web/src/app/page.tsx',
    ]) {
      const source = await readFile(file, 'utf8');

      expect(source, `${file} must not force dynamic rendering`).not.toMatch(
        forceDynamicExport,
      );
    }
  });
});
