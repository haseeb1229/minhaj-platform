import type { ReactNode } from 'react';

import { ProductBar } from '@/components/shell/product-bar';
import { requireLocale } from '@/config/route-locale';

/**
 * THE SIGN-IN SURFACES' FRAME (Rebaseline R1).
 *
 * Sign in, sign up, recovery and verification are ONE product with the public
 * site: the shared product bar gives them the One Minhaj wordmark, a way back
 * and the language switcher. A ROUTE GROUP, so no address changes, and nothing
 * here reads a session — each page's own guard and action decide everything.
 */
export default async function IdentityLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <ProductBar locale={locale} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
