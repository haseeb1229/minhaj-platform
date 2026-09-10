import type { Locale } from '@minhaj/contracts';

import type messages from '../../messages/en.json';

/**
 * Type-safe messages and locales, from the sources that already define them.
 *
 * next-intl reads both from a module-augmented `AppConfig`. Declaring them here
 * makes `t('foundation.headnig')` a TYPE ERROR rather than a placeholder string
 * discovered by a human reading a page, and narrows the library's own `Locale`
 * from `string` to the three this platform supports.
 *
 * English is the canonical SHAPE — the catalogue every key must exist in — and
 * `tests/config/messages.test.ts` proves the other two match it. That split is
 * deliberate: a type can describe one file's shape, and only a test can prove
 * three files agree. Neither alone is the guarantee.
 *
 * This is type-only. `import type` erases at compile time, so no catalogue is
 * pulled into a bundle by this declaration.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
