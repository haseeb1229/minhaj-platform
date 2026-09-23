import { notFound } from 'next/navigation';

import { requireAdminPage } from '@/composition/authorization';
import { libraryReferenceChoices, libraryRuntime } from '@/composition/library';
import { requireLocale } from '@/config/route-locale';
import { PageHeading, Panel, SectionHeading, TextLink } from '@/components/ui';
import { EditionAssetForm, EditionForm, libraryCopy } from '../../forms';

/**
 * `/{locale}/admin/library/editions/{id}` — editing one Edition.
 *
 * THREE THINGS HAPPEN ON THIS SCREEN, and they are three forms rather than one,
 * because they commit to different places:
 *
 *   - EDITING the Edition is one SQL transaction with one expected version;
 *   - ATTACHING a file writes bytes through Storage and THEN writes a relation in
 *     SQL — two commits that are not one transaction, and presenting them under one
 *     button would have claimed otherwise (§29);
 *   - PREVIEWING an attached file is a read, behind a live `library.administer`
 *     check on a route Library owns.
 *
 * THE PREVIEW LINK IS NOT A GENERAL-PURPOSE FILE READER: it serves only an asset
 * already recorded against THIS Edition, only to a caller holding the permission
 * right now, and only when Storage's own custody check also passes (§16, §28, §45).
 */
export const dynamic = 'force-dynamic';

export default async function EditionEditor({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;

  const context = await requireAdminPage(
    locale,
    'library.read',
    `/${locale}/admin/library/editions`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  // A malformed identifier is the page's own 404, not an error boundary.
  const record = await libraryRuntime()
    .library.edition(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const [works, choices] = await Promise.all([
    libraryRuntime().library.works(actor, 0),
    libraryReferenceChoices(locale, ''),
  ]);

  const attached = [
    ['readableAsset', record.readableAssetId],
    ['downloadAsset', record.downloadAssetId],
  ] as const;

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{record.label}</PageHeading>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('attachedFiles')}</SectionHeading>
          <ul className="flex flex-col gap-2 text-sm">
            {attached.map(([slot, assetId]) => (
              <li key={slot}>
                <span className="font-medium">{t(slot)}: </span>
                {assetId === null ? (
                  t('none')
                ) : (
                  <TextLink
                    href={`/assets/library/previews/${encodeURIComponent(record.id)}/${encodeURIComponent(assetId)}`}
                  >
                    {t('previewFile')}
                  </TextLink>
                )}
              </li>
            ))}
          </ul>

          <EditionAssetForm locale={locale} record={record} copy={copy} />
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('editEdition')}</SectionHeading>
          <EditionForm
            locale={locale}
            record={record}
            works={works.items}
            choices={choices}
            copy={copy}
          />
        </div>
      </Panel>

      <p className="text-sm">
        <TextLink
          href={`/${locale}/admin/library/translations?edition=${encodeURIComponent(record.id)}`}
        >
          {t('adminManageTranslation')}
        </TextLink>
      </p>
    </main>
  );
}
