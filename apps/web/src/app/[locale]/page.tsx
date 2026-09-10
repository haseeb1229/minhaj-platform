import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { endonymOf, isSupportedLocale } from '@/config/locale';

/**
 * Foundation page — a Server Component shipping no client JavaScript of its
 * own.
 *
 * Its job is to prove that the application builds, renders and starts in all
 * three locales, and to give the locale switcher a real route to switch on.
 * This is NOT the homepage: no hero, no marketing sections, no navigation
 * hierarchy, no visual identity. Those belong to the design phase
 * (OPEN_DECISIONS.md §6.4), and the header the switcher will eventually live in
 * belongs to Phase 4.
 *
 * Statically renderable. Every value shown comes from the route parameter and
 * the message catalogue, so the anonymous public tree keeps the caching
 * capability ARCHITECTURE.md §8 requires.
 *
 * Every utility here is logical-direction (`ms-*`, `ps-*`, `text-start`), which
 * is what makes the same markup correct in English, Urdu and Arabic
 * (TECH_STACK.md §5).
 */
export default async function FoundationPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;

  // The layout's guard is the authority; this route validates its own input
  // rather than assuming an ancestor did, because each is reached
  // independently by the framework.
  if (!isSupportedLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'foundation' });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16 text-start">
      <h1 className="text-2xl font-semibold">{t('heading')}</h1>

      <p>{t('intro')}</p>

      <dl className="flex flex-col gap-2 border-s-2 ps-4">
        <div className="flex gap-2">
          <dt className="font-medium">{t('phaseLabel')}</dt>
          <dd>{t('phaseValue')}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">{t('localeLabel')}</dt>
          {/*
           * The locale's own name, in its own script. It is the one value on
           * this page whose language is fixed by what it names rather than by
           * the surrounding document, so it carries its own `lang` — the same
           * mixed-direction rule the switcher labels follow.
           */}
          <dd lang={locale}>{endonymOf(locale)}</dd>
        </div>
      </dl>

      <LocaleSwitcher locale={locale} />
    </main>
  );
}
