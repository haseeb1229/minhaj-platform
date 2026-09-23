import { requireAdminPage } from '@/composition/authorization';
import { libraryReferenceChoices, libraryRuntime } from '@/composition/library';
import { requireLocale } from '@/config/route-locale';
import {
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { pageOffset, queryValue, PAGE_SIZE } from '../../shared';
import { libraryCopy, RemoveTranslationForm, TranslationForm } from '../forms';

/**
 * `/{locale}/admin/library/translations` — recording which Editions are GENUINE
 * TRANSLATIONS (ROUTE_MAP.md §7, DOMAIN_MODEL.md §10.1).
 *
 * WHY THIS IS ITS OWN SURFACE. "A translated book is not a translated UI label." A
 * Work's Urdu title is descriptive metadata, edited on the Work; an Urdu
 * TRANSLATION is a distinct Edition with its own translators and its own scholarly
 * standing, recorded here. Putting both behind one "Urdu" checkbox is precisely the
 * conflation the domain model was rewritten to correct (§8).
 *
 * ONE ROUTE, TWO STATES. Without `?edition=` it lists Editions and whether each is
 * recorded as a translation; with one, it shows that Edition's translation forms.
 * The query parameter is a SELECTION — the Edition is re-read through the service
 * with the caller's live permission, and an identifier naming nothing shows the
 * listing again rather than an error.
 */
export const dynamic = 'force-dynamic';

export default async function TranslationsPage({
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
    `/${locale}/admin/library/translations`,
  );

  const copy = await libraryCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  const selectedId = queryValue(query, 'edition');
  const selected =
    selectedId === null
      ? null
      : await libraryRuntime()
          .library.edition(actor, selectedId)
          .catch(() => null);

  if (selected !== null) {
    // SIBLINGS ONLY. The source of a translation must be an Edition of the SAME
    // Work, so the choices are that Work's Editions — and the persistence layer
    // refuses anything else regardless of what the form submits.
    const [work, choices] = await Promise.all([
      libraryRuntime().library.work(actor, selected.workId),
      libraryReferenceChoices(locale, queryValue(query, 'q') ?? ''),
    ]);

    return (
      <main className="flex flex-col gap-8">
        <PageHeading>{selected.label}</PageHeading>

        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('translationHelp')}
        </p>

        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('admin.translations')}</SectionHeading>
            <TranslationForm
              locale={locale}
              edition={selected}
              siblings={work?.editions ?? []}
              choices={choices}
              copy={copy}
            />
          </div>
        </Panel>

        {selected.translation === null ? null : (
          <RemoveTranslationForm locale={locale} edition={selected} copy={copy} />
        )}

        <p className="text-sm">
          <TextLink href={`/${locale}/admin/library/translations`}>
            {t('adminBackToList')}
          </TextLink>
        </p>
      </main>
    );
  }

  const offset = pageOffset(query, PAGE_SIZE);
  const page = await libraryRuntime().library.editions(actor, offset);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('admin.translations')}</PageHeading>

      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('translationHelp')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('adminEmpty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('admin.translations')}
          columns={[t('editionLabel'), t('contentLanguage'), t('isTranslation')]}
        >
          {page.items.map((record) => (
            <DataRow key={record.id}>
              <DataCell wrap>
                <TextLink
                  href={`/${locale}/admin/library/translations?edition=${encodeURIComponent(record.id)}`}
                >
                  {record.label}
                </TextLink>
              </DataCell>
              <DataCell>{record.languageCode}</DataCell>
              {/* Stated in words, never by colour alone. */}
              <DataCell>{record.translation === null ? t('no') : t('yes')}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      <nav className="flex gap-6" aria-label={t('admin.translations')}>
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
    </main>
  );
}
