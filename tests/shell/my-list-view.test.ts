import { describe, expect, it } from 'vitest';

import { SURAH_AYAH_COUNTS } from '../../packages/contracts/src/passage/index.ts';
import {
  PERSONAL_LIMITS,
  PERSONAL_TARGET_KINDS,
  type PersonalTargetKind,
} from '../../packages/contracts/src/personalisation/index.ts';
import {
  FATWA_MAX_OFFSET,
  FATWA_OWNER_STATUSES,
  FATWA_PAGE_SIZE,
  type FatwaOwnerStatus,
} from '../../packages/contracts/src/fatwa/index.ts';
import { DONATION_STATES } from '../../packages/contracts/src/donations/index.ts';
import {
  LEARNER_OFFSET_MAX,
  LEARNING_PAGE,
} from '../../packages/contracts/src/learning/index.ts';
import {
  DONATION_GROUPS,
  donationGroup,
} from '../../apps/web/src/components/donations/presentation.ts';
import {
  MY_LIST_PAGE,
  MY_LIST_PAGE_MAX,
  myListHref,
  myListOffset,
  myListPageMax,
  myListPages,
  myListRange,
  readMyList,
  type MyListSpec,
} from '../../apps/web/src/components/my/list-view.ts';
import { quranPlace } from '../../apps/web/src/components/my/quran-place.ts';
import { myTabs, myTrail } from '../../apps/web/src/components/my/sections.ts';

/**
 * My Minhaj Part 1 — one address per view of a list, and where a Quran
 * reading position stands. Pure rules, proved here; the browser proves the
 * pages follow them (`tests/browser/personalisation.spec.ts`).
 */

const BOOKMARKS: MyListSpec<PersonalTargetKind> = {
  path: '/my/saved/bookmarks',
  param: 'kind',
  filters: PERSONAL_TARGET_KINDS,
};
const NOTES: MyListSpec<never> = { path: '/ur/my/saved/notes' };

describe('a My Minhaj list address', () => {
  it('reads the canonical spellings as they are', () => {
    expect(readMyList(BOOKMARKS, {})).toEqual({
      outcome: 'view',
      view: { page: 1, filter: null },
    });
    expect(readMyList(BOOKMARKS, { kind: 'work' })).toEqual({
      outcome: 'view',
      view: { page: 1, filter: 'work' },
    });
    expect(readMyList(BOOKMARKS, { kind: 'ayah', page: '3' })).toEqual({
      outcome: 'view',
      view: { page: 3, filter: 'ayah' },
    });
    expect(readMyList(NOTES, { page: '2' })).toEqual({
      outcome: 'view',
      view: { page: 2, filter: null },
    });
  });

  it('writes one spelling: the filter, then the page, neither when neutral', () => {
    expect(myListHref(BOOKMARKS, { page: 1, filter: null })).toBe('/my/saved/bookmarks');
    expect(myListHref(BOOKMARKS, { page: 1, filter: 'video' })).toBe(
      '/my/saved/bookmarks?kind=video',
    );
    expect(myListHref(BOOKMARKS, { page: 4, filter: 'hadith' })).toBe(
      '/my/saved/bookmarks?kind=hadith&page=4',
    );
    expect(myListHref(NOTES, { page: 2, filter: null })).toBe(
      '/ur/my/saved/notes?page=2',
    );
  });

  it.each([
    ['the first page named', { page: '1' }, '/my/saved/bookmarks'],
    ['a zero page', { page: '0' }, '/my/saved/bookmarks'],
    ['a padded page', { page: '02' }, '/my/saved/bookmarks'],
    ['a negative page', { page: '-2' }, '/my/saved/bookmarks'],
    ['a fractional page', { page: '1.5' }, '/my/saved/bookmarks'],
    ['a word for a page', { page: 'two' }, '/my/saved/bookmarks'],
    [
      'a page past the bound',
      { page: String(MY_LIST_PAGE_MAX + 1) },
      '/my/saved/bookmarks',
    ],
    ['an empty filter', { kind: '' }, '/my/saved/bookmarks'],
    [
      'another order',
      { page: '2', kind: 'work' },
      '/my/saved/bookmarks?kind=work&page=2',
    ],
    ['the old offset', { offset: '40' }, '/my/saved/bookmarks?page=3'],
    ['an old offset inside a page', { offset: '45' }, '/my/saved/bookmarks?page=3'],
    ['the old first offset', { offset: '0' }, '/my/saved/bookmarks'],
    ['a malformed old offset', { offset: 'x' }, '/my/saved/bookmarks'],
    ['an old offset past the bound', { offset: '99999' }, '/my/saved/bookmarks'],
    [
      'a page and an old offset',
      { kind: 'work', page: '2', offset: '80' },
      '/my/saved/bookmarks?kind=work&page=2',
    ],
  ] as const)('tidies %s with one redirect to the final address', (_label, query, to) => {
    const first = readMyList(BOOKMARKS, query);
    expect(first).toEqual({ outcome: 'redirect', to });
    // ONE redirect: the address it leads to is final.
    const search = new URL(to, 'https://minhaj.invalid').searchParams;
    expect(readMyList(BOOKMARKS, Object.fromEntries(search)).outcome).toBe('view');
  });

  it.each([
    ['an unknown kind', { kind: 'book' }],
    ['a kind in another case', { kind: 'Work' }],
    ['a repeated kind', { kind: ['work', 'video'] }],
    ['a repeated page', { page: ['1', '2'] }],
    ['a repeated offset', { offset: ['0', '20'] }],
  ] as const)('refuses %s where it was asked, never widening it', (_label, query) => {
    expect(readMyList(BOOKMARKS, query)).toEqual({ outcome: 'refused' });
  });

  it('leaves alone a parameter the list does not read', () => {
    // A list without a filter does not read `kind`, so the parameter is left
    // alone rather than refused; only its own parameters are canonicalised.
    expect(readMyList(NOTES, { kind: 'work' })).toEqual({
      outcome: 'view',
      view: { page: 1, filter: null },
    });
    expect(readMyList(BOOKMARKS, { utm: 'x', kind: 'work' })).toEqual({
      outcome: 'view',
      view: { page: 1, filter: 'work' },
    });
  });

  it('admits only the filters the list names', () => {
    const notifications: MyListSpec<'unread'> = {
      path: '/my/notifications',
      param: 'show',
      filters: ['unread'],
    };
    expect(readMyList(notifications, { show: 'unread' }).outcome).toBe('view');
    expect(readMyList(notifications, { show: 'read' })).toEqual({ outcome: 'refused' });
    expect(readMyList(notifications, { kind: 'work' }).outcome).toBe('view');
  });

  it('pages by Personalisation’s own page and never walks past its bound', () => {
    expect(MY_LIST_PAGE).toBe(PERSONAL_LIMITS.page);
    expect(myListOffset(1)).toBe(0);
    expect(myListOffset(3)).toBe(2 * MY_LIST_PAGE);
    expect(myListOffset(MY_LIST_PAGE_MAX)).toBeLessThanOrEqual(PERSONAL_LIMITS.offsetMax);
    expect(myListPages(0)).toBe(1);
    expect(myListPages(MY_LIST_PAGE)).toBe(1);
    expect(myListPages(MY_LIST_PAGE + 1)).toBe(2);
    expect(myListPages(10_000_000)).toBe(MY_LIST_PAGE_MAX);
    expect(myListRange(1, 0)).toBeNull();
    expect(myListRange(1, 7)).toEqual({ from: 1, to: 7 });
    expect(myListRange(2, MY_LIST_PAGE)).toEqual({
      from: MY_LIST_PAGE + 1,
      to: 2 * MY_LIST_PAGE,
    });
  });
});

describe('the Saved views and the trail', () => {
  it('offers the four Saved views side by side, the current one marked', () => {
    expect(myTabs('ur', 'saved', 'notes', (key) => key)).toEqual([
      { href: '/ur/my/saved', text: 'saved', current: false },
      { href: '/ur/my/saved/bookmarks', text: 'bookmarks', current: false },
      { href: '/ur/my/saved/notes', text: 'notes', current: true },
      { href: '/ur/my/saved/collections', text: 'collections', current: false },
    ]);
  });

  it('starts every trail at My Minhaj and links every crumb but the page', () => {
    expect(
      myTrail('ar', 'Home', [{ path: '/saved', text: 'Saved' }, { text: 'Notes' }]),
    ).toEqual([
      { href: '/ar/my', text: 'Home' },
      { href: '/ar/my/saved', text: 'Saved' },
      { text: 'Notes' },
    ]);
  });
});

describe('where a Quran reading position stands', () => {
  it('places an ayah among all 6,236, in the order of the Mushaf', () => {
    expect(quranPlace(1, 1, SURAH_AYAH_COUNTS)).toEqual({
      ordinal: 1,
      total: 6236,
      surahAyat: 7,
      percent: 1 / 6236,
    });
    expect(quranPlace(2, 255, SURAH_AYAH_COUNTS)?.ordinal).toBe(7 + 255);
    expect(quranPlace(114, 6, SURAH_AYAH_COUNTS)).toMatchObject({
      ordinal: 6236,
      surahAyat: 6,
      percent: 1,
    });
  });

  it.each([
    ['a Surah of nought', 0, 1],
    ['a Surah past the last', 115, 1],
    ['an ayah of nought', 2, 0],
    ['an ayah past its Surah', 1, 8],
    ['a fraction', 1.5, 1],
    ['not a number', Number.NaN, 1],
  ])('has no place for %s', (_label, surah, ayah) => {
    expect(quranPlace(surah, ayah, SURAH_AYAH_COUNTS)).toBeNull();
  });
});

/* ===========================================================================
 * My Minhaj Part 2 — lists whose owner pages by its own size
 * ========================================================================= */

describe('a list paged by its owner (My Minhaj Part 2)', () => {
  const COURSES: MyListSpec<never> = {
    path: '/my/learning',
    size: LEARNING_PAGE,
    offsetMax: LEARNER_OFFSET_MAX,
  };
  const QUESTIONS: MyListSpec<FatwaOwnerStatus> = {
    path: '/ar/my/questions',
    param: 'status',
    filters: FATWA_OWNER_STATUSES,
    size: FATWA_PAGE_SIZE,
    offsetMax: FATWA_MAX_OFFSET,
  };

  it('reads offsets, ranges and page counts by the owner’s page', () => {
    expect(myListOffset(3, COURSES)).toBe(48);
    expect(myListRange(2, 5, COURSES)).toEqual({ from: 25, to: 29 });
    expect(myListPages(49, COURSES)).toBe(3);
    expect(myListPages(0, COURSES)).toBe(1);
    expect(myListPageMax(COURSES)).toBe(Math.floor(LEARNER_OFFSET_MAX / 24) + 1);
    // Personalisation's lists are unchanged.
    expect(myListOffset(3)).toBe(40);
    expect(myListPageMax()).toBe(MY_LIST_PAGE_MAX);
  });

  it('turns the legacy offset into the owner’s page, once', () => {
    expect(readMyList(COURSES, { offset: '24' })).toEqual({
      outcome: 'redirect',
      to: '/my/learning?page=2',
    });
    expect(readMyList(COURSES, { offset: '47' })).toEqual({
      outcome: 'redirect',
      to: '/my/learning?page=2',
    });
    expect(readMyList(COURSES, { offset: '0' })).toEqual({
      outcome: 'redirect',
      to: '/my/learning',
    });
    expect(readMyList(QUESTIONS, { offset: '40' })).toEqual({
      outcome: 'redirect',
      to: '/ar/my/questions?page=3',
    });
    // Beyond the owner's bound is the first page, never a page it cannot read.
    expect(readMyList(QUESTIONS, { offset: String(FATWA_MAX_OFFSET + 20) })).toEqual({
      outcome: 'redirect',
      to: '/ar/my/questions',
    });
    expect(readMyList(COURSES, { page: String(myListPageMax(COURSES) + 1) })).toEqual({
      outcome: 'redirect',
      to: '/my/learning',
    });
  });

  it('admits each owner status and refuses anything else in place', () => {
    for (const status of FATWA_OWNER_STATUSES)
      expect(readMyList(QUESTIONS, { status, page: '2' })).toEqual({
        outcome: 'view',
        view: { page: 2, filter: status },
      });
    for (const status of ['submitted', 'triaged', 'all', 'Answered', 'in-progress'])
      expect(readMyList(QUESTIONS, { status }), status).toEqual({ outcome: 'refused' });
    expect(readMyList(QUESTIONS, { status: ['answered', 'declined'] })).toEqual({
      outcome: 'refused',
    });
    expect(readMyList(QUESTIONS, { page: '2', status: 'answered' })).toEqual({
      outcome: 'redirect',
      to: '/ar/my/questions?status=answered&page=2',
    });
  });
});

describe('the Classes and Messages views (My Minhaj Part 2)', () => {
  it('pairs Classes with Teachers, and Conversations with Support', () => {
    expect(myTabs('en', 'classes', 'teachers', (key) => key)).toEqual([
      { href: '/my/classes', text: 'classes', current: false },
      { href: '/my/teachers', text: 'teachers', current: true },
    ]);
    expect(myTabs('ur', 'messages', 'conversations', (key) => key)).toEqual([
      { href: '/ur/my/messages', text: 'conversations', current: true },
      { href: '/ur/my/messages/support', text: 'support', current: false },
    ]);
  });
});

describe('what happened to a donation (My Minhaj Part 2)', () => {
  it('puts every state in exactly one group', () => {
    const groups = DONATION_STATES.map((state) => donationGroup(state));
    expect(groups.every((group) => DONATION_GROUPS.includes(group))).toBe(true);
    expect(donationGroup('succeeded')).toBe('completed');
    expect(donationGroup('partially_refunded')).toBe('completed');
    expect(donationGroup('pending')).toBe('pending');
    for (const state of ['failed', 'cancelled', 'expired'] as const)
      expect(donationGroup(state)).toBe('unfinished');
    for (const state of ['refunded', 'disputed', 'charged_back'] as const)
      expect(donationGroup(state)).toBe('reversed');
  });
});
