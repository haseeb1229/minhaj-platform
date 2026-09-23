import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { libraryReadRuntime } from '@/composition/library-read';
import { requireLocale } from '@/config/route-locale';
import {
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  TextLink,
} from '@/components/ui';
import { readLibraryQuery } from '@/components/library/presentation';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/sale-points` — where printed books can be obtained
 * (ROUTE_MAP.md §5, DOMAIN_MODEL.md §10.2).
 *
 * INFORMATION, NOT COMMERCE, and the phase contract is explicit that this must
 * stay that way: "SalePoint is printed-book availability information, NOT
 * e-commerce" (§7, §30). There is no cart, no checkout, no payment, no order, no
 * inventory, no shipping and no price anywhere in this phase — not modelled, not
 * rendered, not stubbed. Donations are Phase 27's and are a different thing again.
 *
 * NO PRICE FIELD EXISTS, deliberately. A `SalePoint` carries a name, an address, a
 * contact and an optional URL. Adding a price because a sale point implies one
 * would be inventing commerce the product has not asked for — and money, when it
 * genuinely exists, has to be modelled exactly rather than as a number somebody
 * added to a page (§O).
 *
 * EVERY ROW IS DATA SOMEBODY ENTERED. Nothing here is seeded: no official address,
 * no telephone number and no shop is invented by this platform, and the test
 * fixtures are unmistakably synthetic (§30).
 */
export const dynamic = 'force-dynamic';

interface SalePointParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** How many sale points one page shows. The reader's own page size. */
const SALE_POINT_PAGE = 25;

export async function generateMetadata({ params }: SalePointParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.sale-points'),
    title: t('section.sale-points'),
    description: t('sectionBody.sale-points'),
  });
}

export default async function SalePointsPage({ params, searchParams }: SalePointParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;

  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const { offset } = readLibraryQuery(query);
  const page = await libraryReadRuntime().salePoints(offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/library`, text: t('title') },
            { text: t('section.sale-points') },
          ]}
        />

        <Prose>
          <PageHeading>{t('section.sale-points')}</PageHeading>
          <p>{t('sectionBody.sale-points')}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('salePointsNotice')}
          </p>
        </Prose>

        {page.items.length === 0 ? (
          <EmptyState>{t('emptySalePoints')}</EmptyState>
        ) : (
          <ul aria-label={t('section.sale-points')} className="flex flex-col gap-4">
            {page.items.map((point) => (
              <Panel key={point.id} as="li">
                <div className="flex flex-col gap-2">
                  {/*
                   * `dir="auto"` on operator-entered values, and only on these.
                   * A shop name or a street address is free text in an unknown
                   * script — it has no declared content language the way an
                   * Edition does — so the browser resolving direction from the
                   * text itself is the honest answer rather than a guess from the
                   * interface locale.
                   */}
                  <h2 className="text-lg font-semibold" dir="auto">
                    {point.name}
                  </h2>
                  <dl>
                    {point.address === '' ? null : (
                      <DetailRow term={t('salePointAddress')}>
                        <span dir="auto">{point.address}</span>
                      </DetailRow>
                    )}
                    {point.contact === '' ? null : (
                      <DetailRow term={t('salePointContact')}>
                        <span dir="auto">{point.contact}</span>
                      </DetailRow>
                    )}
                    {point.url === null ? null : (
                      <DetailRow term={t('salePointWebsite')}>
                        <TextLink href={point.url}>{point.url}</TextLink>
                      </DetailRow>
                    )}
                  </dl>
                </div>
              </Panel>
            ))}
          </ul>
        )}

        <nav className="flex gap-6" aria-label={t('section.sale-points')}>
          {offset > 0 ? (
            <TextLink
              href={`/${locale}/library/sale-points?offset=${String(Math.max(0, offset - SALE_POINT_PAGE))}`}
            >
              {t('previous')}
            </TextLink>
          ) : null}
          {page.hasMore ? (
            <TextLink
              href={`/${locale}/library/sale-points?offset=${String(offset + SALE_POINT_PAGE)}`}
            >
              {t('next')}
            </TextLink>
          ) : null}
        </nav>
      </div>
    </Container>
  );
}
