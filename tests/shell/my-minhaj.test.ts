import { describe, expect, it } from 'vitest';

import {
  dashboardColumns,
  dashboardModules,
  isNewAccount,
  lessonPercent,
  startSteps,
  type DashboardSignals,
} from '../../apps/web/src/components/my/dashboard.ts';
import {
  NO_CAPABILITIES,
  myNavigation,
  myTabs,
  type MyCapabilities,
} from '../../apps/web/src/components/my/sections.ts';
import {
  dayDistance,
  relativeDay,
  shortDate,
  zonedDay,
  zonedTime,
} from '../../apps/web/src/components/my/time.ts';
import {
  filterTimeZones,
  isTimeZone,
  timeZoneChoices,
} from '../../apps/web/src/components/my/time-zones.ts';
import { currentLinkKey } from '../../apps/web/src/components/workspace/nav-match.ts';

/**
 * My Minhaj's presentation rules (R2): which sections the area offers, which
 * modules the home page shows, and how instants and time zones read in the
 * person's own zone. Presentation only — every page re-checks its own
 * session — but a wrong answer is still a lie on screen: a door onto "not
 * available", a heading over nothing, a class shown on the wrong day.
 */

const label = {
  section: (key: string) => `section:${key}`,
  group: (key: string) => `group:${key}`,
};

const ALL_ON: MyCapabilities = {
  quran: true,
  learning: true,
  live: true,
  messaging: true,
  questions: true,
  membership: true,
  giving: true,
};

const keys = (groups: ReturnType<typeof myNavigation>) =>
  groups.flatMap((group) => group.links.map((link) => link.key));

describe('the My Minhaj navigation', () => {
  it('offers only what every account always has when nothing is switched on', () => {
    const groups = myNavigation('en', NO_CAPABILITIES, label);
    expect(keys(groups)).toEqual([
      'home',
      'saved',
      'notes',
      'collections',
      'history',
      'notifications',
      'settings',
    ]);
    // No group is left standing without an entry.
    for (const group of groups) expect(group.links.length).toBeGreaterThan(0);
    expect(groups.map((group) => group.key)).not.toContain('learning');
    expect(groups.map((group) => group.key)).not.toContain('giving');
  });

  it('offers every section, grouped in a fixed order, when everything is on', () => {
    const groups = myNavigation('en', ALL_ON, label);
    expect(groups.map((group) => group.key)).toEqual([
      'home',
      'library',
      'quran',
      'learning',
      'messages',
      'questions',
      'membership',
      'giving',
      'notifications',
      'settings',
    ]);
    expect(keys(groups)).toEqual([
      'home',
      'saved',
      'notes',
      'collections',
      'history',
      'quran',
      'courses',
      'classes',
      'teachers',
      'messages',
      'questions',
      'membership',
      'giving',
      'notifications',
      'settings',
    ]);
    expect(groups.find((group) => group.key === 'library')?.label).toBe('group:library');
    expect(groups.find((group) => group.key === 'learning')?.label).toBe(
      'group:learning',
    );
    // A one-entry group is a plain entry, never a heading over itself.
    expect(groups.find((group) => group.key === 'messages')?.label).toBeUndefined();
  });

  it('keeps classes and teachers behind live classes, and courses behind either', () => {
    const catalogueOnly = myNavigation(
      'en',
      { ...NO_CAPABILITIES, learning: true },
      label,
    );
    expect(keys(catalogueOnly)).toContain('courses');
    expect(keys(catalogueOnly)).not.toContain('classes');
    // A single learning entry is not labelled as a group.
    expect(
      catalogueOnly.find((group) => group.key === 'learning')?.label,
    ).toBeUndefined();

    const liveOnly = myNavigation('en', { ...NO_CAPABILITIES, live: true }, label);
    expect(keys(liveOnly)).toEqual(
      expect.arrayContaining(['courses', 'classes', 'teachers']),
    );
  });

  it('builds localised addresses, and marks the right entry current', () => {
    const groups = myNavigation('ur', ALL_ON, label);
    const links = groups.flatMap((group) => group.links);
    expect(links.find((link) => link.key === 'home')?.href).toBe('/ur/my');
    expect(links.find((link) => link.key === 'giving')?.href).toBe('/ur/my/donations');
    expect(currentLinkKey('/ur/my', links)).toBe('home');
    expect(currentLinkKey('/ur/my/saved/bookmarks', links)).toBe('saved');
    expect(currentLinkKey('/ur/my/saved/collections/abc', links)).toBe('collections');
    expect(currentLinkKey('/ur/my/history/watch', links)).toBe('history');
    expect(currentLinkKey('/ur/my/progress/courses', links)).toBe('courses');
    expect(currentLinkKey('/ur/my/settings/privacy', links)).toBe('settings');
    expect(currentLinkKey('/my/settings/privacy', links)).toBeNull();

    const english = myNavigation('en', ALL_ON, label).flatMap((group) => group.links);
    expect(english.find((link) => link.key === 'home')?.href).toBe('/my');
  });
});

describe('the sibling-view tabs', () => {
  it('marks exactly the current view', () => {
    const tabs = myTabs('en', 'settings', 'privacy', (key) => key);
    expect(tabs.map((tab) => tab.href)).toEqual([
      '/my/settings/profile',
      '/my/settings/security',
      '/my/settings/language',
      '/my/settings/interests',
      '/my/settings/notifications',
      '/my/settings/privacy',
    ]);
    expect(tabs.filter((tab) => tab.current).map((tab) => tab.text)).toEqual(['privacy']);
    expect(myTabs('ar', 'history', 'watch', (key) => key)).toEqual([
      { href: '/ar/my/history/reading', text: 'reading', current: false },
      { href: '/ar/my/history/watch', text: 'watch', current: true },
    ]);
  });
});

const NOTHING: DashboardSignals = {
  continuing: 0,
  upcomingClass: false,
  saved: 0,
  interests: 0,
  interestsAnswered: false,
  conversations: 0,
  notifications: 0,
  questions: 0,
  membership: false,
  donations: 0,
};

describe('the My Minhaj home page modules', () => {
  it('shows a brand-new account how to begin, and nothing empty', () => {
    expect(isNewAccount(NOTHING)).toBe(true);
    expect(dashboardModules(NOTHING)).toEqual(['start']);
    expect(startSteps(NOTHING)).toEqual({ interests: true, save: true });
  });

  it('keeps the beginning while a step is open, and drops it once both are done', () => {
    const answered = { ...NOTHING, interestsAnswered: true };
    expect(dashboardModules(answered)).toEqual(['start']);
    expect(startSteps(answered)).toEqual({ interests: false, save: true });
    const saved = { ...answered, saved: 2 };
    expect(dashboardModules(saved)).toEqual(['saved']);
    expect(isNewAccount(saved)).toBe(false);
  });

  it('renders each module only with something in it, in reading order', () => {
    const rich: DashboardSignals = {
      continuing: 3,
      upcomingClass: true,
      saved: 8,
      interests: 2,
      interestsAnswered: true,
      conversations: 2,
      notifications: 5,
      questions: 1,
      membership: true,
      donations: 4,
    };
    const modules = dashboardModules(rich);
    expect(modules).toEqual([
      'continue',
      'upcoming',
      'saved',
      'interests',
      'messages',
      'notifications',
      'questions',
      'membership',
      'giving',
    ]);
    expect(dashboardColumns(modules)).toEqual({
      main: ['continue', 'upcoming', 'saved', 'interests'],
      side: ['messages', 'notifications', 'questions', 'membership', 'giving'],
    });
    // A skipped interests question with no interests chosen adds no module.
    expect(dashboardModules({ ...rich, interests: 0 })).not.toContain('interests');
  });

  it('counts an account with only a donation as not new, with no start module noise', () => {
    const giver = { ...NOTHING, donations: 1, interestsAnswered: true, saved: 1 };
    expect(isNewAccount(giver)).toBe(false);
    expect(dashboardModules(giver)).toEqual(['saved', 'giving']);
  });

  it('turns lesson counts into a bounded percentage', () => {
    expect(lessonPercent(0, 0)).toBe(0);
    expect(lessonPercent(1, 3)).toBe(33);
    expect(lessonPercent(5, 4)).toBe(100);
    expect(lessonPercent(-2, 4)).toBe(0);
    expect(lessonPercent(1, Number.NaN)).toBe(0);
  });
});

describe('time in the person’s own zone', () => {
  // 20:30 UTC on 7 November is already 8 November in Karachi (UTC+5).
  const evening = new Date('2026-11-07T20:30:00Z');

  it('places a day in the account’s zone, not the server’s', () => {
    expect(zonedDay(evening, 'UTC')).toBe('2026-11-07');
    expect(zonedDay(evening, 'Asia/Karachi')).toBe('2026-11-08');
    expect(zonedDay(evening, 'America/New_York')).toBe('2026-11-07');
    // No zone, or a zone the runtime does not know, reads as UTC.
    expect(zonedDay(evening, null)).toBe('2026-11-07');
    expect(zonedDay(evening, 'Not/AZone')).toBe('2026-11-07');
  });

  it('says today and tomorrow by the account’s calendar', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    expect(relativeDay(evening, now, 'UTC')).toBe('today');
    expect(relativeDay(evening, now, 'Asia/Karachi')).toBe('tomorrow');
    expect(relativeDay(new Date('2026-11-12T10:00:00Z'), now, 'UTC')).toBe('later');
    expect(relativeDay(new Date('2026-11-06T10:00:00Z'), now, 'UTC')).toBe('past');
    expect(dayDistance(new Date('2026-12-07T10:00:00Z'), now, 'UTC')).toBe(30);
  });

  it('writes the time in the zone, and names it', () => {
    expect(zonedTime(evening, 'en', 'Asia/Karachi')).toMatch(/1:30\sAM\sGMT\+5/u);
    expect(zonedTime(evening, 'en', 'UTC')).toMatch(/8:30\sPM\sUTC/u);
    expect(shortDate(evening, 'en', 'Asia/Karachi')).toBe('Nov 8, 2026');
  });
});

describe('the time-zone list', () => {
  const now = new Date('2026-01-15T12:00:00Z');
  const choices = timeZoneChoices(now, null);

  it('offers the runtime’s zones, UTC among them, every one valid', () => {
    expect(choices.length).toBeGreaterThan(300);
    expect(choices.some((choice) => choice.id === 'UTC')).toBe(true);
    const karachi = choices.find((choice) => choice.id === 'Asia/Karachi');
    expect(karachi).toEqual({
      id: 'Asia/Karachi',
      region: 'Asia',
      place: 'Karachi',
      offset: 'GMT+05:00',
    });
    for (const choice of choices) expect(isTimeZone(choice.id), choice.id).toBe(true);
    expect(new Set(choices.map((choice) => choice.id)).size).toBe(choices.length);
  });

  it('keeps the account’s current zone, and never a value the runtime refuses', () => {
    expect(timeZoneChoices(now, 'Not/AZone').some((c) => c.id === 'Not/AZone')).toBe(
      false,
    );
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('Europe/London')).toBe(true);
  });

  it('narrows by place, identifier or offset, and never hides the selected zone', () => {
    const karachi = filterTimeZones(choices, 'karachi', null).map((choice) => choice.id);
    expect(karachi).toEqual(['Asia/Karachi']);
    expect(filterTimeZones(choices, 'new york', null).map((c) => c.id)).toEqual([
      'America/New_York',
    ]);
    expect(
      filterTimeZones(choices, 'GMT+05:00', null).every((c) => c.offset === 'GMT+05:00'),
    ).toBe(true);
    const kept = filterTimeZones(choices, 'karachi', 'Europe/London').map((c) => c.id);
    expect(kept).toEqual(expect.arrayContaining(['Asia/Karachi', 'Europe/London']));
    expect(filterTimeZones(choices, '   ', null)).toBe(choices);
  });
});
