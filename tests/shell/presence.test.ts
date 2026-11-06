import { describe, expect, it } from 'vitest';

import {
  PRESENCE_SIGNALS,
  PRIMARY_LIMIT,
  UNKNOWN_PRESENCE,
  footerGroups,
  givingPromoted,
  legalLinks,
  policyRouteKeys,
  primaryNavigation,
  promotionRuleOf,
  type PresenceSignal,
  type PresenceSnapshot,
} from '../../apps/web/src/shell/presence.ts';
import { routeByKey } from '../../apps/web/src/shell/registry.ts';

/**
 * REBASELINE R1 — THE PRESENTATION POLICY.
 *
 * What the header and footer PROMOTE is decided from public evidence, never
 * from the mere existence of a route: an area appears once it holds published
 * content or a genuinely open service, and nothing is advertised on unknown
 * evidence. These tests pin that rule for every signal.
 */

function snapshot(
  signals: readonly PresenceSignal[],
  pages: readonly string[] = [],
): PresenceSnapshot {
  return { signals: new Set(signals), publishedPages: new Set(pages) };
}

const bar = (s: PresenceSnapshot) => primaryNavigation(s).bar.map((d) => d.route);
const more = (s: PresenceSnapshot) => primaryNavigation(s).more.map((d) => d.route);
const footerRoutes = (s: PresenceSnapshot) =>
  footerGroups(s).flatMap((group) =>
    group.links.map((link) => (link.kind === 'route' ? link.route : link.binding)),
  );

describe('the primary navigation', () => {
  it('promotes only the organisation when nothing is known (fail closed)', () => {
    expect(bar(UNKNOWN_PRESENCE)).toEqual(['explore']);
    expect(more(UNKNOWN_PRESENCE)).toEqual([]);
  });

  it('adds a content area only when its evidence is present', () => {
    expect(bar(snapshot(['library']))).toEqual(['library', 'explore']);
    expect(bar(snapshot(['watch', 'news']))).toEqual(['watch', 'news-events', 'explore']);
    // The staging corpus of 2026-11: news, books, videos and Collections.
    expect(bar(snapshot(['library', 'watch', 'news', 'collections']))).toEqual([
      'library',
      'watch',
      'news-events',
      'collections',
      'explore',
    ]);
  });

  it('never promotes a religious domain on fixture or absent authority — only on its signal', () => {
    for (const domain of ['quran', 'hadith', 'fatwa'] as const) {
      expect(bar(snapshot([])), domain).not.toContain(domain);
      expect(bar(snapshot([domain])), domain).toContain(domain);
    }
  });

  it('keeps Quran and Hadith as separate destinations', () => {
    expect(bar(snapshot(['quran', 'hadith']))).toEqual(['quran', 'hadith', 'explore']);
  });

  it(`holds at most ${String(PRIMARY_LIMIT)} in the bar, ranked, the rest under More in display order`, () => {
    const all = snapshot([...PRESENCE_SIGNALS]);
    const shown = bar(all);
    expect(shown).toHaveLength(PRIMARY_LIMIT);
    expect(shown).toEqual([
      'quran',
      'hadith',
      'library',
      'watch',
      'news-events',
      'explore',
    ]);
    expect(more(all)).toEqual(['learn', 'fatwa', 'collections']);
    // Nothing qualifying is lost: bar + more is every qualifying destination.
    expect(new Set([...shown, ...more(all)]).size).toBe(9);
  });

  it('keeps the organisation in the bar whatever else qualifies', () => {
    for (const signal of PRESENCE_SIGNALS) {
      expect(bar(snapshot([signal])), signal).toContain('explore');
    }
    expect(bar(snapshot([...PRESENCE_SIGNALS]))).toContain('explore');
  });
});

describe('giving', () => {
  it('is promoted only while giving is open', () => {
    expect(givingPromoted(UNKNOWN_PRESENCE)).toBe(false);
    expect(givingPromoted(snapshot(['library', 'watch', 'news']))).toBe(false);
    expect(givingPromoted(snapshot(['giving']))).toBe(true);
    expect(footerRoutes(snapshot([]))).not.toContain('donate');
    expect(footerRoutes(snapshot(['giving']))).toContain('donate');
  });
});

describe('the footer', () => {
  it('drops every group that has nothing to show, and shows only evidence-free links when unknown', () => {
    expect(footerRoutes(UNKNOWN_PRESENCE)).toEqual(['topics', 'explore', 'my-minhaj']);
  });

  it('lists a Page only once it is published', () => {
    expect(footerRoutes(snapshot([]))).not.toContain('/explore/about/introduction');
    expect(footerRoutes(snapshot([], ['/explore/about/introduction']))).toContain(
      '/explore/about/introduction',
    );
  });

  it('lists a legal document only once it is published', () => {
    expect(legalLinks(UNKNOWN_PRESENCE)).toEqual([]);
    expect(
      legalLinks(snapshot([], ['/legal/terms', '/legal/privacy'])).map((link) =>
        link.kind === 'page' ? link.binding : link.route,
      ),
    ).toEqual(['/legal/privacy', '/legal/terms']);
  });

  it('promotes Find a Centre only with published Centres, never with countries alone', () => {
    expect(footerRoutes(snapshot(['presence']))).toContain('global');
    expect(footerRoutes(snapshot(['presence']))).not.toContain('find-a-centre');
    expect(footerRoutes(snapshot(['centres']))).toContain('find-a-centre');
  });
});

describe('the policy and the registry agree', () => {
  it('names only registered routes', () => {
    for (const key of policyRouteKeys()) expect(routeByKey(key), key).not.toBeNull();
  });

  it('reports the rule of each route for the administration view', () => {
    expect(promotionRuleOf('explore')).toBeNull();
    expect(promotionRuleOf('library')).toBe('library');
    expect(promotionRuleOf('donate')).toBe('giving');
    expect(promotionRuleOf('find-a-centre')).toBe('centres');
    expect(promotionRuleOf('membership')).toBeUndefined();
  });
});
