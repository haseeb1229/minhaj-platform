import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';

import type { LearningTranslator } from './parts';

/**
 * The neighbouring pages each My Learning page links to. Only routes that
 * exist are listed: My Classes arrived with Phase 23. Messages (Phase 24) are
 * reached from My Minhaj and My Teachers, where a conversation is begun.
 */

interface Link {
  readonly href: string;
  readonly text: string;
}

export function learningLinks(locale: Locale, t: LearningTranslator): readonly Link[] {
  return [
    { href: localizedPath(locale, '/my/learning'), text: t('nav.learning') },
    { href: localizedPath(locale, '/my/progress/courses'), text: t('nav.progress') },
    { href: localizedPath(locale, '/my/classes'), text: t('nav.classes') },
    { href: localizedPath(locale, '/learn/courses'), text: t('nav.catalogue') },
    { href: localizedPath(locale, '/my'), text: t('nav.account') },
  ];
}
