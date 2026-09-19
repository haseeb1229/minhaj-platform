import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

/**
 * Copy the five People surfaces share.
 *
 * A SEPARATE TABLE FROM `adminCopy` and from `taxonomyCopy`, for the reason the
 * taxonomy one gives: these surfaces have their own failure vocabulary.
 * Widening one table to hold all three would let a People page be handed
 * `hierarchy-cycle` and a taxonomy page be handed `variant-limit` — each of
 * which would render as "unavailable" on the screen that got the wrong one, and
 * the screen that got it is always the one nobody tested.
 *
 * The SHARED denials are still read from the shared `admin.denied` namespace,
 * because "you do not have permission" says the same thing on every
 * administrative screen and translating it twice is how two translations drift.
 */

export interface PeopleCopy {
  /**
   * Message per failure key, for `ActionForm`.
   *
   * It covers every `PeopleActionFailure` the actions can return, so a refusal
   * always says something a person can act on.
   */
  readonly messages: Readonly<Record<string, string>>;
}

export async function peopleCopy(locale: Locale): Promise<PeopleCopy> {
  const t = await getTranslations({ locale, namespace: 'admin' });

  return {
    messages: {
      // Shared with every administrative surface.
      success: t('people.saved'),
      'no-session': t('denied.noSession'),
      'no-permission': t('denied.noPermission'),
      'account-inactive': t('denied.accountInactive'),
      'invalid-input': t('denied.invalidInput'),
      'not-found': t('denied.notFound'),
      unavailable: t('denied.unavailable'),
      unknown: t('denied.unavailable'),

      // People's own.
      'duplicate-slug': t('people.denied.duplicateSlug'),
      'account-already-linked': t('people.denied.accountAlreadyLinked'),
      'person-already-linked': t('people.denied.personAlreadyLinked'),
      'account-not-found': t('people.denied.accountNotFound'),
      'profile-exists': t('people.denied.profileExists'),
      'profile-has-no-detail': t('people.denied.profileHasNoDetail'),
      'duplicate-variant': t('people.denied.duplicateVariant'),
      'variant-limit': t('people.denied.variantLimit'),
      'primary-translation-required': t('people.denied.primaryTranslationRequired'),
      'too-many-languages': t('people.denied.tooManyLanguages'),

      // `second-factor-required` and `step-up-required` are deliberately
      // ABSENT. Administering a contributor record costs a permission and
      // nothing else (SECURITY_BASELINE.md §8.1, §8.2), so the gate these
      // surfaces use cannot return either — and a message for a refusal that
      // cannot happen would be a claim about this phase that is not true.
    },
  };
}
