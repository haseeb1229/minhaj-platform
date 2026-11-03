import { describe, expect, it } from 'vitest';

import { descriptionDirection } from '../../apps/web/src/config/locale.ts';

/**
 * A record's description under a left-to-right label follows its own text:
 * a migrated book can pair a romanised title with an Urdu description, and
 * one label holds one locale for both (Phase 30-RV). A right-to-left label's
 * description is never handed to the browser's guess.
 */
describe('descriptionDirection', () => {
  it('lets a description under a left-to-right label follow its own text', () => {
    expect(descriptionDirection('ltr')).toBe('auto');
  });

  it('keeps a description under a right-to-left label right-to-left', () => {
    expect(descriptionDirection('rtl')).toBe('rtl');
  });
});
