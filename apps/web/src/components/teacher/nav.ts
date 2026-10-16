import type { Locale } from '@minhaj/contracts';

import type { TeacherTranslator } from './parts';

/**
 * The Teacher area's sections (ROUTE_MAP.md §6). Only routes that exist are
 * listed: there is NO messages entry, because teacher–learner messaging is
 * Phase 24's and a link to it would be a promise this phase cannot keep.
 */

export interface TeacherLink {
  readonly key: string;
  readonly href: string;
  readonly text: string;
}

export function teacherLinks(
  locale: Locale,
  t: TeacherTranslator,
): readonly TeacherLink[] {
  const root = `/${locale}/teacher`;
  return [
    { key: 'overview', href: root, text: t('nav.overview') },
    { key: 'today', href: `${root}/classes/today`, text: t('nav.today') },
    { key: 'calendar', href: `${root}/calendar`, text: t('nav.calendar') },
    { key: 'students', href: `${root}/students`, text: t('nav.students') },
    { key: 'courses', href: `${root}/courses`, text: t('nav.courses') },
    { key: 'resources', href: `${root}/resources`, text: t('nav.resources') },
    { key: 'attendance', href: `${root}/attendance`, text: t('nav.attendance') },
    { key: 'availability', href: `${root}/availability`, text: t('nav.availability') },
    { key: 'profile', href: `${root}/profile`, text: t('nav.profile') },
  ];
}
