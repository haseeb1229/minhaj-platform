import { localizedPath, type Locale } from '@minhaj/contracts';

import type { MyLink } from '@/components/my/frame';
import type { LearningTranslator } from './parts';

/**
 * The neighbouring pages each My Learning page links to — learning, progress,
 * classes and the course catalogue, always (restored 2026-11-08 by owner
 * direction after R2 had dropped them). A page whose tabs already offer one
 * of these does not repeat it (`MyPage`).
 */
export function learningLinks(locale: Locale, t: LearningTranslator): readonly MyLink[] {
  return [
    { href: localizedPath(locale, '/my/learning'), text: t('nav.learning') },
    { href: localizedPath(locale, '/my/progress/courses'), text: t('nav.progress') },
    { href: localizedPath(locale, '/my/classes'), text: t('nav.classes') },
    { href: localizedPath(locale, '/learn/courses'), text: t('nav.catalogue') },
    { href: localizedPath(locale, '/my'), text: t('nav.account') },
  ];
}
