import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  QURAN_MODE_POSTURE,
  QURAN_SOURCE_AUTHORITIES,
  quranSourceAuthorityOf,
  type QuranSourceAuthority,
} from '../../packages/contracts/src/quran/index.ts';
import {
  isPublicWork,
  publicWork,
} from '../../packages/database/src/adapters/quran/shared.ts';

/**
 * Rebaseline R2 — the Quran `reference` authority's posture, decided in ONE
 * exhaustive table and enforced at the reader's chokepoint.
 *
 * WHAT IS PROVED HERE, CHEAPLY: every mode has a decided posture and only an
 * approved corpus may ever be indexed or listed in a sitemap; a reference
 * corpus is navigable but carries its own notice; an unknown stored authority
 * is no mode at all; the layered-work predicate never shows fixture text
 * beside reference text or the reverse; and the deployment admits a reference
 * corpus only on an explicit `enabled` AND a non-indexable build. The database
 * and the reader's own refusal are proved in `./reference.integration.test.ts`.
 */

describe('the Quran mode posture', () => {
  it('decides every authority, and nothing else', () => {
    expect(Object.keys(QURAN_MODE_POSTURE).sort()).toEqual(
      [...QURAN_SOURCE_AUTHORITIES].sort(),
    );
  });

  it('lets only an approved corpus reach a search engine or a sitemap', () => {
    for (const mode of QURAN_SOURCE_AUTHORITIES) {
      expect(QURAN_MODE_POSTURE[mode].indexable, mode).toBe(mode === 'approved');
      expect(QURAN_MODE_POSTURE[mode].sitemap, mode).toBe(mode === 'approved');
    }
  });

  it('promotes approved and reference corpora, never fixture text', () => {
    expect(QURAN_MODE_POSTURE.approved.navigation).toBe(true);
    expect(QURAN_MODE_POSTURE.reference.navigation).toBe(true);
    expect(QURAN_MODE_POSTURE.fixture.navigation).toBe(false);
  });

  it('names a reference corpus as one, and never calls fixture text anything else', () => {
    expect(QURAN_MODE_POSTURE.reference.notice).toBe('reference');
    expect(QURAN_MODE_POSTURE.fixture.notice).toBe('fixture');
    expect(QURAN_MODE_POSTURE.approved.notice).toBeNull();
  });

  it('reads a stored authority as the vocabulary, or as nothing', () => {
    for (const mode of QURAN_SOURCE_AUTHORITIES)
      expect(quranSourceAuthorityOf(mode)).toBe(mode);
    for (const value of ['', 'Approved', 'REFERENCE', 'preview', 'approved ', 'reviewed'])
      expect(quranSourceAuthorityOf(value), value).toBeNull();
  });
});

describe('the layered-work predicate', () => {
  const row = (authority: string, state = 'published') => ({
    state,
    source: { authority },
  });

  it('shows beside each corpus only works its mode admits', () => {
    const admitted: Readonly<Record<QuranSourceAuthority, readonly string[]>> = {
      approved: ['approved'],
      reference: ['reference', 'approved'],
      fixture: ['fixture', 'approved'],
    };
    for (const mode of QURAN_SOURCE_AUTHORITIES) {
      for (const authority of [...QURAN_SOURCE_AUTHORITIES, 'unknown'])
        expect(isPublicWork(mode, row(authority)), `${authority} beside ${mode}`).toBe(
          admitted[mode].includes(authority),
        );
      expect(publicWork(mode).source.is.authority.in).toEqual(admitted[mode]);
    }
  });

  it('shows nothing while no corpus is public, unpublished, or unsourced', () => {
    expect(isPublicWork(null, row('approved'))).toBe(false);
    expect(isPublicWork('approved', row('approved', 'draft'))).toBe(false);
    expect(isPublicWork('reference', { state: 'published', source: null })).toBe(false);
  });
});

describe('the deployment admission', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function admitted(env: Record<string, string | undefined>): Promise<boolean> {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { religiousReferencePreviewAdmitted } =
      await import('../../apps/web/src/config/religious-reference.ts');
    return religiousReferencePreviewAdmitted();
  }

  it('admits a reference corpus only on an explicit `enabled`', async () => {
    expect(await admitted({ RELIGIOUS_REFERENCE_PREVIEW: 'enabled' })).toBe(true);
    for (const value of [undefined, '', 'true', 'ENABLED', 'yes', 'enabled-ish'])
      expect(await admitted({ RELIGIOUS_REFERENCE_PREVIEW: value }), String(value)).toBe(
        false,
      );
  });

  it('never admits it on an indexable build, whatever the variable says', async () => {
    expect(
      await admitted({
        RELIGIOUS_REFERENCE_PREVIEW: 'enabled',
        MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED: 'true',
      }),
    ).toBe(false);
    expect(
      await admitted({
        RELIGIOUS_REFERENCE_PREVIEW: 'enabled',
        MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED: 'false',
      }),
    ).toBe(true);
  });
});
