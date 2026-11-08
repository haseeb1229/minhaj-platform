import { localizedPath, type Locale } from '@minhaj/contracts';

import type { WorkspaceLink, WorkspaceLinkGroup } from '@/components/workspace/nav-match';

/**
 * MY MINHAJ'S MAP — which sections the area offers, in which groups, and
 * which sibling views a page carries as tabs. PURE, so the rules are proved by
 * unit test rather than by eye.
 *
 * EVERY SECTION IS ALWAYS LISTED (owner direction 2026-11-08). Learning,
 * Classes, Teachers, Messages, Questions, Membership and Donations are offered
 * to every account whether or not this deployment has switched their service
 * on; each page says, in words, when its service is not available yet. (R2
 * listed a section only while its capability was on — historical, superseded
 * 2026-11-08 by owner direction.)
 *
 * PRESENTATION ONLY. Listing a section is a kindness to the reader, never a
 * control: every page re-checks its own session and its owner's rules.
 *
 * THE WAY TO ONE'S OWN WORK. A person who holds teaching or administrative
 * authority is also offered the Teacher area and the administration. Whether
 * they do is decided on the server by Identity & Access (`staff.ts` beside the
 * layout) and handed in here; the target areas keep their own gates.
 */

/** Which staff areas the signed-in person may enter — Identity's answer. */
export interface MyStaffAreas {
  readonly teacher: boolean;
  readonly admin: boolean;
}

export const NO_STAFF_AREAS: MyStaffAreas = Object.freeze({
  teacher: false,
  admin: false,
});

export const MY_GROUPS = Object.freeze([
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
] as const);

export type MyGroupKey = (typeof MY_GROUPS)[number];

export type MySectionKey =
  | 'home'
  | 'saved'
  | 'notes'
  | 'collections'
  | 'history'
  | 'quran'
  | 'courses'
  | 'classes'
  | 'teachers'
  | 'messages'
  | 'questions'
  | 'membership'
  | 'giving'
  | 'notifications'
  | 'settings';

export type MyStaffKey = 'teacher' | 'admin';

interface SectionSpec {
  readonly key: MySectionKey;
  readonly path: string;
  readonly also?: readonly string[];
  readonly exact?: boolean;
}

const GROUPS: Readonly<Record<MyGroupKey, readonly SectionSpec[]>> = {
  home: [{ key: 'home', path: '', exact: true }],
  library: [
    { key: 'saved', path: '/saved', also: ['/saved/bookmarks'] },
    { key: 'notes', path: '/saved/notes' },
    { key: 'collections', path: '/saved/collections' },
    { key: 'history', path: '/history/reading', also: ['/history'] },
  ],
  quran: [{ key: 'quran', path: '/progress/quran' }],
  learning: [
    { key: 'courses', path: '/learning', also: ['/progress/courses'] },
    { key: 'classes', path: '/classes' },
    { key: 'teachers', path: '/teachers' },
  ],
  messages: [{ key: 'messages', path: '/messages' }],
  questions: [{ key: 'questions', path: '/questions' }],
  membership: [{ key: 'membership', path: '/membership' }],
  giving: [{ key: 'giving', path: '/donations' }],
  notifications: [{ key: 'notifications', path: '/notifications' }],
  settings: [{ key: 'settings', path: '/settings/profile', also: ['/settings'] }],
};

/** The staff areas, outside `/my`, in a fixed order. */
const STAFF: readonly { readonly key: MyStaffKey; readonly path: string }[] = [
  { key: 'teacher', path: '/teacher' },
  { key: 'admin', path: '/admin' },
];

/** A `/my` address in the reader's locale. */
export function myPath(locale: Locale, path = ''): string {
  return localizedPath(locale, `/my${path}`);
}

/**
 * The area's navigation: every section, in its group, in a fixed order, then
 * — only for a person Identity says holds the authority — the staff areas.
 * Library and Learning are labelled groups; every other section is a plain
 * entry. Labels come from the caller (the `my.nav` catalogue).
 */
export function myNavigation(
  locale: Locale,
  staff: MyStaffAreas,
  label: {
    readonly section: (key: MySectionKey | MyStaffKey) => string;
    readonly group: (key: 'library' | 'learning' | 'staff') => string;
  },
): readonly WorkspaceLinkGroup[] {
  const sections = MY_GROUPS.map((group): WorkspaceLinkGroup => {
    const links: WorkspaceLink[] = GROUPS[group].map((spec) => ({
      key: spec.key,
      href: myPath(locale, spec.path),
      text: label.section(spec.key),
      ...(spec.exact === true ? { exact: true } : {}),
      ...(spec.also === undefined
        ? {}
        : { also: spec.also.map((path) => myPath(locale, path)) }),
    }));
    return group === 'library' || group === 'learning'
      ? { key: group, label: label.group(group), links }
      : { key: group, links };
  });
  const work: WorkspaceLink[] = STAFF.filter((area) => staff[area.key]).map((area) => ({
    key: area.key,
    href: localizedPath(locale, area.path),
    text: label.section(area.key),
  }));
  return work.length === 0
    ? sections
    : [...sections, { key: 'staff', label: label.group('staff'), links: work }];
}

/* ===========================================================================
 * Sibling views — tabs at the head of a page
 * ========================================================================= */

export type MyTabSet = 'saved' | 'history' | 'learning' | 'settings';

export type MyTabKey =
  | 'saved'
  | 'bookmarks'
  | 'reading'
  | 'watch'
  | 'courses'
  | 'progress'
  | 'profile'
  | 'security'
  | 'language'
  | 'interests'
  | 'notifications'
  | 'privacy';

const TABS: Readonly<
  Record<MyTabSet, readonly { readonly key: MyTabKey; readonly path: string }[]>
> = {
  saved: [
    { key: 'saved', path: '/saved' },
    { key: 'bookmarks', path: '/saved/bookmarks' },
  ],
  history: [
    { key: 'reading', path: '/history/reading' },
    { key: 'watch', path: '/history/watch' },
  ],
  learning: [
    { key: 'courses', path: '/learning' },
    { key: 'progress', path: '/progress/courses' },
  ],
  settings: [
    { key: 'profile', path: '/settings/profile' },
    { key: 'security', path: '/settings/security' },
    { key: 'language', path: '/settings/language' },
    { key: 'interests', path: '/settings/interests' },
    { key: 'notifications', path: '/settings/notifications' },
    { key: 'privacy', path: '/settings/privacy' },
  ],
};

/** One set of sibling views, the one at `current` marked. */
export function myTabs(
  locale: Locale,
  set: MyTabSet,
  current: MyTabKey,
  label: (key: MyTabKey) => string,
): readonly {
  readonly href: string;
  readonly text: string;
  readonly current: boolean;
}[] {
  return TABS[set].map((tab) => ({
    href: myPath(locale, tab.path),
    text: label(tab.key),
    current: tab.key === current,
  }));
}
