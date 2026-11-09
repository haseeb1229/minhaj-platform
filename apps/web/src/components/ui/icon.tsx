import type { ReactNode } from 'react';

/**
 * THE ICON SET — a small, in-house set of line icons (R2 visual system).
 *
 * No icon dependency: thirty-odd glyphs drawn on one 24-unit grid, one
 * 1.5-pixel stroke (`non-scaling-stroke`, so it is 1.5 px at 16, 20 and 24),
 * round caps and joins. Every icon takes the current text colour.
 *
 * DIRECTIONAL ICONS ARE LOGICAL. `chevron-start`/`chevron-end` and
 * `arrow-start`/`arrow-end` point along the reading direction: drawn for a
 * left-to-right page and mirrored in Urdu and Arabic. Media controls (play,
 * pause) are not mirrored — they follow the convention every player uses.
 *
 * DECORATIVE BY DEFAULT (`aria-hidden`), because an icon almost always sits
 * beside text or inside a control that is already named. Pass `label` only for
 * an icon that stands alone as content.
 */

export type IconName =
  | 'search'
  | 'menu'
  | 'close'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-start'
  | 'chevron-end'
  | 'arrow-start'
  | 'arrow-end'
  | 'external'
  | 'play'
  | 'pause'
  | 'skip-previous'
  | 'skip-next'
  | 'repeat'
  | 'bookmark'
  | 'share'
  | 'copy'
  | 'download'
  | 'user'
  | 'globe'
  | 'book'
  | 'video'
  | 'audio'
  | 'news'
  | 'calendar'
  | 'map-pin'
  | 'mail'
  | 'phone'
  | 'heart'
  | 'settings'
  | 'bell'
  | 'message'
  | 'check'
  | 'plus'
  | 'minus'
  | 'info'
  | 'filter'
  | 'grid'
  | 'list';

/** Icons that point along the reading direction, mirrored in RTL. */
const MIRRORED: ReadonlySet<IconName> = new Set<IconName>([
  'chevron-start',
  'chevron-end',
  'arrow-start',
  'arrow-end',
  'external',
]);

const p = (d: string) => <path d={d} />;

const GLYPHS: Readonly<Record<IconName, ReactNode>> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      {p('m16 16 4.5 4.5')}
    </>
  ),
  menu: p('M4 6.5h16M4 12h16M4 17.5h16'),
  close: p('m6 6 12 12M18 6 6 18'),
  'chevron-down': p('m6 9 6 6 6-6'),
  'chevron-up': p('m6 15 6-6 6 6'),
  'chevron-start': p('m15 6-6 6 6 6'),
  'chevron-end': p('m9 6 6 6-6 6'),
  'arrow-start': p('M19 12H5m6-6-6 6 6 6'),
  'arrow-end': p('M5 12h14m-6-6 6 6-6 6'),
  external: p('M14 4h6v6m0-6-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  play: p('M8 5.5v13l10.5-6.5z'),
  pause: p('M8.5 5.5v13m7-13v13'),
  // Media transport glyphs are NOT mirrored in RTL: they show the recording's
  // own direction, as every player draws them.
  'skip-previous': p('M6.5 6v12m11.5-12-8.5 6 8.5 6z'),
  'skip-next': p('M17.5 6v12M6 6l8.5 6L6 18z'),
  repeat: p(
    'M17 2.5 20.5 6 17 9.5M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5 3.5 18 7 14.5m13.5-2V14a4 4 0 0 1-4 4h-13',
  ),
  bookmark: p('M6.5 4.5h11v15l-5.5-4-5.5 4z'),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      {p('m8.2 10.8 7.6-4.1m-7.6 6.5 7.6 4.1')}
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      {p('M15.5 8.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h3.5')}
    </>
  ),
  download: p('M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14'),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      {p('M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5')}
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p(
        'M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z',
      )}
    </>
  ),
  book: p(
    'M12 6.5c-1.8-1.3-4.3-2-7.5-2v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2zm0 0v13',
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      {p('m16 10.5 5-3v9l-5-3')}
    </>
  ),
  audio: p(
    'M4.5 17v-4a7.5 7.5 0 0 1 15 0v4M4.5 14h3v6h-2a1 1 0 0 1-1-1zm15 0h-3v6h2a1 1 0 0 0 1-1z',
  ),
  news: p(
    'M5 5h11v14H6.5A1.5 1.5 0 0 1 5 17.5zm11 4h3v8.5a1.5 1.5 0 0 1-3 0M8 9h5m-5 3.5h5M8 16h3',
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      {p('M4 10h16M8.5 3.5v4m7-4v4')}
    </>
  ),
  'map-pin': (
    <>
      {p('M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z')}
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      {p('m4 7 8 6 8-6')}
    </>
  ),
  phone: p(
    'M6.5 4h3L11 8 9 9.5a10 10 0 0 0 5.5 5.5L16 13l4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 6a2 2 0 0 1 2-2z',
  ),
  heart: p(
    'M12 19.5S4.5 14.9 4.5 9.5A4.25 4.25 0 0 1 12 7a4.25 4.25 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z',
  ),
  settings: (
    <>
      {p('M4 7h9m4 0h3M4 17h3m4 0h9')}
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  bell: p('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2.2 2.2 0 0 0 4 0'),
  message: p(
    'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-9l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z',
  ),
  check: p('m5 12.5 4.5 4.5L19 7.5'),
  plus: p('M12 5v14M5 12h14'),
  minus: p('M5 12h14'),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {p('M12 11v5.5m0-8.75h.01')}
    </>
  ),
  filter: p('M4 6.5h16m-13 5.5h10m-7 5.5h4'),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  list: p('M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01'),
};

const SIZES = { 16: 'size-4', 20: 'size-5', 24: 'size-6' } as const;

export function Icon({
  name,
  size = 20,
  label,
  className = '',
}: {
  readonly name: IconName;
  readonly size?: keyof typeof SIZES;
  /** A name for an icon that stands alone as content; omit for a decorative icon. */
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
      className={`shrink-0 *:[vector-effect:non-scaling-stroke] ${SIZES[size]} ${MIRRORED.has(name) ? 'rtl:-scale-x-100' : ''} ${className}`}
    >
      {GLYPHS[name]}
    </svg>
  );
}
