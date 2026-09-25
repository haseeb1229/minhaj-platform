import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { requireLocale } from '@/config/route-locale';
import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { TextLink } from '@/components/ui';
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
      <nav className="flex flex-wrap gap-4" aria-label={t('title')}>
        {(
          [
            'articles',
            'pages',
            'news',
            'press-releases',
            'statements',
            'media-coverage',
            'queue',
            'correspondence',
          ] as const
        )
          .filter((section) =>
            held.has(
              section === 'correspondence' ? 'correspondence.read' : 'content.read',
            ),
          )
          .map((section) => (
            <TextLink key={section} href={'/' + locale + '/admin/editorial/' + section}>
              {t(section)}
            </TextLink>
          ))}
      </nav>
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
