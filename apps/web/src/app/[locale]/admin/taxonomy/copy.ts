import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

/**
 * Copy the four taxonomy surfaces share.
 *
 * A SEPARATE TABLE FROM `adminCopy`, and the separation is the same reasoning
 * `ActionForm` was made generic for: Identity's administrative surfaces and
 * this one have different failure vocabularies. Widening one table to hold both
 * would let a taxonomy page be handed `self-elevation` and an assignments page
 * be handed `hierarchy-cycle` — each of which would render as "unavailable" on
 * the screen that got the wrong one, and the screen that got it is always the
 * one nobody tested.
 *
 * The SHARED denials are still read from the shared `admin.denied` namespace,
 * because "you do not have permission" says the same thing on every
 * administrative screen and translating it twice is how two translations drift.
 */

export interface TaxonomyCopy {
  /**
   * Message per failure key, for `ActionForm`.
   *
   * It covers every `TaxonomyActionState` failure the actions can return, so a
   * refusal always says something a person can act on.
   */
  readonly messages: Readonly<Record<string, string>>;
}

export async function taxonomyCopy(locale: Locale): Promise<TaxonomyCopy> {
  const t = await getTranslations({ locale, namespace: 'admin' });

  return {
    messages: {
      // Shared with every administrative surface.
      'no-session': t('denied.noSession'),
      'no-permission': t('denied.noPermission'),
      'account-inactive': t('denied.accountInactive'),
      'invalid-input': t('denied.invalidInput'),
      'not-found': t('denied.notFound'),
      unavailable: t('denied.unavailable'),
      unknown: t('denied.unavailable'),

      // Taxonomy's own.
      'topic-protected': t('taxonomy.denied.topicProtected'),
      'topic-archived': t('taxonomy.denied.topicArchived'),
      'topic-has-active-children': t('taxonomy.denied.topicHasActiveChildren'),
      'duplicate-slug': t('taxonomy.denied.duplicateSlug'),
      'duplicate-language-code': t('taxonomy.denied.duplicateLanguageCode'),
      'hierarchy-cycle': t('taxonomy.denied.hierarchyCycle'),
      'hierarchy-too-deep': t('taxonomy.denied.hierarchyTooDeep'),
      'fallback-translation-required': t('taxonomy.denied.fallbackRequired'),

      // `second-factor-required` and `step-up-required` are deliberately
      // ABSENT. Taxonomy administration costs a permission and nothing else
      // (SECURITY_BASELINE.md §8.1, §8.2), so the gate these surfaces use
      // cannot return either — and a message for a refusal that cannot happen
      // would be a claim about this phase that is not true.
    },
  };
}
