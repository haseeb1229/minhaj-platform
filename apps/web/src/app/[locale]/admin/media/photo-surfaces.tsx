import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  MEDIA_PAGE,
  mediaStateSchema,
  PHOTO_IMAGE_LIMITS,
  PHOTO_LIMITS,
  PHOTO_UPLOAD_MAX_BYTES,
  photoWords,
  type GalleryDetail,
  type GalleryRecord,
  type PhotoAdminQuery,
  type PhotoRecord,
} from '@minhaj/contracts/media';

import { requireAdminPage } from '@/composition/authorization';
import { mediaRuntime } from '@/composition/media';
import { servablePhotos } from '@/composition/media-assets';
import {
  galleryPath,
  mediaLabel,
  partialDate,
  photoAssetPath,
  photoPreviewPath,
} from '@/components/media/presentation';
import {
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import { changeGallery, saveGallery, savePhoto } from './actions';
import { PhotoUploader, type PhotoUploaderLabels } from './photo-uploader';
import {
  CommonFields,
  DirectoryFilter,
  directoryHref,
  directoryQuery,
  EditIdentity,
  LabelFields,
  mediaCopy,
  Pager,
  StateBadge,
  Title,
  type Copy,
  type EditorParams,
  type ListParams,
} from './surfaces';

/**
 * The photograph administration — Photos and Galleries (ROUTE_MAP.md §7:
 * `/admin/media/photos` and `/admin/media/galleries`), Phase 12.
 *
 * THE SAME RULES AS EVERY MEDIA SCREEN. `media.read` opens a screen and
 * `media.administer` is what every change re-checks, live; every form carries
 * its record's expected version.
 *
 * PICTURES, NOT IDENTIFIERS. Photos are chosen and ordered by looking at them.
 * An image shown here comes through the administrator's preview route — a live
 * `media.administer` and only the image recorded on that Photo — or, for a
 * reader without that permission, through the public route when the Photo is
 * public; otherwise the screen says what it cannot show. No asset identifier is
 * a field, and there is no file browser: an image belongs to its Photo.
 *
 * GAPS ARE VISIBLE. A Photo with no image, or with no alternative text in any
 * language, is labelled so and can be filtered for — a missing alternative is
 * recorded, never hidden and never invented (SECURITY_BASELINE.md §16.3).
 */

type Query = Record<string, string | string[] | undefined>;

/* ===========================================================================
 * Shared
 * ========================================================================= */

/** How a Photo is named on these screens: its caption, else its alternative text. */
function photoName(photo: PhotoRecord, locale: Locale, copy: Copy) {
  const words = photoWords(photo, locale);
  const chosen = words.caption ?? words.altText;
  return chosen === null
    ? { text: copy.t('photo.untitled'), locale: null }
    : { text: chosen.text, locale: chosen.locale };
}

/** The address an operator may see this Photo's image at, or `null`. */
function imageSource(
  photo: PhotoRecord,
  administer: boolean,
  servable: ReadonlySet<string>,
): string | null {
  if (photo.assetId === null || !servable.has(photo.id)) return null;
  if (administer) return photoPreviewPath(photo.id, photo.assetId);
  return photo.state === 'published' ? photoAssetPath(photo.id, photo.assetId) : null;
}

/** What is said in place of an image this screen cannot show. */
function missingImage(
  photo: PhotoRecord,
  administer: boolean,
  servable: ReadonlySet<string>,
  copy: Copy,
): string {
  if (photo.assetId === null) return copy.t('photo.imageNone');
  if (!servable.has(photo.id)) return copy.t('photo.imageUnavailable');
  return administer
    ? copy.t('photo.imageUnavailable')
    : copy.t('photo.previewRestricted');
}

function AdminImage({
  locale,
  photo,
  administer,
  servable,
  copy,
  large = false,
}: {
  readonly locale: Locale;
  readonly photo: PhotoRecord;
  readonly administer: boolean;
  readonly servable: ReadonlySet<string>;
  readonly copy: Copy;
  readonly large?: boolean;
}) {
  const source = imageSource(photo, administer, servable);
  const words = photoWords(photo, locale);
  if (source === null || photo.width === null || photo.height === null) {
    return (
      <div
        className={`flex items-center justify-center rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] p-4 text-center text-sm text-[color:var(--color-foreground-muted)] ${large ? 'min-h-48' : 'aspect-[4/3]'}`}
      >
        {missingImage(photo, administer, servable, copy)}
      </div>
    );
  }
  return (
    <img
      src={source}
      alt={words.altText?.text ?? copy.t('photo.altMissing')}
      {...(words.altText === null ? {} : { lang: words.altText.locale })}
      width={photo.width}
      height={photo.height}
      loading="lazy"
      decoding="async"
      className={
        large
          ? 'h-auto max-h-[28rem] w-auto max-w-full rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] object-contain'
          : 'aspect-[4/3] w-full rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] object-cover'
      }
    />
  );
}

/** Words for what a Photo lacks, never colour alone. */
function Gaps({ photo, copy }: { readonly photo: PhotoRecord; readonly copy: Copy }) {
  return (
    <>
      {photo.assetId === null ? (
        <StatusBadge tone="caution">{copy.t('photo.gapImage')}</StatusBadge>
      ) : null}
      {photo.labels.some((label) => label.altText !== null) ? null : (
        <StatusBadge tone="caution">{copy.t('photo.gapAlt')}</StatusBadge>
      )}
    </>
  );
}

function PhotoCard({
  locale,
  photo,
  administer,
  servable,
  copy,
  children,
}: {
  readonly locale: Locale;
  readonly photo: PhotoRecord;
  readonly administer: boolean;
  readonly servable: ReadonlySet<string>;
  readonly copy: Copy;
  readonly children?: ReactNode;
}) {
  const name = photoName(photo, locale, copy);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <AdminImage
        locale={locale}
        photo={photo}
        administer={administer}
        servable={servable}
        copy={copy}
      />
      <p className="text-sm break-words">
        <TextLink href={`/${locale}/admin/media/photos/${photo.id}`}>
          <span {...(name.locale === null ? {} : { lang: name.locale })} dir="auto">
            {name.text.length > 120 ? `${name.text.slice(0, 117)}…` : name.text}
          </span>
        </TextLink>
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <StateBadge state={photo.state} copy={copy} />
        <Gaps photo={photo} copy={copy} />
        {photo.taken === null ? null : (
          <time dateTime={partialDate(photo.taken, locale).machine}>
            {partialDate(photo.taken, locale).text}
          </time>
        )}
      </p>
      {children}
    </div>
  );
}

function uploaderLabels(copy: Copy, batch: boolean): PhotoUploaderLabels {
  const { t } = copy;
  const size = `${String(PHOTO_UPLOAD_MAX_BYTES / (1024 * 1024))} MB`;
  return {
    file: batch ? t('photo.uploadMany') : t('photo.replace'),
    help: t('photo.uploadHelp', {
      size,
      megapixels: String(PHOTO_IMAGE_LIMITS.maxPixels / 1_000_000),
      edge: String(PHOTO_IMAGE_LIMITS.maxEdge),
    }),
    submit: batch ? t('photo.uploadSubmit') : t('photo.replaceSubmit'),
    pending: t('photo.uploading'),
    progress: t('photo.progress'),
    success: batch ? t('photo.uploadedMany') : t('photo.uploaded'),
    fileDone: t('photo.fileDone'),
    fileFailed: t('photo.fileFailed'),
    openDraft: t('photo.openDraft'),
    failures: {
      ...copy.messages,
      unsupported: t('photo.unsupported'),
      'too-large': t('photo.tooLarge'),
      dimensions: t('photo.dimensions'),
      'not-cleared': t('photo.notCleared'),
    },
  };
}

/* ===========================================================================
 * Photos
 * ========================================================================= */

function photoQuery(query: Query): PhotoAdminQuery {
  const base = directoryQuery(query);
  const gap = queryValue(query, 'gap');
  return { ...base, gap: gap === 'image' || gap === 'alt' ? gap : null };
}

function photoHref(base: string, filter: PhotoAdminQuery): (page: number) => string {
  const shared = directoryHref(base, filter);
  return (page) => {
    const href = shared(page);
    if (filter.gap === null) return href;
    return `${href}${href.includes('?') ? '&' : '?'}gap=${filter.gap}`;
  };
}

export async function PhotoDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/photos`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const filter = photoQuery(query);
  const administer = context.authorization.can('media.administer');
  const page = await mediaRuntime().media.photos(
    { accountId: context.session.account.id },
    filter,
  );
  const servable = await servablePhotos(page.items);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.photos')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('photo.scope')}
      </p>

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('photo.create')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('photo.createHelp')}
            </p>
            <PhotoUploader
              mode="batch"
              locale={locale}
              editorBase={base}
              maxBytes={PHOTO_UPLOAD_MAX_BYTES}
              labels={uploaderLabels(copy, true)}
            />
          </div>
        </Panel>
      ) : null}

      <div className="flex flex-col gap-3">
        <DirectoryFilter
          base={base}
          state={filter.state}
          text={filter.text ?? ''}
          copy={copy}
          textLabel={t('photo.textFilter')}
        />
        <nav aria-label={t('photo.gapLabel')} className="flex flex-wrap gap-4 text-sm">
          {(['all', 'image', 'alt'] as const).map((gap) => {
            const current = (filter.gap ?? 'all') === gap;
            const href = photoHref(base, {
              ...filter,
              offset: 0,
              gap: gap === 'all' ? null : gap,
            })(1);
            return current ? (
              <span key={gap} aria-current="page" className="font-semibold">
                {t(`photo.gapFilter.${gap}`)}
              </span>
            ) : (
              <TextLink key={gap} href={href}>
                {t(`photo.gapFilter.${gap}`)}
              </TextLink>
            );
          })}
        </nav>
      </div>

      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <ul
          aria-label={t('surface.photos')}
          className="grid grid-cols-1 gap-6 min-[400px]:grid-cols-2 lg:grid-cols-4"
        >
          {page.items.map((photo) => (
            <Panel key={photo.id} as="li">
              <PhotoCard
                locale={locale}
                photo={photo}
                administer={administer}
                servable={servable}
                copy={copy}
              />
            </Panel>
          ))}
        </ul>
      )}
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={photoHref(base, filter)}
        label={t('surface.photos')}
        copy={copy}
      />
    </main>
  );
}

export async function PhotoEditor({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const base = `/${locale}/admin/media/photos`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('media.administer');

  // A malformed identifier is the page's own 404, not an error boundary.
  const record = await mediaRuntime()
    .media.photo(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const [galleries, servable] = await Promise.all([
    mediaRuntime().media.photoGalleries(actor, record.id),
    servablePhotos([record]),
  ]);
  const name = photoName(record, locale, copy);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span {...(name.locale === null ? {} : { lang: name.locale })} dir="auto">
            {name.text}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          <Gaps photo={record} copy={copy} />
          <span>
            {t('version')}: {record.version}
          </span>
        </p>
      </div>

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="photo-image">
          <SectionHeading>
            <span id="photo-image">{t('photo.image')}</span>
          </SectionHeading>
          <AdminImage
            locale={locale}
            photo={record}
            administer={administer}
            servable={servable}
            copy={copy}
            large
          />
          {record.width === null || record.height === null ? null : (
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('photo.dimensionsShown', {
                width: String(record.width),
                height: String(record.height),
              })}
            </p>
          )}
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('photo.privacyNote')}
          </p>
          {administer ? (
            <PhotoUploader
              mode="replace"
              photoId={record.id}
              version={record.version}
              maxBytes={PHOTO_UPLOAD_MAX_BYTES}
              labels={uploaderLabels(copy, false)}
            />
          ) : null}
        </section>
      </Panel>

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('photo.edit')}</SectionHeading>
            <PhotoForm locale={locale} record={record} copy={copy} />
          </div>
        </Panel>
      ) : (
        <PhotoFacts locale={locale} record={record} copy={copy} />
      )}

      <section className="flex flex-col gap-3" aria-labelledby="photo-galleries">
        <SectionHeading>
          <span id="photo-galleries">{t('photo.galleries')}</span>
        </SectionHeading>
        {galleries.length === 0 ? (
          <EmptyState>{t('photo.galleriesNone')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {galleries.map((gallery) => (
              <li key={gallery.id} className="flex flex-wrap items-center gap-3">
                <TextLink href={`/${locale}/admin/media/galleries/${gallery.id}`}>
                  <Title record={gallery} locale={locale} />
                </TextLink>
                <StateBadge state={gallery.state} copy={copy} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** The recorded words, for a reader who may not change them. */
function PhotoFacts({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: PhotoRecord;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="photo-facts">
      <SectionHeading>
        <span id="photo-facts">{t('photo.words')}</span>
      </SectionHeading>
      {record.labels.length === 0 ? (
        <EmptyState>{t('photo.wordsNone')}</EmptyState>
      ) : (
        <dl className="flex flex-col gap-3 text-sm">
          {record.labels.map((label) => (
            <div key={label.locale} className="flex flex-col gap-1">
              <dt className="font-medium">{label.locale}</dt>
              <dd lang={label.locale} dir="auto">
                {label.altText ?? t('photo.altMissingShort')}
              </dd>
              {label.caption === null ? null : (
                <dd lang={label.locale} dir="auto">
                  {label.caption}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
      <p className="text-sm">
        {t('photo.credit')}: <span dir="auto">{record.credit ?? t('none')}</span>
      </p>
      <p className="text-sm">
        {t('photo.taken')}:{' '}
        {record.taken === null
          ? t('photo.takenUnknown')
          : partialDate(record.taken, locale).text}
      </p>
    </section>
  );
}

function PhotoForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: PhotoRecord;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, month - 1, 1)),
    );

  return (
    <ActionForm
      action={savePhoto}
      submitLabel={t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <EditIdentity locale={locale} record={record} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="photo-primary"
          label={t('primaryLocale')}
          help={t('primaryLocaleHelp')}
        >
          {(props) => (
            <Select {...props} name="primaryLocale" defaultValue={record.primaryLocale}>
              {localeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="photo-state" label={t('state')} help={t('photo.publishHelp')}>
          {(props) => (
            <Select {...props} name="state" defaultValue={record.state}>
              {mediaStateSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`stateName.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <SectionHeading>{t('photo.words')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('photo.wordsHelp')}
      </p>
      {localeSchema.options.map((language) => {
        const existing = record.labels.find((entry) => entry.locale === language);
        return (
          <Panel key={language}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`${language}-enabled`}
                  defaultChecked={existing !== undefined}
                  className="size-5"
                />
                {language}
              </label>
              <Field
                id={`photo-alt-${language}`}
                label={t('photo.altText')}
                help={t('photo.altTextHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`${language}-altText`}
                    defaultValue={existing?.altText ?? ''}
                    maxLength={PHOTO_LIMITS.altText}
                    rows={2}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
              <Field
                id={`photo-caption-${language}`}
                label={t('photo.caption')}
                help={t('photo.captionHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`${language}-caption`}
                    defaultValue={existing?.caption ?? ''}
                    maxLength={PHOTO_LIMITS.caption}
                    rows={3}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
            </div>
          </Panel>
        );
      })}

      <SectionHeading>{t('photo.facts')}</SectionHeading>
      <Field id="photo-credit" label={t('photo.credit')} help={t('photo.creditHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="credit"
            defaultValue={record.credit ?? ''}
            maxLength={PHOTO_LIMITS.credit}
            dir="auto"
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">{t('photo.taken')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('photo.takenHelp')}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="photo-year" label={t('photo.year')}>
            {(props) => (
              <TextInput
                {...props}
                name="takenYear"
                type="number"
                inputMode="numeric"
                min={PHOTO_LIMITS.earliestYear}
                max={9999}
                defaultValue={record.taken?.year ?? ''}
                dir="ltr"
              />
            )}
          </Field>
          <Field id="photo-month" label={t('photo.month')}>
            {(props) => (
              <Select
                {...props}
                name="takenMonth"
                defaultValue={record.taken?.month ?? ''}
              >
                <option value="">{t('photo.unknownPart')}</option>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {monthName(month)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="photo-day" label={t('photo.day')}>
            {(props) => (
              <TextInput
                {...props}
                name="takenDay"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                defaultValue={record.taken?.day ?? ''}
                dir="ltr"
              />
            )}
          </Field>
        </div>
      </fieldset>
    </ActionForm>
  );
}

/* ===========================================================================
 * Galleries
 * ========================================================================= */

function GalleryTable({
  locale,
  items,
  copy,
}: {
  readonly locale: Locale;
  readonly items: readonly GalleryRecord[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (items.length === 0) return <EmptyState>{t('empty')}</EmptyState>;
  return (
    <ul className="flex flex-col gap-3" aria-label={t('surface.galleries')}>
      {items.map((item) => (
        <Panel key={item.id} as="li">
          <p className="flex flex-wrap items-center gap-3">
            <TextLink href={`/${locale}/admin/media/galleries/${item.id}`}>
              <Title record={item} locale={locale} />
            </TextLink>
            <span className="text-sm text-[color:var(--color-foreground-muted)]">
              {item.slug}
            </span>
            <StateBadge state={item.state} copy={copy} />
            <span className="text-sm">
              {t('version')}: {item.version}
            </span>
          </p>
        </Panel>
      ))}
    </ul>
  );
}

function GalleryForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: GalleryRecord | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-gallery' : 'gallery';
  return (
    <ActionForm
      action={saveGallery}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <EditIdentity locale={locale} record={record} />
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('gallery.publishHelp')}
      </p>
      <LabelFields prefix={prefix} locale={locale} record={record} copy={copy} />
    </ActionForm>
  );
}

export async function GalleryDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/galleries`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const filter = directoryQuery(query);
  const page = await mediaRuntime().media.galleries(
    { accountId: context.session.account.id },
    filter,
  );

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.galleries')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('gallery.scope')}
      </p>
      <DirectoryFilter
        base={base}
        state={filter.state}
        text={filter.text ?? ''}
        copy={copy}
      />
      <GalleryTable locale={locale} items={page.items} copy={copy} />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.galleries')}
        copy={copy}
      />
      {context.authorization.can('media.administer') ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('gallery.create')}</SectionHeading>
            <GalleryForm locale={locale} record={null} copy={copy} />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

/** One named membership change, as its own small form. */
function ChangeForm({
  locale,
  gallery,
  photoId,
  op,
  direction,
  label,
  copy,
  tone = 'secondary',
}: {
  readonly locale: Locale;
  readonly gallery: GalleryDetail;
  readonly photoId: string;
  readonly op: 'remove' | 'move';
  readonly direction?: 'first' | 'earlier' | 'later' | 'last';
  readonly label: string;
  readonly copy: Copy;
  readonly tone?: 'secondary' | 'destructive';
}) {
  return (
    <ActionForm
      action={changeGallery}
      submitLabel={label}
      pendingLabel={copy.t('pending')}
      messages={copy.messages}
      tone={tone}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="galleryId" value={gallery.id} />
      <input type="hidden" name="version" value={String(gallery.version)} />
      <input type="hidden" name="photoId" value={photoId} />
      <input type="hidden" name="op" value={op} />
      {direction === undefined ? null : (
        <input type="hidden" name="direction" value={direction} />
      )}
    </ActionForm>
  );
}

export async function GalleryEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/media/galleries`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('media.administer');

  const record = await mediaRuntime()
    .media.gallery(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  // The picker: one page of Photos, narrowed by the same filters as the
  // directory, never offering one already in the Gallery.
  const pickFilter = {
    offset: pageOffset(query, MEDIA_PAGE),
    state: mediaStateSchema.safeParse(queryValue(query, 'state')).data ?? null,
    text: queryValue(query, 'text'),
    gap: null,
  } satisfies PhotoAdminQuery;
  const candidates = administer
    ? await mediaRuntime().media.photos(actor, pickFilter)
    : { items: [], hasMore: false };
  const members = new Set(record.photos.map((photo) => photo.id));
  const addable = candidates.items.filter((photo) => !members.has(photo.id));
  const servable = await servablePhotos([...record.photos, ...addable]);
  const label = mediaLabel(record, locale);
  const room = PHOTO_LIMITS.galleryPhotos - record.photos.length;
  const editorPath = `${base}/${record.id}`;

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span lang={label.locale} dir="auto">
            {label.title}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          <span>
            {t('version')}: {record.version}
          </span>
          {record.state === 'published' ? (
            <TextLink href={galleryPath(locale, record.slug)}>{t('viewPublic')}</TextLink>
          ) : null}
        </p>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="gallery-photos">
        <SectionHeading>
          <span id="gallery-photos">{t('gallery.photos')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('gallery.photosHelp', {
            count: String(record.photos.length),
            limit: String(PHOTO_LIMITS.galleryPhotos),
          })}
        </p>
        {record.photos.length === 0 ? (
          <EmptyState>{t('gallery.photosEmpty')}</EmptyState>
        ) : (
          <ol
            aria-labelledby="gallery-photos"
            className="grid grid-cols-1 gap-6 min-[400px]:grid-cols-2 lg:grid-cols-3"
          >
            {record.photos.map((photo, index) => (
              <Panel key={photo.id} as="li">
                <PhotoCard
                  locale={locale}
                  photo={photo}
                  administer={administer}
                  servable={servable}
                  copy={copy}
                >
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {index === 0
                      ? t('gallery.cover')
                      : t('gallery.position', { number: index + 1 })}
                  </p>
                  {administer ? (
                    <div className="flex flex-wrap gap-2">
                      {index === 0 ? null : (
                        <>
                          <ChangeForm
                            locale={locale}
                            gallery={record}
                            photoId={photo.id}
                            op="move"
                            direction="first"
                            label={t('gallery.moveFirst')}
                            copy={copy}
                          />
                          <ChangeForm
                            locale={locale}
                            gallery={record}
                            photoId={photo.id}
                            op="move"
                            direction="earlier"
                            label={t('gallery.moveEarlier')}
                            copy={copy}
                          />
                        </>
                      )}
                      {index === record.photos.length - 1 ? null : (
                        <>
                          <ChangeForm
                            locale={locale}
                            gallery={record}
                            photoId={photo.id}
                            op="move"
                            direction="later"
                            label={t('gallery.moveLater')}
                            copy={copy}
                          />
                          <ChangeForm
                            locale={locale}
                            gallery={record}
                            photoId={photo.id}
                            op="move"
                            direction="last"
                            label={t('gallery.moveLast')}
                            copy={copy}
                          />
                        </>
                      )}
                      <ChangeForm
                        locale={locale}
                        gallery={record}
                        photoId={photo.id}
                        op="remove"
                        label={t('gallery.remove')}
                        copy={copy}
                        tone="destructive"
                      />
                    </div>
                  ) : null}
                </PhotoCard>
              </Panel>
            ))}
          </ol>
        )}
      </section>

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('gallery.add')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('gallery.addHelp', { room: String(Math.max(0, room)) })}
            </p>
            <DirectoryFilter
              base={editorPath}
              state={pickFilter.state}
              text={pickFilter.text ?? ''}
              copy={copy}
              textLabel={t('photo.textFilter')}
            />
            {addable.length === 0 ? (
              <EmptyState>{t('gallery.addNone')}</EmptyState>
            ) : (
              <ActionForm
                action={changeGallery}
                submitLabel={t('gallery.addSubmit')}
                pendingLabel={t('pending')}
                messages={copy.messages}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="galleryId" value={record.id} />
                <input type="hidden" name="version" value={String(record.version)} />
                <input type="hidden" name="op" value="add" />
                <fieldset>
                  <legend className="sr-only">{t('gallery.add')}</legend>
                  <ul className="grid grid-cols-1 gap-6 min-[400px]:grid-cols-2 lg:grid-cols-4">
                    {addable.map((photo) => (
                      <li key={photo.id}>
                        <PhotoCard
                          locale={locale}
                          photo={photo}
                          administer={administer}
                          servable={servable}
                          copy={copy}
                        >
                          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                            <input
                              type="checkbox"
                              name="photoId"
                              value={photo.id}
                              className="size-5"
                            />
                            {t('gallery.choose')}
                          </label>
                        </PhotoCard>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              </ActionForm>
            )}
            <Pager
              offset={pickFilter.offset}
              hasMore={candidates.hasMore}
              hrefFor={directoryHref(editorPath, pickFilter)}
              label={t('gallery.add')}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('gallery.edit')}</SectionHeading>
            <GalleryForm locale={locale} record={record} copy={copy} />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}
