import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import { TextLink } from '@/components/ui';

/**
 * The Learning administration shell (ROUTE_MAP.md §7:
 * `/admin/learning/{courses|paths|classes|enrolments|trials}`), Phase 22.
 *
 * ONLY WHAT EXISTS. Phase 22 delivers courses, paths, enrolments and trials;
 * classes are Phase 23's teaching work and have no link and no route here.
 * Enrolments and trials are COUNTS — no Learning permission reveals who
 * enrolled or who asked for a trial class — and the trials page confirms,
 * schedules and assigns nothing.
 *
 * `noindex, nofollow` for the whole subtree, and the navigation is filtered by
 * permission as presentation only: every page re-checks `learning.read`
 * server-side and every action re-checks `learning.administer`
 * (SECURITY_BASELINE.md §3.4 rule 1).
 *
 * OPERATOR TEXT NEVER WIDENS THE PAGE. Titles, slugs and lesson words are typed
 * by operators and may hold a long unbroken token; the content may break one
 * anywhere rather than push a phone-width screen sideways.
 *
 * THE CLIENT PROVIDER CARRIES THREE STRINGS — the error boundary's copy — rather
 * than shipping every administrative message to the browser.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const SURFACES = ['courses', 'paths', 'enrolments', 'trials'] as const;

export default async function LearningAdminLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'adminLearning' });

  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();

  return (
    <>
      {held.has('learning.read') ? (
        <nav className="flex flex-wrap gap-4" aria-label={t('title')}>
          {SURFACES.map((surface) => (
            <TextLink key={surface} href={`/${locale}/admin/learning/${surface}`}>
              {t(`surface.${surface}`)}
            </TextLink>
          ))}
        </nav>
      ) : null}

      <NextIntlClientProvider
        locale={locale}
        messages={{
          adminLearning: {
            unknown: t('unknown'),
            reload: t('reload'),
            loading: t('loading'),
          },
        }}
      >
        <div className="min-w-0 wrap-anywhere">{children}</div>
      </NextIntlClientProvider>
    </>
  );
}
