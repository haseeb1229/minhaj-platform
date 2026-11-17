import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  GALLERY_DIRECTORY_PAGE,
  PHOTO_LISTING_PAGE,
  photoWords,
  type PhotoListingFacets,
  type PhotoRecord,
  type PublicGallery,
} from '@minhaj/contracts/media';

import { servablePhotos } from '@/composition/media-assets';
import { mediaReadRuntime } from '@/composition/media-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { RangeSummary } from '@/components/library/browse-parts';
import { caseless, pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  CountedSelect,
  ExploreFilters,
  ExploreHero,
  languageName,
} from '@/components/topic-hub/parts';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  MetaRow,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import { derivativeSrcSet } from '@/components/ui/image-derivatives';
import { directionOf } from '@/config/locale';
import { BreadcrumbData, MEDIA_CARD, MEDIA_CARD_LINK, MediaPageHeader } from './parts';
import { PhotoViewer, type ViewerPhoto } from './photo-viewer';
import {
  galleriesHref,
  galleryPageHref,
  photosFiltered,
  photosHref,
  photosListingHref,
  photosReadQuery,
  galleriesReadQuery,
  type GalleriesView,
  type PhotosView,
} from './photos-view';
import {
  galleryPath,
  gallerySpanText,
  mediaLabel,
  mediaLocales,
  partialDate,
  photoAssetPath,
} from './presentation';

/**
 * The public photograph surfaces (ROUTE_MAP.md §3.9) — Phase 12; rebuilt in
 * News & Events Part 2.
 *
 *   `/media/photos`            every published photograph, with counted
 *                              filters (year and month taken, gallery,
 *                              language), three orders and numbered pages
 *   `/media/galleries`         the listed galleries, each with its genuine
 *                              cover, count and span of dates
 *   `/media/galleries/{slug}`  one gallery's photographs, in its order
 *   `/media/archive`           the index of years and months taken
 *                              (`./photo-archive`)
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/media-read` and `@/composition/media-assets`, neither of which
 * reaches Identity, a session or a cookie. The one client island is the viewer.
 *
 * REAL PICTURES, AND ONLY REAL ONES. Every image is a genuine published Photo
 * served first-party through its two-allow route; nothing is a stock picture,
 * a generated image or a placeholder dressed as content. A Photo whose bytes
 * Storage cannot serve right now is shown as unavailable in words, never as a
 * broken image box, and never silently unpublished.
 *
 * WORDS ARE NEVER INVENTED. Alternative text, captions, credits and dates are
 * shown exactly as recorded, each marked with the language it is in. Where a
 * Photo has no alternative text the image says so plainly — it is not passed
 * off as decorative, and nothing is derived from a filename or the pixels
 * (SECURITY_BASELINE.md §16.3). A Gallery's date is only the span of its
 * photographs' recorded dates. No download is offered: none is authorised.
 *
 * BOUNDED AND LAZY. One page of at most twenty-four photographs, in a stable
 * order; images below the first row load as they approach the screen, and
 * every image carries its real dimensions so nothing shifts as it arrives.
 */

export type PhotosTranslator = Awaited<ReturnType<typeof getTranslations<'photos'>>>;

/** Home / News and Events / … — the trail every photograph page starts with. */
export async function photosTrail(locale: Locale) {
  const [shell, news] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'news' }),
  ]);
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    news: { href: localizedPath(locale, '/news'), text: news('title') },
  };
}

export function monthName(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

export function yearText(year: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, 0, 1)),
  );
}

/**
 * The three photograph surfaces as counted tabs: every photograph, the
 * listed galleries and the dated photographs the archive indexes. Each tab is
 * its surface's own unfiltered address.
 */
export function MediaTabs({
  locale,
  current,
  all,
  t,
}: {
  readonly locale: Locale;
  readonly current: 'photos' | 'galleries' | 'archive';
  readonly all: PhotoListingFacets['all'];
  readonly t: PhotosTranslator;
}) {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const counts = { photos: all.photos, galleries: all.galleries, archive: all.dated };
  return (
    <LinkTabs
      label={t('sectionsLabel')}
      tabs={(['photos', 'galleries', 'archive'] as const).map((section) => ({
        href: localizedPath(locale, `/media/${section}`),
        text: t(`sections.${section}`),
        current: section === current,
        count: number(counts[section]),
      }))}
    />
  );
}

/** What may and may not be done with the photographs — only what is decided. */
export function RightsNote({ t }: { readonly t: PhotosTranslator }) {
  return (
    <p className="flex max-w-[var(--measure-prose)] items-start gap-2 border-t border-border pt-4 text-sm text-foreground-muted">
      <Icon name="info" size={16} className="mt-[0.2em] shrink-0 text-accent" />
      <span>{t('rights')}</span>
    </p>
  );
}

/**
 * R2. A tile's WebP derivatives — a grid column of a third to a half of the
 * page — or nothing when the Photo's width is unknown. The lightbox keeps the
 * original: a visitor who enlarges a picture asked for every pixel.
 */
function photoSrcSet(
  path: string,
  width: number | null,
): { srcSet?: string; sizes?: string } {
  const srcSet = derivativeSrcSet(path, width);
  return srcSet === undefined
    ? {}
    : { srcSet, sizes: '(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw' };
}

/** The first-party picture mark, decorative, where no picture can be shown. */
function PictureMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-8"
      fill="none"
      stroke="currentColor"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" strokeWidth="1.5" />
      <circle cx="9" cy="10" r="1.75" strokeWidth="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Date and credit, as one line of recorded facts, or `null` when neither is known. */
function detailsOf(
  photo: PhotoRecord,
  locale: Locale,
  t: PhotosTranslator,
): string | null {
  const parts = [
    photo.taken === null ? null : partialDate(photo.taken, locale).text,
    photo.credit === null ? null : t('credit', { name: photo.credit }),
  ].filter((entry): entry is string => entry !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * A page of photographs: a responsive grid of real images, each opening the
 * enlarged view, with every photograph's servability asked of Storage ONCE for
 * the whole page.
 */
async function PhotoGrid({
  locale,
  photos,
  label,
}: {
  readonly locale: Locale;
  readonly photos: readonly PhotoRecord[];
  readonly label: string;
}) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const servable = await servablePhotos(photos);

  const shown = photos.map((photo) => {
    const words = photoWords(photo, locale);
    const ready =
      servable.has(photo.id) &&
      photo.assetId !== null &&
      photo.width !== null &&
      photo.height !== null;
    return { photo, words, ready };
  });

  const viewer: ViewerPhoto[] = [];
  const indexOf = new Map<string, number>();
  for (const { photo, words, ready } of shown) {
    if (!ready || photo.assetId === null || photo.width === null || photo.height === null)
      continue;
    indexOf.set(photo.id, viewer.length);
    viewer.push({
      src: photoAssetPath(photo.id, photo.assetId),
      width: photo.width,
      height: photo.height,
      alt: words.altText?.text ?? t('altMissing'),
      altLang: words.altText?.locale ?? null,
      caption: words.caption?.text ?? null,
      captionLang: words.caption?.locale ?? null,
      details: detailsOf(photo, locale, t),
    });
  }

  return (
    <PhotoViewer
      photos={viewer}
      labels={{
        dialog: t('viewer.dialog'),
        close: t('viewer.close'),
        previous: t('viewer.previous'),
        next: t('viewer.next'),
        position: t('viewer.position', { position: '{position}', total: '{total}' }),
      }}
    >
      <ul
        aria-label={label}
        className="grid grid-cols-1 gap-6 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {shown.map(({ photo, words }, position) => {
          const index = indexOf.get(photo.id);
          const details = detailsOf(photo, locale, t);
          return (
            <li key={photo.id}>
              <figure data-photo-tile className="group flex min-w-0 flex-col gap-2">
                {index === undefined || photo.assetId === null ? (
                  <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-panel bg-surface-sunken p-4 text-center text-sm text-foreground-muted">
                    <PictureMark />
                    <span>{t('unavailable')}</span>
                  </div>
                ) : (
                  <a
                    href={photoAssetPath(photo.id, photo.assetId)}
                    data-photo-index={index}
                    className="relative block aspect-[4/3] overflow-hidden rounded-panel bg-surface-sunken"
                  >
                    <img
                      src={photoAssetPath(photo.id, photo.assetId)}
                      {...photoSrcSet(
                        photoAssetPath(photo.id, photo.assetId),
                        photo.width,
                      )}
                      alt={words.altText?.text ?? t('altMissing')}
                      {...(words.altText === null ? {} : { lang: words.altText.locale })}
                      width={photo.width ?? undefined}
                      height={photo.height ?? undefined}
                      loading={position < 4 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="size-full object-cover transition-transform duration-[var(--duration-fast)] group-hover:scale-[1.02] group-data-[unavailable]:hidden motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                    <span className="hidden size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-foreground-muted group-data-[unavailable]:flex">
                      <PictureMark />
                      {t('unavailable')}
                    </span>
                    <span className="sr-only">{t('enlarge')}</span>
                  </a>
                )}
                {words.caption === null && details === null ? null : (
                  <figcaption className="flex min-w-0 flex-col gap-1">
                    {words.caption === null ? null : (
                      <span
                        className="line-clamp-3 text-sm break-words"
                        lang={words.caption.locale}
                        dir={directionOf(words.caption.locale)}
                      >
                        {words.caption.text}
                      </span>
                    )}
                    {details === null ? null : (
                      <span
                        className="text-xs break-words text-foreground-muted"
                        dir="auto"
                      >
                        {details}
                      </span>
                    )}
                  </figcaption>
                )}
              </figure>
            </li>
          );
        })}
      </ul>
    </PhotoViewer>
  );
}

/** The figures every surface opens with: how many, the years taken, galleries, languages. */
function heroStats(
  locale: Locale,
  all: PhotoListingFacets['all'],
  t: PhotosTranslator,
  focus: 'photos' | 'galleries' | 'archive',
  listId: string,
) {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const span =
    all.firstYear === null || all.lastYear === null
      ? null
      : {
          value:
            all.firstYear === all.lastYear
              ? yearText(all.firstYear, locale)
              : `${yearText(all.firstYear, locale)}–${yearText(all.lastYear, locale)}`,
          label: t('stats.span', { count: all.lastYear - all.firstYear + 1 }),
        };
  const photos =
    all.photos === 0
      ? []
      : [
          {
            value: number(all.photos),
            label: t('stats.photos', { count: all.photos }),
            ...(focus === 'photos' ? { href: `#${listId}` } : {}),
          },
        ];
  const galleries =
    all.galleries === 0
      ? []
      : [
          {
            value: number(all.galleries),
            label: t('stats.galleries', { count: all.galleries }),
            ...(focus === 'galleries' ? { href: `#${listId}` } : {}),
          },
        ];
  if (focus === 'galleries')
    return [
      ...galleries,
      ...(all.inGalleries === 0
        ? []
        : [
            {
              value: number(all.inGalleries),
              label: t('stats.inGalleries', { count: all.inGalleries }),
            },
          ]),
    ];
  if (focus === 'archive')
    return [
      ...(all.dated === 0
        ? []
        : [{ value: number(all.dated), label: t('stats.dated', { count: all.dated }) }]),
      ...(span === null ? [] : [span]),
    ];
  return [
    ...photos,
    ...(span === null ? [] : [span]),
    ...galleries,
    ...(all.languages < 2
      ? []
      : [
          {
            value: number(all.languages),
            label: t('stats.languages', { count: all.languages }),
          },
        ]),
  ];
}

/* ===========================================================================
 * /media/photos
 * ========================================================================= */

export async function PhotosPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: PhotosView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'photos' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    photosTrail(locale),
  ]);
  const reads = mediaReadRuntime();
  const query = photosReadQuery(view);
  const [page, facets] = await Promise.all([
    reads.photoListing(query),
    reads.photoListingFacets(query),
  ]);
  // An address carries an identifier in lower case, while Media returns it as
  // stored: options and chips compare without case.
  const galleries = caseless(
    new Map(facets.galleries.items.map((entry) => [entry.id, entry])),
  );
  // A chosen Gallery none of whose photographs the other filters admit is not
  // among the counted options; it is still named — asked of Media, listed
  // Galleries only — and offered with the nothing it would show.
  const [chosenListed] =
    view.gallery === null || galleries.has(view.gallery.toLowerCase())
      ? []
      : await reads.publicGalleries([view.gallery]);
  const galleryOptions =
    chosenListed === undefined
      ? facets.galleries.items
      : [...facets.galleries.items, { ...chosenListed, photos: 0 }];
  const chosenGallery =
    view.gallery === null
      ? null
      : (galleries.get(view.gallery.toLowerCase()) ?? chosenListed ?? null);

  const title = t('sections.photos');
  const listId = 'photos-list';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const href = (change: Partial<PhotosView>) => photosHref(locale, view, change);
  const filtered = photosFiltered(view);
  // Clearing the filters keeps the order: it is not a narrowing.
  const base = photosListingHref(locale, { sort: view.sort });
  const pages = pageCount(page.total, PHOTO_LISTING_PAGE);
  const range = pageRange(view.page, page.items.length, PHOTO_LISTING_PAGE);
  const option = (name: string, count: number) => hub('common.option', { name, count });

  const chip = (key: string, text: string, removeHref: string, auto = false) => ({
    key,
    text: auto ? <span dir="auto">{text}</span> : text,
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });
  const active = [
    ...(view.year === null
      ? []
      : [chip('year', yearText(view.year, locale), href({ year: null, month: null }))]),
    ...(view.year === null || view.month === null
      ? []
      : [chip('month', monthName(view.month, locale), href({ month: null }))]),
    ...(view.gallery === null
      ? []
      : [
          chip(
            'gallery',
            chosenGallery === null
              ? t('listing.unknownGallery')
              : mediaLabel(chosenGallery, locale).title,
            href({ gallery: null }),
            true,
          ),
        ]),
    ...(view.language === null
      ? []
      : [
          chip('language', languageName(view.language, locale), href({ language: null })),
        ]),
  ];
  const heading =
    view.year === null
      ? t('listing.heading')
      : view.month === null
        ? t('archiveYear', { year: yearText(view.year, locale) })
        : t('archiveMonth', {
            month: monthName(view.month, locale),
            year: yearText(view.year, locale),
          });

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.news, { text: title }]}
        />
        <ExploreHero
          eyebrow={trail.news.text}
          title={title}
          lede={t('sectionBody.photos')}
          stats={heroStats(locale, facets.all, t, 'photos', listId)}
          actions={[]}
        />
        <MediaTabs locale={locale} current="photos" all={facets.all} t={t} />

        {facets.all.photos === 0 ? (
          <EmptyState
            icon="grid"
            title={t('listing.emptyTitle')}
            action={{ href: trail.news.href, text: t('listing.backToNews') }}
          >
            {t('photosEmpty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-5">
            <SectionHeader id={listId} heading={heading} intro={t('listing.intro')} />

            <ExploreFilters
              action={localizedPath(locale, '/media/photos')}
              label={t('listing.filters')}
              hidden={[]}
              submit={t('listing.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              {facets.years.length > 1 || view.year !== null ? (
                <CountedSelect
                  id={`${listId}-year`}
                  label={t('listing.filterYear')}
                  name="year"
                  value={view.year === null ? '' : String(view.year)}
                  any={t('listing.anyYear')}
                  options={facets.years.map((entry) => ({
                    value: String(entry.year),
                    name: yearText(entry.year, locale),
                    count: entry.photos,
                  }))}
                  optionText={option}
                />
              ) : null}
              {view.year === null ||
              (facets.months.length < 2 && view.month === null) ? null : (
                <CountedSelect
                  id={`${listId}-month`}
                  label={t('listing.filterMonth')}
                  name="month"
                  value={view.month === null ? '' : String(view.month)}
                  any={t('listing.anyMonth')}
                  options={facets.months.map((entry) => ({
                    value: String(entry.month),
                    name: monthName(entry.month, locale),
                    count: entry.photos,
                  }))}
                  optionText={option}
                />
              )}
              {galleryOptions.length > 0 || view.gallery !== null ? (
                <CountedSelect
                  id={`${listId}-gallery`}
                  label={t('listing.filterGallery')}
                  name="gallery"
                  value={view.gallery ?? ''}
                  any={t('listing.anyGallery')}
                  options={galleryOptions.map((entry) => {
                    const words = mediaLabel(entry, locale);
                    return {
                      value: entry.id.toLowerCase(),
                      name: words.title,
                      count: entry.photos,
                      lang: words.locale,
                    };
                  })}
                  optionText={option}
                />
              ) : null}
              {facets.languages.length > 1 || view.language !== null ? (
                <CountedSelect
                  id={`${listId}-language`}
                  label={t('listing.filterLanguage')}
                  name="language"
                  value={view.language ?? ''}
                  any={t('listing.anyLanguage')}
                  options={facets.languages.map((entry) => ({
                    value: entry.code,
                    name: languageName(entry.code, locale),
                    count: entry.photos,
                  }))}
                  optionText={option}
                />
              ) : null}
              <Field id={`${listId}-sort`} label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="added">{t('listing.sort.added')}</option>
                    <option value="newest">{t('listing.sort.newest')}</option>
                    <option value="oldest">{t('listing.sort.oldest')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {chosenGallery === null ? null : (
              <p className="text-sm">
                <a
                  href={galleryPath(locale, chosenGallery.slug)}
                  className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {t('listing.openGallery')}
                  <Icon name="arrow-end" size={16} />
                </a>
              </p>
            )}

            {range === null ? null : (
              <RangeSummary>
                {t('listing.summary', {
                  from: number(range.from),
                  to: number(range.to),
                  total: page.total,
                })}
              </RangeSummary>
            )}

            {page.items.length === 0 ? (
              view.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
                >
                  {t('listing.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('listing.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('listing.noResults')}
                </EmptyState>
              )
            ) : (
              <PhotoGrid locale={locale} photos={page.items} label={heading} />
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('listing.pages')}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={page.hasMore ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            )}
          </section>
        )}

        <RightsNote t={t} />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /media/galleries and /media/galleries/{slug}
 * ========================================================================= */

function GalleryCard({
  locale,
  gallery,
  cover,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly gallery: PublicGallery;
  readonly cover: boolean;
  readonly t: PhotosTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const label = mediaLabel(gallery, locale);
  const direction = directionOf(label.locale);
  const photo = gallery.cover;
  const words = photo === null ? null : photoWords(photo, locale);
  const Heading = headingLevel;

  return (
    <li className={MEDIA_CARD}>
      {cover && photo !== null && photo.assetId !== null ? (
        <img
          src={photoAssetPath(photo.id, photo.assetId)}
          {...photoSrcSet(photoAssetPath(photo.id, photo.assetId), photo.width)}
          alt={words?.altText?.text ?? t('altMissing')}
          {...(words?.altText == null ? {} : { lang: words.altText.locale })}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full bg-surface-sunken object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-surface-sunken text-sm text-foreground-muted">
          <PictureMark />
          <span>{t('coverUnavailable')}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-5">
        <Heading
          className="text-subheading font-semibold wrap-anywhere"
          lang={label.locale}
          dir={direction}
        >
          <a href={galleryPath(locale, gallery.slug)} className={MEDIA_CARD_LINK}>
            {label.title}
          </a>
        </Heading>
        {label.description === '' ? null : (
          <p
            className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
            lang={label.locale}
            dir={direction}
          >
            {label.description}
          </p>
        )}
        <div className="mt-auto pt-1">
          <MetaRow
            items={[
              t('count', { count: gallery.photoCount }),
              gallery.span === null ? null : gallerySpanText(gallery.span, locale),
            ]}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * A grid of Gallery cards, each linking to the Gallery's own canonical page,
 * with only the covers Storage can serve shown as images. What another page
 * composes when it lists Galleries it does not own — an Event's gallery view
 * (Phase 14) — so the Gallery is always presented as Media presents it.
 */
export async function GalleryCardGrid({
  locale,
  galleries,
  label,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly galleries: readonly PublicGallery[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const covers = await servablePhotos(
    galleries.flatMap((gallery) => (gallery.cover === null ? [] : [gallery.cover])),
  );
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {galleries.map((gallery) => (
        <GalleryCard
          key={gallery.id}
          locale={locale}
          gallery={gallery}
          cover={gallery.cover !== null && covers.has(gallery.cover.id)}
          t={t}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  );
}

export async function GalleriesPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: GalleriesView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'photos' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    photosTrail(locale),
  ]);
  const reads = mediaReadRuntime();
  const [page, facets] = await Promise.all([
    reads.galleryDirectory(galleriesReadQuery(view, locale)),
    reads.photoListingFacets({}),
  ]);
  const title = t('sections.galleries');
  const listId = 'galleries-list';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const href = (change: Partial<GalleriesView>) => galleriesHref(locale, view, change);
  const pages = pageCount(page.total, GALLERY_DIRECTORY_PAGE);
  const range = pageRange(view.page, page.items.length, GALLERY_DIRECTORY_PAGE);

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.news, { text: title }]}
        />
        <ExploreHero
          eyebrow={trail.news.text}
          title={title}
          lede={t('sectionBody.galleries')}
          stats={heroStats(locale, facets.all, t, 'galleries', listId)}
          actions={[]}
        />
        <MediaTabs locale={locale} current="galleries" all={facets.all} t={t} />

        {page.total === 0 ? (
          <EmptyState
            icon="grid"
            title={t('galleriesPage.emptyTitle')}
            action={{ href: trail.news.href, text: t('listing.backToNews') }}
          >
            {t('galleriesEmpty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('galleriesPage.heading')}
              intro={t('galleriesPage.intro')}
            />
            <ExploreFilters
              action={localizedPath(locale, '/media/galleries')}
              label={t('galleriesPage.order')}
              hidden={[]}
              submit={t('galleriesPage.apply')}
              reset={null}
            >
              <Field id={`${listId}-sort`} label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="newest">{t('galleriesPage.sort.newest')}</option>
                    <option value="oldest">{t('galleriesPage.sort.oldest')}</option>
                    <option value="title">{t('galleriesPage.sort.title')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            {range === null ? null : (
              <RangeSummary>
                {t('galleriesPage.summary', {
                  from: number(range.from),
                  to: number(range.to),
                  total: page.total,
                })}
              </RangeSummary>
            )}

            {page.items.length === 0 ? (
              <EmptyState
                title={hub('common.pastEndTitle')}
                action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
              >
                {t('galleriesPage.pastEnd', { page: view.page })}
              </EmptyState>
            ) : (
              <GalleryCardGrid
                locale={locale}
                galleries={page.items}
                label={t('galleriesPage.heading')}
              />
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('galleriesPage.pages')}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={page.hasMore ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            )}
          </section>
        )}

        <RightsNote t={t} />
      </div>
    </Container>
  );
}

/**
 * One Gallery: its title, count, span of dates and description, then its
 * public photographs in the Gallery's own order, in numbered pages. A
 * published Gallery none of whose photographs is public says so honestly.
 */
export async function GalleryDetailPage({
  locale,
  gallery,
  page,
}: {
  readonly locale: Locale;
  readonly gallery: PublicGallery;
  readonly page: number;
}) {
  const [t, hub, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'photos' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    photosTrail(locale),
  ]);
  const photos = await mediaReadRuntime().galleryPhotos(
    gallery.id,
    (page - 1) * PHOTO_LISTING_PAGE,
  );
  const path = galleryPath(locale, gallery.slug);
  const label = mediaLabel(gallery, locale);
  const direction = directionOf(label.locale);
  const galleriesHome = localizedPath(locale, '/media/galleries');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.news.text, path: parts.news.href },
    { name: t('sections.galleries'), path: galleriesHome },
    { name: label.title, path },
  ];
  const description = paragraphsOf(label.description);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const pages = pageCount(gallery.photoCount, PHOTO_LISTING_PAGE);
  const range = pageRange(page, photos.items.length, PHOTO_LISTING_PAGE);
  const pageHref = (target: number) => galleryPageHref(locale, gallery.slug, target);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: parts.label,
            trail: [
              ...trail
                .slice(0, -1)
                .map((entry) => ({ href: entry.path, text: entry.name })),
              { text: label.title },
            ],
          }}
          eyebrow={t('galleryEyebrow')}
          title={label.title}
          lang={label.locale}
          dir={direction}
          meta={
            <MetaRow
              items={[
                t('count', { count: gallery.photoCount }),
                gallery.span === null ? null : gallerySpanText(gallery.span, locale),
              ]}
            />
          }
        >
          {description.length === 0 ? null : (
            <div className="flex max-w-[var(--measure-prose)] flex-col gap-3 pt-1">
              {description.map((paragraph, index) => (
                <p key={index} lang={label.locale} dir={direction}>
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </MediaPageHeader>

        <section className="flex flex-col gap-5" aria-labelledby="gallery-photos">
          <SectionHeader
            id="gallery-photos"
            heading={t('galleryPhotos')}
            intro={gallery.photoCount > 0 ? t('galleryIntro') : undefined}
          />
          {range === null || pages < 2 ? null : (
            <RangeSummary>
              {t('listing.summary', {
                from: number(range.from),
                to: number(range.to),
                total: gallery.photoCount,
              })}
            </RangeSummary>
          )}
          {photos.items.length === 0 ? (
            page > 1 && gallery.photoCount > 0 ? (
              <EmptyState
                title={hub('common.pastEndTitle')}
                action={{ href: pageHref(1), text: hub('common.firstPage') }}
              >
                {t('listing.pastEnd', { page })}
              </EmptyState>
            ) : (
              <EmptyState>{t('galleryEmpty')}</EmptyState>
            )
          ) : (
            <PhotoGrid locale={locale} photos={photos.items} label={t('galleryPhotos')} />
          )}
          {photos.items.length === 0 ? null : (
            <Pager
              label={t('listing.pages')}
              previous={page > 1 ? pageHref(page - 1) : null}
              next={photos.hasMore ? pageHref(page + 1) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
              pages={{
                current: page,
                total: pages,
                href: pageHref,
                label: (target) => hub('common.pageLabel', { page: target }),
                format: number,
              }}
            />
          )}
        </section>

        <RightsNote t={t} />

        <BreadcrumbData
          contentLocales={gallery.photoCount > 0 ? mediaLocales(gallery) : []}
          trail={trail}
        />
      </article>
    </Container>
  );
}
