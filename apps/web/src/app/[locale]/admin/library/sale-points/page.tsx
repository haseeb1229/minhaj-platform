import { requireAdminPage } from '@/composition/authorization';
import { libraryRuntime } from '@/composition/library';
import { requireLocale } from '@/config/route-locale';
import {
  EmptyState,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { pageOffset, PAGE_SIZE } from '../../shared';
import { libraryCopy, SalePointForm } from '../forms';

/**
 * `/{locale}/admin/library/sale-points` — printed-book availability records
 * (ROUTE_MAP.md §7, DOMAIN_MODEL.md §10.2).
 *
 * INFORMATION, NOT COMMERCE. A sale point has a name, an address, a contact and an
 * optional HTTPS link. There is no price, no stock level, no order and no payment
 * field to fill in, because Phase 8 builds none of them and a form field for one
 * would be a promise the product has not made (§7, §30).
 *
 * EACH RECORD IS EDITED IN PLACE, with its own expected version, so two operators
 * correcting the same shop's address conflict instead of silently overwriting each
 * other (§40).
 *
 * THE IDENTIFIER IS SHOWN, because it is how a Work is linked to a sale point on the
 * Work form. That is an operator convenience on a private, `noindex`, `no-store`
 * screen; it grants nothing.
 */
export const dynamic = 'force-dynamic';

export default async function SalePointsDirectory({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;

  const context = await requireAdminPage(
    locale,
    'library.read',
    `/${locale}/admin/library/sale-points`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const offset = pageOffset(query, PAGE_SIZE);

  const page = await libraryRuntime().library.salePoints(
    { accountId: context.session.account.id },
    offset,
  );

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('admin.sale-points')}</PageHeading>

      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('salePointsNotice')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('adminEmpty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {page.items.map((record) => (
            <Panel key={record.id} as="li">
              <div className="flex flex-col gap-3">
                <p className="text-xs text-[color:var(--color-foreground-muted)]">
                  {t('identifier')}: <code>{record.id}</code>
                </p>
                <SalePointForm locale={locale} record={record} copy={copy} />
              </div>
            </Panel>
          ))}
        </ul>
      )}

      <nav className="flex gap-6" aria-label={t('admin.sale-points')}>
        {offset > 0 ? (
          <TextLink href={`?page=${String(Math.max(1, offset / PAGE_SIZE))}`}>
            {t('previous')}
          </TextLink>
        ) : null}
        {page.hasMore ? (
          <TextLink href={`?page=${String(offset / PAGE_SIZE + 2)}`}>
            {t('next')}
          </TextLink>
        ) : null}
      </nav>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('createSalePoint')}</SectionHeading>
          <SalePointForm locale={locale} record={null} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}
