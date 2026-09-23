import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { libraryReadRuntime } from '@/composition/library-read';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  TextLink,
} from '@/components/ui';
import {
  labelFor,
  readLibraryQuery,
  workPath,
  WORK_PAGE,
} from '@/components/library/presentation';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/downloads` — Works with a download that is actually allowed
 * (ROUTE_MAP.md §5, "Access").
 *
 * THE FILTER IS FORCED, NOT REQUESTED. `downloads` is set here rather than read
 * from the query, so this page cannot be turned into the unfiltered listing by
 * removing a parameter — and, more importantly, cannot be turned into a list of
 * books whose files merely EXIST. The reader's filter matches on the Library-owned
 * availability decision AND on a present file, both of them, because either one
 * alone would be a lie: a file with no permission is not a download, and a
 * permission with no file is not one either (§26, §31).
 *
 * WHAT THIS PAGE DOES NOT DO. It does not state a licence, a rights holder or a
 * legal basis, because the data carries none and inventing one would be inventing
 * law. It offers the download where the decision permits it and says nothing more
 * (§26).
 *
 * THE DOWNLOAD LINK ITSELF IS ON THE WORK PAGE, not here. This is a discovery
 * listing, and each row goes to the Work where the Edition — and therefore which
 * edition's file, in which language — can be chosen honestly.
 */
export const dynamic = 'force-dynamic';

interface DownloadsParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: DownloadsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.downloads'),
    title: t('section.downloads'),
    description: t('sectionBody.downloads'),
  });
}

export default async function DownloadsPage({ params, searchParams }: DownloadsParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;

  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const { offset } = readLibraryQuery(query);
  const page = await libraryReadRuntime().works({ offset, downloads: true });

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/library`, text: t('title') },
            { text: t('section.downloads') },
          ]}
        />

        <Prose>
          <PageHeading>{t('section.downloads')}</PageHeading>
          <p>{t('sectionBody.downloads')}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('downloadsNotice')}
          </p>
        </Prose>

        {page.items.length === 0 ? (
          <EmptyState>{t('emptyDownloads')}</EmptyState>
        ) : (
          <ul aria-label={t('section.downloads')} className="flex flex-col gap-4">
            {page.items.map((record) => {
              const label = labelFor(record, locale);
              return (
                <Panel key={record.id} as="li">
                  <h2
                    className="text-lg font-semibold"
                    lang={label.locale}
                    dir={directionOf(label.locale)}
                  >
                    <TextLink href={workPath(locale, record.slug)}>
                      {label.title}
                    </TextLink>
                  </h2>
                </Panel>
              );
            })}
          </ul>
        )}

        <nav className="flex gap-6" aria-label={t('section.downloads')}>
          {offset > 0 ? (
            <TextLink
              href={`/${locale}/library/downloads?offset=${String(Math.max(0, offset - WORK_PAGE))}`}
            >
              {t('previous')}
            </TextLink>
          ) : null}
          {page.hasMore ? (
            <TextLink
              href={`/${locale}/library/downloads?offset=${String(offset + WORK_PAGE)}`}
            >
              {t('next')}
            </TextLink>
          ) : null}
        </nav>
      </div>
    </Container>
  );
}
