import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { WorkspaceShell } from '@/components/workspace/parts';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { requireLocale } from '@/config/route-locale';

/**
 * My Minhaj's workspace frame (ROUTE_MAP.md §5.1): a header band naming the
 * area and the area's sections, beside every `/my` page.
 *
 * IT READS NO SESSION. Every page beneath runs `requireActiveSession` itself,
 * with its OWN return path, so a signed-out visitor is sent to sign in and
 * brought back to the exact page they asked for. A guard here could only send
 * them back to `/my`. The frame holds nothing personal — the area's name and
 * links to routes every account has — and the person's own details are shown
 * by the pages that read them.
 *
 * THE AREA NAMES ITSELF IN TEXT, not a heading, so each page keeps exactly one
 * `h1` inside its own `main`.
 *
 * `noindex, nofollow` and per request for the whole tree, as every page beneath
 * already declares: a cached copy of anything under `/my` would be somebody
 * else's.
 */
export const metadata = { robots: { index: false, follow: false } };

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
  const personal = await getTranslations({ locale, namespace: 'personal' });
  const learning = await getTranslations({ locale, namespace: 'myLearning' });
  const classes = await getTranslations({ locale, namespace: 'myClasses' });
  const messages = await getTranslations({ locale, namespace: 'messages' });
  const membership = await getTranslations({ locale, namespace: 'myMembership' });
  const donations = await getTranslations({ locale, namespace: 'myDonations' });

  const my = `/${locale}/my`;

  return (
    <WorkspaceShell
      locale={locale}
      skipLabel={w('skip')}
      area={identity('my.title')}
      nav={
        <WorkspaceNav
          label={identity('my.title')}
          variant="sidebar"
          groups={[
            {
              key: 'my',
              links: [
                { key: 'overview', href: my, text: w('my.overview'), exact: true },
                {
                  key: 'learning',
                  href: `${my}/learning`,
                  text: learning('nav.learning'),
                  also: [`${my}/progress/courses`],
                },
                {
                  key: 'classes',
                  href: `${my}/classes`,
                  text: classes('nav.classes'),
                  also: [`${my}/teachers`],
                },
                {
                  key: 'messages',
                  href: `${my}/messages`,
                  text: messages('nav.messages'),
                },
                {
                  key: 'notifications',
                  href: `${my}/notifications`,
                  text: personal('nav.notifications'),
                },
                { key: 'saved', href: `${my}/saved`, text: personal('nav.saved') },
                {
                  key: 'history',
                  href: `${my}/history/reading`,
                  text: w('my.history'),
                  also: [`${my}/history`],
                },
                {
                  key: 'quran',
                  href: `${my}/progress/quran`,
                  text: personal('nav.quran'),
                },
                {
                  key: 'questions',
                  href: `${my}/questions`,
                  text: identity('my.questions'),
                },
                {
                  key: 'membership',
                  href: `${my}/membership`,
                  text: membership('nav.membership'),
                },
                {
                  key: 'donations',
                  href: `${my}/donations`,
                  text: donations('nav.donations'),
                },
                {
                  key: 'settings',
                  href: `${my}/settings/profile`,
                  text: w('my.settings'),
                  also: [`${my}/settings`],
                },
              ],
            },
          ]}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
