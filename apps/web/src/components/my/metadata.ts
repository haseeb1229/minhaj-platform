import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';

/**
 * EVERY MY MINHAJ PAGE NAMES ITSELF (R2, audit F15). The layout's title
 * template turns the page's own name into "Saved · My Minhaj · One Minhaj",
 * so a reader with several tabs open, and a screen reader announcing a new
 * page, hears which page this is — not the bare area name on every one.
 *
 * Never indexed, on the page as on the layout: a cached copy of anything under
 * `/my` would be somebody else's.
 */
export type MyTitleKey =
  | 'saved'
  | 'bookmarks'
  | 'notes'
  | 'collections'
  | 'collection'
  | 'reading'
  | 'watch'
  | 'quran'
  | 'courses'
  | 'progress'
  | 'course'
  | 'path'
  | 'classes'
  | 'class'
  | 'teachers'
  | 'messages'
  | 'conversation'
  | 'support'
  | 'notifications'
  | 'questions'
  | 'ask'
  | 'question'
  | 'membership'
  | 'giving'
  | 'profile'
  | 'security'
  | 'language'
  | 'interests'
  | 'notificationSettings'
  | 'privacy';

export async function myPageMetadata(
  params: Promise<{ readonly locale: string }>,
  key: MyTitleKey,
): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'my' });
  return { title: t(`titles.${key}`), robots: { index: false, follow: false } };
}
