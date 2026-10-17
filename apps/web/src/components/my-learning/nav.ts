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
    { href: `/${locale}/my/learning`, text: t('nav.learning') },
    { href: `/${locale}/my/progress/courses`, text: t('nav.progress') },
    { href: `/${locale}/my/classes`, text: t('nav.classes') },
    { href: `/${locale}/learn/courses`, text: t('nav.catalogue') },
    { href: `/${locale}/my`, text: t('nav.account') },
  ];
}
