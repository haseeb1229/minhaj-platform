import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  FATWA_CATEGORY_STATUSES,
  FATWA_LIMITS,
  FATWA_PERMISSIONS,
  type FatwaCategoryRecord,
} from '@minhaj/contracts/fatwa';

import { ownerReferenceChoices } from '@/composition/owner-references';
import { fatwaRuntime } from '@/composition/fatwa';
import {
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { createFatwaCategory, updateFatwaCategory } from './actions';
import {
  actorOf,
  categoryNames,
  DetailHeading,
  fatwaCopy,
  recordTarget,
  requireFatwaAreaPage,
  topicNames,
  type Copy,
  type ListParams,
} from './shared';

/**
 * The category screens (ROUTE_MAP.md §7: `/admin/fatwa/categories`), Phase 20.
 *
 * READ BY EVERY STAGE, MAINTAINED UNDER `fatwa.publish`. Any Fatwa key opens the
 * list, because triage and drafting both choose a category; only a scholar
 * holding `fatwa.publish` is offered the forms, and the action and the service
 * re-check that key.
 *
 * A CATEGORY MAPS ONTO ONE CANONICAL TOPIC and never replaces it
 * (DOMAIN_MODEL.md §12, §6.2). Its slug is chosen once and then shown as fixed
 * text; a category is archived rather than deleted, so a ruling filed under it
 * keeps its classification.
 */

const NAME_LOCALES = ['en', 'ur', 'ar'] as const satisfies readonly Locale[];
const NAME_KEYS = {
  en: 'categories.nameEn',
  ur: 'categories.nameUr',
  ar: 'categories.nameAr',
} as const;

function StatusText({
  status,
  copy,
}: {
  readonly status: FatwaCategoryRecord['status'];
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={status === 'active' ? 'positive' : 'caution'}>
      {copy.t(`categories.statusName.${status}`)}
    </StatusBadge>
  );
}

/** The fields a create and an update share: topic, position and the names. */
function CategoryFields({
  prefix,
  category,
  topics,
  copy,
}: {
  readonly prefix: string;
  readonly category: FatwaCategoryRecord | null;
  readonly topics: readonly { readonly id: string; readonly name: string }[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <Field
        id={`${prefix}-topic`}
        label={t('categories.topic')}
        help={t('categories.topicHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="topicId"
            required
            defaultValue={category?.topicId ?? ''}
          >
            <option value="">{t('categories.topicChoose')}</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id={`${prefix}-position`}
        label={t('categories.position')}
        help={t('categories.positionHelp')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="position"
            type="number"
            required
            min={0}
            max={100_000}
            step={1}
            inputMode="numeric"
            defaultValue={String(category?.position ?? 0)}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-3" aria-describedby={`${prefix}-names-help`}>
        <legend className="text-sm font-medium">{t('categories.names')}</legend>
        <p
          id={`${prefix}-names-help`}
          className="text-sm text-[color:var(--color-foreground-muted)]"
        >
          {t('categories.namesHelp')}
        </p>
        {NAME_LOCALES.map((locale) => (
          <Field
            key={locale}
            id={`${prefix}-name-${locale}`}
            label={t(NAME_KEYS[locale])}
          >
            {(props) => (
              <TextInput
                {...props}
                name={`name-${locale}`}
                lang={locale}
                dir="auto"
                maxLength={FATWA_LIMITS.categoryName}
                defaultValue={
                  category?.names.find((entry) => entry.locale === locale)?.name ?? ''
                }
              />
            )}
          </Field>
        ))}
      </fieldset>
    </>
  );
}

/**
 * The topics a category may map onto: Taxonomy's active topics, plus the one
 * the category already names if it has since been archived — by name, so a
 * saved choice is never silently cleared.
 */
async function topicChoices(
  locale: Locale,
  current: string | null,
  copy: Copy,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  const { topics } = await ownerReferenceChoices(locale, '');
  if (current === null || topics.some((topic) => topic.id === current)) return topics;
  const names = await topicNames([current], locale);
  return [
    { id: current, name: names.get(current) ?? copy.t('topicUnavailable') },
    ...topics,
  ];
}

/* ===========================================================================
 * The list, and the creation of a category
 * ========================================================================= */

export async function CategoriesScreen({ params }: ListParams) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/fatwa/categories`;
  const context = await requireFatwaAreaPage(locale, base);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const maintains = context.authorization.can(FATWA_PERMISSIONS.publish);

  const categories = await fatwaRuntime().workflow.categories(actorOf(context));
  const names = categoryNames(categories, locale);
  const [topics, choices] = await Promise.all([
    topicNames(
      categories.map((category) => category.topicId),
      locale,
    ),
    maintains ? topicChoices(locale, null, copy) : Promise.resolve([]),
  ]);
  const ordered = [...categories].sort(
    (a, b) => a.position - b.position || a.slug.localeCompare(b.slug),
  );

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.categories')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.categories')}
      </p>
      {maintains ? null : <p className="text-sm">{t('categories.readOnly')}</p>}

      {ordered.length === 0 ? (
        <EmptyState>{t('categories.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.categories')}
          columns={[
            t('categories.name'),
            t('categories.slug'),
            t('categories.topic'),
            t('categories.position'),
            t('categories.status'),
          ]}
        >
          {ordered.map((category) => (
            <DataRow key={category.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${category.id}`}>
                  <span dir="auto">{names.get(category.id)}</span>
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr" className="wrap-anywhere">
                  {category.slug}
                </span>
              </DataCell>
              <DataCell wrap>
                <span dir="auto">
                  {topics.get(category.topicId) ?? t('topicUnavailable')}
                </span>
              </DataCell>
              <DataCell>{category.position}</DataCell>
              <DataCell>
                <StatusText status={category.status} copy={copy} />
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      {maintains ? (
        <section className="flex flex-col gap-4" aria-labelledby="fatwa-category-create">
          <h2 id="fatwa-category-create" className="text-lg font-semibold tracking-tight">
            {t('categories.create')}
          </h2>
          <ActionForm
            action={createFatwaCategory}
            submitLabel={t('categories.createSubmit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <Field
              id="fatwa-category-new-slug"
              label={t('categories.slug')}
              help={t('categories.slugHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={120}
                  dir="ltr"
                />
              )}
            </Field>
            <CategoryFields
              prefix="fatwa-category-new"
              category={null}
              topics={choices}
              copy={copy}
            />
          </ActionForm>
        </section>
      ) : null}
    </main>
  );
}

/* ===========================================================================
 * One category
 * ========================================================================= */

export async function CategoryScreen({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/fatwa/categories`;
  const context = await requireFatwaAreaPage(locale, `${list}/${id}`);
  const copy = await fatwaCopy(locale);
  const { t } = copy;
  const maintains = context.authorization.can(FATWA_PERMISSIONS.publish);

  const categories = await fatwaRuntime().workflow.categories(actorOf(context));
  const category = categories.find((entry) => entry.id === id);
  if (category === undefined) notFound();
  const name = categoryNames([category], locale).get(category.id) ?? category.slug;
  const [topics, choices] = await Promise.all([
    topicNames([category.topicId], locale),
    maintains ? topicChoices(locale, category.topicId, copy) : Promise.resolve([]),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <DetailHeading back={list} copy={copy}>
        <span dir="auto">{name}</span>
      </DetailHeading>

      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow term={t('categories.slug')}>
          <span dir="ltr">{category.slug}</span>
        </DetailRow>
        <DetailRow term={t('categories.status')}>
          <StatusText status={category.status} copy={copy} />
        </DetailRow>
        <DetailRow term={t('categories.topic')}>
          <span dir="auto">{topics.get(category.topicId) ?? t('topicUnavailable')}</span>
        </DetailRow>
        <DetailRow term={t('categories.position')}>{category.position}</DetailRow>
        {NAME_LOCALES.map((nameLocale) => (
          <DetailRow key={nameLocale} term={t(NAME_KEYS[nameLocale])}>
            <span lang={nameLocale} dir="auto">
              {category.names.find((entry) => entry.locale === nameLocale)?.name ??
                t('none')}
            </span>
          </DetailRow>
        ))}
        <DetailRow term={t('version')}>{category.version}</DetailRow>
      </dl>

      {maintains ? (
        <section className="flex flex-col gap-4" aria-labelledby="fatwa-category-update">
          <h2 id="fatwa-category-update" className="text-lg font-semibold tracking-tight">
            {t('categories.update')}
          </h2>
          <ActionForm
            action={updateFatwaCategory}
            submitLabel={t('categories.updateSubmit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="version" value={String(category.version)} />
            <p className="text-sm">
              {t('categories.slug')}: <span dir="ltr">{category.slug}</span>
              <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                {t('categories.slugFixed')}
              </span>
            </p>
            <CategoryFields
              prefix="fatwa-category-edit"
              category={category}
              topics={choices}
              copy={copy}
            />
            <Field
              id="fatwa-category-edit-status"
              label={t('categories.status')}
              help={t('categories.statusHelp')}
            >
              {(props) => (
                <Select {...props} name="status" required defaultValue={category.status}>
                  {FATWA_CATEGORY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`categories.statusName.${status}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </ActionForm>
        </section>
      ) : (
        <p className="text-sm">{t('categories.readOnly')}</p>
      )}
    </main>
  );
}
