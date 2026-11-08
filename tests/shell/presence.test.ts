import { describe, expect, it } from 'vitest';

import {
  FOOTER_GROUP_IDS,
  NAVIGATION_GROUP_IDS,
  PRESENCE_SIGNALS,
  UNKNOWN_PRESENCE,
  footerGroups,
  givingPromoted,
  legalLinks,
  navigationGroups,
  policyPageBindings,
  policyRouteKeys,
  promotionRuleOf,
  utilityLinks,
  type NavItem,
  type PresenceSignal,
  type PresenceSnapshot,
} from '../../apps/web/src/shell/presence.ts';
import {
  SHELL_ROUTES,
  isAvailable,
  routeByKey,
} from '../../apps/web/src/shell/registry.ts';

/**
 * THE PRESENTATION POLICY (R1, regrouped by R2).
 *
 * What the header and footer PROMOTE is decided from public evidence, never
 * from the mere existence of a route: an area appears once it holds published
 * content or a genuinely open service, and nothing is advertised on unknown
 * evidence.
 *
 * R2 CHANGED ONE RULE DELIBERATELY: the header is no longer the six
 * best-ranked destinations with the rest under "More" (`PRIMARY_LIMIT`), but
 * six fixed groups, each holding only its present destinations, a group with
 * nothing present omitted whole.
 */

function snapshot(
  signals: readonly PresenceSignal[],
  pages: readonly string[] = [],
): PresenceSnapshot {
  return { signals: new Set(signals), publishedPages: new Set(pages) };
}

const target = (item: NavItem) => (item.kind === 'route' ? item.route : item.binding);
const groups = (s: PresenceSnapshot) =>
  Object.fromEntries(navigationGroups(s).map((g) => [g.id, g.items.map(target)]));
const groupIds = (s: PresenceSnapshot) => navigationGroups(s).map((g) => g.id);
const headerTargets = (s: PresenceSnapshot) =>
  navigationGroups(s).flatMap((g) => g.items.map(target));
const footerTargets = (s: PresenceSnapshot) =>
  footerGroups(s).flatMap((g) => g.items.map(target));

const EVERYTHING = snapshot(
  [...PRESENCE_SIGNALS],
  [
    '/explore/about/introduction',
    '/explore/shaykh-ul-islam/biography',
    '/explore/organization/departments',
    '/explore/organization/forums',
    '/explore/about/history',
    '/contact',
  ],
);

describe('the header groups', () => {
  it('shows only the organisation when nothing is known (fail closed)', () => {
    expect(groups(UNKNOWN_PRESENCE)).toEqual({ about: ['explore'] });
  });

  it('keeps the six groups in one fixed order, whatever qualifies', () => {
    expect(groupIds(EVERYTHING)).toEqual([...NAVIGATION_GROUP_IDS]);
    expect(groupIds(snapshot(['news', 'quran']))).toEqual(['quran', 'news', 'about']);
  });

  it('omits a group with no present destination, and lists only present children', () => {
    // The staging corpus of 2026-11: news, books, magazines, videos, Collections.
    expect(
      groups(snapshot(['library', 'books', 'magazines', 'watch', 'news', 'collections'])),
    ).toEqual({
      knowledge: ['library', 'library.books', 'library.magazines'],
      watch: ['watch'],
      news: ['news-events', 'collections'],
      about: ['explore'],
    });
    expect(groupIds(snapshot(['books']))).not.toContain('learn');
  });

  it('caps nothing: every present destination of a group is listed in its order', () => {
    expect(groups(EVERYTHING).knowledge).toEqual([
      'library',
      'library.books',
      'library.magazines',
      'library.research',
      'library.encyclopedias',
      'articles',
      'hadith',
      'fatwa',
    ]);
    expect(groups(EVERYTHING).about).toHaveLength(9);
  });

  it('never promotes a religious domain on fixture or absent authority — only on its signal', () => {
    for (const domain of ['quran', 'hadith', 'fatwa'] as const) {
      expect(headerTargets(snapshot([])), domain).not.toContain(domain);
      expect(headerTargets(snapshot([domain])), domain).toContain(domain);
    }
    // A reference-preview attribution signal alone promotes no Quran link: the
    // evidence that a corpus is READABLE is the `quran` signal itself.
    expect(headerTargets(snapshot(['quranReference']))).not.toContain('quran');
  });

  it('links MQI’s hadith works without a Hadith corpus, and names the landing once', () => {
    // R2 owner decision: no external corpus; the Hadith landing presents the
    // Library's hadith works. Their evidence alone links the same landing,
    // named for what it holds; with a corpus too, the address appears once.
    expect(groups(snapshot(['hadithWorks'])).knowledge).toEqual(['hadith']);
    expect(navigationGroups(snapshot(['hadithWorks']))[0]?.items[0]?.id).toBe(
      'hadithWorks',
    );
    const both = navigationGroups(snapshot(['hadith', 'hadithWorks']));
    expect(both[0]?.items.map((item) => item.id)).toEqual(['hadith']);
    expect(footerTargets(snapshot(['hadithWorks']))).toContain('hadith');
    expect(
      footerTargets(snapshot(['hadith', 'hadithWorks'])).filter((t) => t === 'hadith'),
    ).toHaveLength(1);
    // Neither signal promotes Fatwa, and works never promote a Quran link.
    expect(headerTargets(snapshot(['hadithWorks']))).not.toContain('fatwa');
    expect(headerTargets(snapshot(['hadithWorks']))).not.toContain('quran');
  });

  it('keeps Quran and Hadith as separate destinations, never in one group', () => {
    const all = groups(snapshot(['quran', 'hadith']));
    expect(all.quran).toContain('quran');
    expect(all.quran).not.toContain('hadith');
    expect(all.knowledge).toEqual(['hadith']);
  });

  it('lists an Explore page only once it is published', () => {
    expect(headerTargets(snapshot([]))).not.toContain('/explore/about/introduction');
    expect(groups(snapshot([], ['/explore/about/introduction'])).about).toEqual([
      'explore',
      '/explore/about/introduction',
    ]);
  });

  it('promotes Find a Centre only with published Centres, never with countries alone', () => {
    expect(groups(snapshot(['presence'])).about).toEqual(['explore', 'global']);
    expect(groups(snapshot(['centres'])).about).toEqual(['explore', 'find-a-centre']);
  });

  it('requires each sub-destination’s own evidence, not its parent’s', () => {
    // A published book does not advertise magazines, and a video does not
    // advertise series or playlists that do not exist.
    expect(groups(snapshot(['library', 'books'])).knowledge).toEqual([
      'library',
      'library.books',
    ]);
    expect(groups(snapshot(['watch'])).watch).toEqual(['watch']);
    expect(groups(snapshot(['learn'])).learn).toEqual(['learn']);
  });
});

describe('the utility strip', () => {
  it('always names the organisation, and the rest only with evidence', () => {
    expect(utilityLinks(UNKNOWN_PRESENCE).map(target)).toEqual(['explore']);
    expect(utilityLinks(snapshot(['help', 'centres'], ['/contact'])).map(target)).toEqual(
      ['explore', 'contact-help', '/contact', 'find-a-centre'],
    );
  });
});

describe('giving', () => {
  it('is promoted only while giving is open', () => {
    expect(givingPromoted(UNKNOWN_PRESENCE)).toBe(false);
    expect(givingPromoted(snapshot(['library', 'watch', 'news']))).toBe(false);
    expect(givingPromoted(snapshot(['giving']))).toBe(true);
    expect(footerTargets(snapshot([]))).not.toContain('donate');
    expect(footerTargets(snapshot(['giving']))).toContain('donate');
  });
});

describe('the footer', () => {
  it('drops every column that has nothing to show, and shows only evidence-free links when unknown', () => {
    expect(footerGroups(UNKNOWN_PRESENCE).map((g) => g.id)).toEqual([
      'quranKnowledge',
      'about',
      'participate',
    ]);
    expect(footerTargets(UNKNOWN_PRESENCE)).toEqual(['topics', 'explore', 'my-minhaj']);
  });

  it('is six columns in a fixed order when everything is present', () => {
    expect(footerGroups(EVERYTHING).map((g) => g.id)).toEqual([...FOOTER_GROUP_IDS]);
  });

  it('reaches every header destination’s landing too', () => {
    const footer = new Set(footerTargets(EVERYTHING));
    for (const group of navigationGroups(EVERYTHING))
      expect(footer, group.id).toContain(target(group.items[0] as NavItem));
  });

  it('promotes membership only while a type is open', () => {
    expect(footerTargets(snapshot([]))).not.toContain('membership');
    expect(footerTargets(snapshot(['membership']))).toContain('membership');
  });

  it('lists a legal document only once it is published', () => {
    expect(legalLinks(UNKNOWN_PRESENCE)).toEqual([]);
    expect(
      legalLinks(snapshot([], ['/legal/terms', '/legal/privacy'])).map(target),
    ).toEqual(['/legal/privacy', '/legal/terms']);
  });
});

describe('the policy and the registry agree', () => {
  it('names only registered, linkable routes', () => {
    for (const key of policyRouteKeys()) {
      const route = routeByKey(key);
      expect(route, key).not.toBeNull();
      expect(route !== null && isAvailable(route), key).toBe(true);
    }
  });

  it('names only Page bindings that are registered addresses', () => {
    const paths = new Set(
      SHELL_ROUTES.flatMap((route) => (isAvailable(route) ? [route.path] : [])),
    );
    for (const binding of policyPageBindings()) expect(paths, binding).toContain(binding);
  });

  it('reports the rule of each route for the administration view', () => {
    expect(promotionRuleOf('explore')).toEqual({ kind: 'always' });
    expect(promotionRuleOf('library')).toEqual({ kind: 'signal', signal: 'library' });
    expect(promotionRuleOf('library.books')).toEqual({ kind: 'signal', signal: 'books' });
    expect(promotionRuleOf('donate')).toEqual({ kind: 'signal', signal: 'giving' });
    expect(promotionRuleOf('find-a-centre')).toEqual({
      kind: 'signal',
      signal: 'centres',
    });
    expect(promotionRuleOf('membership')).toEqual({
      kind: 'signal',
      signal: 'membership',
    });
    expect(
      promotionRuleOf('explore.about.introduction', '/explore/about/introduction'),
    ).toEqual({ kind: 'page', binding: '/explore/about/introduction' });
    expect(promotionRuleOf('legal.privacy', '/legal/privacy')).toEqual({
      kind: 'page',
      binding: '/legal/privacy',
    });
    expect(promotionRuleOf('volunteer', '/volunteer')).toBeUndefined();
    expect(promotionRuleOf('sitemap', '/sitemap')).toBeUndefined();
  });
});
