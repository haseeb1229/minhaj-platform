import { describe, expect, it } from 'vitest';

import {
  PERSON_CARD_EXCERPT,
  personCardExcerpt,
  type PeopleReaderPort,
  type PublicPersonCardPage,
} from '../../packages/contracts/src/people/index.ts';
import { createPeopleReadService } from '../../apps/web/src/contexts/people-contributors/index.ts';

/**
 * Phase 30-R — published contributors as PUBLIC CARDS (leadership, the home
 * page), over a fake reader: the read is bounded, takes no actor, and the
 * card's excerpt is the biography's own opening words, never a word split.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function harness(page: PublicPersonCardPage) {
  const asked: unknown[] = [];
  const reader = {
    async listPublicPeople(input: unknown) {
      asked.push(input);
      return page;
    },
  } as unknown as PeopleReaderPort;
  return { service: createPeopleReadService({ reader }), asked };
}

describe('public contributor cards', () => {
  const page: PublicPersonCardPage = {
    items: [
      {
        id: ID(1),
        slug: 'synthetic-person',
        name: 'Synthetic Person',
        excerpt: 'A synthetic opening.',
        resolvedLocale: 'en',
        portrait: { assetId: ID(7), width: 400, height: 533, credit: null },
      },
    ],
    more: false,
  };

  it('asks the reader for one bounded page in the requested locale', async () => {
    const { service, asked } = harness(page);
    expect(await service.publicPeople({ locale: 'ur' })).toEqual(page);
    expect(asked).toEqual([{ locale: 'ur', offset: 0, limit: 24 }]);
  });

  it('clamps an absurd limit and offset rather than passing them through', async () => {
    const { service, asked } = harness(page);
    await service.publicPeople({ locale: 'en', offset: -5, limit: 10_000 });
    await service.publicPeople({ locale: 'en', offset: 3.7, limit: 0 });
    expect(asked).toEqual([
      { locale: 'en', offset: 0, limit: 24 },
      { locale: 'en', offset: 3, limit: 1 },
    ]);
  });
});

describe('a card excerpt', () => {
  it('is the first paragraph when it fits, and nothing when there is none', () => {
    expect(personCardExcerpt(null)).toBeNull();
    expect(personCardExcerpt('   ')).toBeNull();
    expect(personCardExcerpt('First paragraph.\n\nSecond paragraph.')).toBe(
      'First paragraph.',
    );
  });

  it('is cut at a word boundary with an ellipsis, never mid-word', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const excerpt = personCardExcerpt(long) ?? '';
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(PERSON_CARD_EXCERPT + 1);
    const words = excerpt.slice(0, -1).split(' ');
    for (const word of words) expect(long.split(' ')).toContain(word);
  });

  it('keeps Urdu words whole', () => {
    const urdu = 'شیخ الاسلام '.repeat(40).trim();
    const excerpt = personCardExcerpt(urdu) ?? '';
    expect(excerpt.endsWith('…')).toBe(true);
    for (const word of excerpt.slice(0, -1).split(' '))
      expect(['شیخ', 'الاسلام']).toContain(word);
  });
});
