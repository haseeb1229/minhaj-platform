import type { Locale } from '@minhaj/contracts';

import type { LearningTranslator } from './parts';

/**
 * The neighbouring pages each My Learning page links to. Only routes that
 * exist are listed: there are no classes, teachers or messages here, because
 * those surfaces belong to later phases (ROUTE_MAP.md §5.2).
 */

interface Link {
  readonly href: string;
  readonly text: string;
}

export function learningLinks(locale: Locale, t: LearningTranslator): readonly Link[] {
  return [
    { href: `/${locale}/my/learning`, text: t('nav.learning') },
    { href: `/${locale}/my/progress/courses`, text: t('nav.progress') },
    { href: `/${locale}/learn/courses`, text: t('nav.catalogue') },
    { href: `/${locale}/my`, text: t('nav.account') },
  ];
}
