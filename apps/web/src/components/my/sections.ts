import { localizedPath, type Locale } from '@minhaj/contracts';

import type { WorkspaceLink, WorkspaceLinkGroup } from '@/components/workspace/nav-match';

/**
 * MY MINHAJ'S MAP (R2) — which sections the area offers, in which groups, and
 * which sibling views a page carries as tabs. PURE, so the rules are proved by
 * unit test rather than by eye.
 *
 * PRESENTATION ONLY. Hiding a section is a kindness to the reader, never a
 * control: every page re-checks its own session and its owner's rules, and a
 * page whose section is hidden still answers at its address. A section is
 * offered when the deployment has switched its capability on — the reasons a
 * person would look there — so a new account is not shown a column of doors
 * that open onto "not available". A person who already has something in a
 * hidden section (a donation made before giving closed) reaches it from the
 * home page, whose modules render only when there is something to show.
 *
 * NO EMPTY GROUP. A group is listed only while at least one of its sections
 * is, so a heading never stands alone (the administration's F54 defect).
 */

/** What the deployment has switched on — session-free, deployment-wide state. */
export interface MyCapabilities {
  /** A Quran corpus a visitor may read is active. */
  readonly quran: boolean;
  /** At least one published course. */
  readonly learning: boolean;
  /** Live classes are switched on (any activation). */
  readonly live: boolean;
  /** At least one kind of conversation is switched on. */
  readonly messaging: boolean;
  /** The question service is accepting questions. */
  readonly questions: boolean;
  /** At least one membership type is open for application. */
  readonly membership: boolean;
  /** Online giving is open. */
  readonly giving: boolean;
}

/** Nothing known: only the sections every account always has. */
export const NO_CAPABILITIES: MyCapabilities = Object.freeze({
  quran: false,
  learning: false,
  live: false,
  messaging: false,
  questions: false,
  membership: false,
  giving: false,
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

interface SectionSpec {
  readonly key: MySectionKey;
  readonly path: string;
  readonly also?: readonly string[];
  readonly exact?: boolean;
  /** The capability that must be on for the section to be offered. */
  readonly needs?: (capabilities: MyCapabilities) => boolean;
}

const GROUPS: Readonly<Record<MyGroupKey, readonly SectionSpec[]>> = {
  home: [{ key: 'home', path: '', exact: true }],
  library: [
    { key: 'saved', path: '/saved', also: ['/saved/bookmarks'] },
    { key: 'notes', path: '/saved/notes' },
    { key: 'collections', path: '/saved/collections' },
    { key: 'history', path: '/history/reading', also: ['/history'] },
  ],
  quran: [{ key: 'quran', path: '/progress/quran', needs: (c) => c.quran }],
  learning: [
    {
      key: 'courses',
      path: '/learning',
      also: ['/progress/courses'],
      needs: (c) => c.learning || c.live,
    },
    { key: 'classes', path: '/classes', needs: (c) => c.live },
    { key: 'teachers', path: '/teachers', needs: (c) => c.live },
  ],
  messages: [{ key: 'messages', path: '/messages', needs: (c) => c.messaging }],
  questions: [{ key: 'questions', path: '/questions', needs: (c) => c.questions }],
  membership: [{ key: 'membership', path: '/membership', needs: (c) => c.membership }],
  giving: [{ key: 'giving', path: '/donations', needs: (c) => c.giving }],
  notifications: [{ key: 'notifications', path: '/notifications' }],
  settings: [{ key: 'settings', path: '/settings/profile', also: ['/settings'] }],
};

/** A `/my` address in the reader's locale. */
export function myPath(locale: Locale, path = ''): string {
  return localizedPath(locale, `/my${path}`);
}

/**
 * The area's navigation: every offered section, in its group, in a fixed
 * order. A group with one section is a plain entry; a group with several is
 * labelled. Labels come from the caller (the `my.nav` catalogue).
 */
export function myNavigation(
  locale: Locale,
  capabilities: MyCapabilities,
  label: {
    readonly section: (key: MySectionKey) => string;
    readonly group: (key: 'library' | 'learning') => string;
  },
): readonly WorkspaceLinkGroup[] {
  return MY_GROUPS.flatMap((group): WorkspaceLinkGroup[] => {
    const links: WorkspaceLink[] = GROUPS[group]
      .filter((spec) => spec.needs === undefined || spec.needs(capabilities))
      .map((spec) => ({
        key: spec.key,
        href: myPath(locale, spec.path),
        text: label.section(spec.key),
        ...(spec.exact === true ? { exact: true } : {}),
        ...(spec.also === undefined
          ? {}
          : { also: spec.also.map((path) => myPath(locale, path)) }),
      }));
    if (links.length === 0) return [];
    const labelled = links.length > 1 && (group === 'library' || group === 'learning');
    return [
      {
        key: group,
        ...(labelled ? { label: label.group(group) } : {}),
        links,
      },
    ];
  });
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
