import { localizedPath, type Locale } from '@minhaj/contracts';

import type { MyLink } from '@/components/my/frame';
import type { PersonalTranslator } from './parts';

/**
 * The neighbouring pages each of Personalisation's My Minhaj pages links to
 * (restored 2026-11-08 by owner direction after R2 had dropped them). A page
 * whose tabs already offer one of these does not repeat it (`MyPage`).
 */

const my = (locale: Locale, path = '') => localizedPath(locale, `/my${path}`);

export function savedLinks(locale: Locale, t: PersonalTranslator): readonly MyLink[] {
  return [
    { href: my(locale, '/saved'), text: t('nav.saved') },
    { href: my(locale, '/saved/bookmarks'), text: t('nav.bookmarks') },
    { href: my(locale, '/saved/notes'), text: t('nav.notes') },
    { href: my(locale, '/saved/collections'), text: t('nav.collections') },
    { href: my(locale), text: t('nav.account') },
  ];
}

export function historyLinks(locale: Locale, t: PersonalTranslator): readonly MyLink[] {
  return [
    { href: my(locale, '/history/reading'), text: t('nav.reading') },
    { href: my(locale, '/history/watch'), text: t('nav.watch') },
    { href: my(locale, '/settings/privacy'), text: t('nav.privacy') },
    { href: my(locale), text: t('nav.account') },
  ];
}
