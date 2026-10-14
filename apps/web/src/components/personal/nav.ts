import type { Locale } from '@minhaj/contracts';

import type { PersonalTranslator } from './parts';

/**
 * The neighbouring pages each My Minhaj Personalisation area links to. Only
 * routes that exist are listed — nothing here points at a surface a later
 * phase owns (ROUTE_MAP.md §5.2).
 */

interface Link {
  readonly href: string;
  readonly text: string;
}

const my = (locale: Locale, path = '') => `/${locale}/my${path}`;

export function savedLinks(locale: Locale, t: PersonalTranslator): readonly Link[] {
  return [
    { href: my(locale, '/saved'), text: t('nav.saved') },
    { href: my(locale, '/saved/bookmarks'), text: t('nav.bookmarks') },
    { href: my(locale, '/saved/notes'), text: t('nav.notes') },
    { href: my(locale, '/saved/collections'), text: t('nav.collections') },
    { href: my(locale), text: t('nav.account') },
  ];
}

export function historyLinks(locale: Locale, t: PersonalTranslator): readonly Link[] {
  return [
    { href: my(locale, '/history/reading'), text: t('nav.reading') },
    { href: my(locale, '/history/watch'), text: t('nav.watch') },
    { href: my(locale, '/settings/privacy'), text: t('nav.privacy') },
    { href: my(locale), text: t('nav.account') },
  ];
}

export function settingsLinks(locale: Locale, t: PersonalTranslator): readonly Link[] {
  return [
    { href: my(locale, '/settings/interests'), text: t('nav.interests') },
    { href: my(locale, '/settings/notifications'), text: t('nav.notificationSettings') },
    { href: my(locale, '/settings/privacy'), text: t('nav.privacy') },
    { href: my(locale), text: t('nav.account') },
  ];
}

export function accountLink(locale: Locale, t: PersonalTranslator): readonly Link[] {
  return [{ href: my(locale), text: t('nav.account') }];
}
