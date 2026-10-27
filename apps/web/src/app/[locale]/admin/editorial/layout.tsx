import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ locale: string }>;
  children: React.ReactNode;
}) {
  const locale = await requireLocale(params),
    t = await getTranslations({ locale, namespace: 'editorial' });
  const active = await requireOwnSession(locale);
  const held = active
    ? (await identityRuntime().authorization.evaluate(active.session)).permissions
    : new Set<string>();
  return (
    <>
      <WorkspaceNav
        label={t('title')}
        variant="tabs"
        groups={[
          {
            key: 'editorial',
            links: (
              [
                'articles',
                'pages',
                'news',
                'press-releases',
                'statements',
                'media-coverage',
                'events',
                'collections',
                'queue',
                'correspondence',
              ] as const
            )
              .filter((section) =>
                held.has(
                  section === 'correspondence' ? 'correspondence.read' : 'content.read',
                ),
              )
              .map((section) => ({
                key: section,
                href: '/' + locale + '/admin/editorial/' + section,
                text: t(section),
              })),
          },
        ]}
      />
      <NextIntlClientProvider
        locale={locale}
        messages={{
          editorial: {
            unknown: t('unknown'),
            reload: t('reload'),
            loading: t('loading'),
          },
        }}
      >
        {children}
      </NextIntlClientProvider>
    </>
  );
}
