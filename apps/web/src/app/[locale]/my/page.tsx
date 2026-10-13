import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';
import { DetailRow, PageHeading, Panel, TextLink } from '@/components/ui';
import { requireActiveSession } from './guard';
import { SignOutForm } from './sign-out-form';

/**
 * My Minhaj — the base account landing (ROUTE_MAP.md §5.1, Phase 2).
 *
 * `/my` is a LAYER-4 composition surface, not a bounded context. It composes
 * what each owner has delivered and NOTHING ELSE: it renders no empty frame
 * for saved items, history, notifications, learning, messages, membership or
 * donations, because those belong to contexts that have not shipped. A promised
 * surface must never be mistaken for a delivered one (§5.1, §5.2). Fatwa's
 * `/my/questions` (Phase 20) is the first owner after Identity to ship here.
 */
export const metadata = { robots: { index: false, follow: false } };

/**
 * PER REQUEST, always. This surface reads a session or a one-time token, so
 * there is nothing to prerender and a cached copy would be somebody else's.
 */
export const dynamic = 'force-dynamic';

export default async function MyPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'identity' });
  const session = await requireActiveSession(locale, `/${locale}/my`);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('my.title')}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('my.description')}
        </p>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('common.name')}>{session.account.name}</DetailRow>
          <DetailRow term={t('common.email')}>{session.account.email}</DetailRow>
        </dl>
      </Panel>

      <nav className="flex flex-col gap-2" aria-label={t('my.title')}>
        <TextLink href={`/${locale}/my/settings/profile`}>{t('my.profile')}</TextLink>
        <TextLink href={`/${locale}/my/settings/security`}>{t('my.security')}</TextLink>
        <TextLink href={`/${locale}/my/settings/language`}>{t('my.language')}</TextLink>
        <TextLink href={`/${locale}/my/questions`}>{t('my.questions')}</TextLink>
      </nav>

      <SignOutForm locale={locale} label={t('my.signOut')} />
    </main>
  );
}
