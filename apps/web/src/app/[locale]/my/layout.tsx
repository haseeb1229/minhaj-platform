import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { MyShell } from '@/components/my/frame';
import { MyNav } from '@/components/my/my-nav';
import { myNavigation } from '@/components/my/sections';
import { requireLocale } from '@/config/route-locale';
import { privateAreaMetadata } from '@/shell/private-metadata';
import { myStaffAreas } from './staff';

/**
 * My Minhaj's frame (ROUTE_MAP.md §5.1; redesigned in R2): the product bar,
 * the area's grouped navigation and the page.
 *
 * EVERY SECTION IS LISTED for every account (owner direction 2026-11-08) —
 * each page says in words when its service is not available yet. R2 chose the
 * list from which services the deployment had switched on (historical,
 * superseded 2026-11-08).
 *
 * IT NEVER SENDS ANYONE AWAY. Every page beneath runs `requireActiveSession`
 * itself, with its OWN return path, so a signed-out visitor is sent to sign in
 * and brought back to the exact page they asked for. The frame only ASKS
 * whether there is an active session, and only to decide one thing: whether
 * Identity says this person may enter the Teacher area or the administration
 * (`./staff.ts`), so their navigation can offer the way there. Without a
 * session, or when the question fails, neither is offered. The person's own
 * details are shown by the pages that read them.
 *
 * `noindex, nofollow` and per request for the whole tree, as every page beneath
 * already declares: a cached copy of anything under `/my` would be somebody
 * else's. Each page names itself in the title template ("Saved · My Minhaj").
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });
  return privateAreaMetadata(t('my.title'), { robots: { index: false, follow: false } });
}

export const dynamic = 'force-dynamic';

export default async function MyLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const w = await getTranslations({ locale, namespace: 'workspace' });
  const identity = await getTranslations({ locale, namespace: 'identity' });
  const t = await getTranslations({ locale, namespace: 'my' });
  const groups = myNavigation(locale, await myStaffAreas(locale), {
    section: (key) => t(`nav.section.${key}`),
    group: (key) => t(`nav.group.${key}`),
  });

  return (
    <MyShell
      locale={locale}
      area={identity('my.title')}
      skipLabel={w('skip')}
      nav={
        <MyNav
          label={identity('my.title')}
          groups={groups}
          menuLabel={t('nav.menu')}
          closeLabel={t('nav.close')}
          homeLabel={t('nav.section.home')}
        />
      }
    >
      {children}
    </MyShell>
  );
}
