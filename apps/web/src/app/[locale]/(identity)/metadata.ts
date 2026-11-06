import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';

/** The heading keys the identity pages already render as their `h1`. */
type IdentityTitle =
  | 'signIn.title'
  | 'signUp.title'
  | 'forgot.title'
  | 'reset.title'
  | 'verify.title'
  | 'setup.title'
  | 'confirmChange.title'
  | 'twoFactor.title';

/**
 * A page title for an identity page — its own heading, then the product name
 * through the root title template — so a browser tab, a history entry and a
 * screen reader's page announcement say which step this is instead of a bare
 * "One Minhaj" (Rebaseline R1). Each page passes its own `robots`, so its
 * noindex stays visible at the page.
 */
export function identityMetadata(key: IdentityTitle, base: Metadata) {
  return async function generateMetadata({
    params,
  }: {
    readonly params: Promise<{ readonly locale: string }>;
  }): Promise<Metadata> {
    const locale = await requireLocale(params);
    const t = await getTranslations({ locale, namespace: 'identity' });
    return { ...base, title: t(key) };
  };
}
