import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_PAGE,
  photoWords,
  type ArchiveMonth,
  type PhotoRecord,
  type PublicGallery,
} from '@minhaj/contracts/media';

import { servablePhotos } from '@/composition/media-assets';
import { mediaReadRuntime } from '@/composition/media-read';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import {
  Breadcrumbs,
  Container,
  EmptyState,
  FilterLink,
  PageHeading,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { BreadcrumbData, Pagination } from './parts';
import { PhotoViewer, type ViewerPhoto } from './photo-viewer';
import {
  archivePath,
  galleryPath,
  mediaLabel,
  mediaLocales,
  offsetPath,
  partialDate,
  photoAssetPath,
  readArchiveQuery,
  readOffset,
} from './presentation';

/**
 * The public photograph surfaces (ROUTE_MAP.md §3.9) — Phase 12.
 *
 *   `/media/photos`            every published photograph, recently added first
 *   `/media/galleries`         published galleries, each with a genuine cover
 *   `/media/galleries/{slug}`  one gallery's photographs, in its order
 *   `/media/archive`           the historical archive, by the date taken
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
 * (SECURITY_BASELINE.md §16.3).
 *
 * BOUNDED AND LAZY. One page of at most twenty-four photographs, in a stable
 * order; images below the first row load as they approach the screen, and
 * every image carries its real dimensions so nothing shifts as it arrives.
 */

type PhotosTranslator = Awaited<ReturnType<typeof getTranslations<'photos'>>>;

/** Home / … — the trail every photograph page starts with. */
async function photosTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
  };
}

function pages(t: PhotosTranslator) {
  return { previousLabel: t('previous'), nextLabel: t('next') };
}

/**
 * The three photograph surfaces, as a small navigation of their own — they
 * are reached from one another as well as from Watch and the sitemap.
 */
function PhotoSections({
  locale,
  current,
  t,
}: {
  readonly locale: Locale;
  readonly current: 'photos' | 'galleries' | 'archive';
  readonly t: PhotosTranslator;
}) {
  const sections = ['photos', 'galleries', 'archive'] as const;
  return (
    <nav aria-label={t('sectionsLabel')}>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {sections.map((section) => (
          <li key={section}>
            {section === current ? (
              <span aria-current="page" className="font-semibold">
                {t(`sections.${section}`)}
              </span>
            ) : (
              <TextLink href={`/${locale}/media/${section}`}>
                {t(`sections.${section}`)}
              </TextLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
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

/** Credit and date, as one line of recorded facts, or `null` when neither is known. */
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
                  <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] bg-[color:var(--color-surface-sunken)] p-4 text-center text-sm text-[color:var(--color-foreground-muted)]">
                    <PictureMark />
                    <span>{t('unavailable')}</span>
                  </div>
                ) : (
                  <a
                    href={photoAssetPath(photo.id, photo.assetId)}
                    data-photo-index={index}
                    className="relative block aspect-[4/3] overflow-hidden rounded-[var(--radius-panel)] bg-[color:var(--color-surface-sunken)]"
                  >
                    <img
                      src={photoAssetPath(photo.id, photo.assetId)}
                      alt={words.altText?.text ?? t('altMissing')}
                      {...(words.altText === null ? {} : { lang: words.altText.locale })}
                      width={photo.width ?? undefined}
                      height={photo.height ?? undefined}
                      loading={position < 4 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="size-full object-cover group-data-[unavailable]:hidden"
                    />
                    <span className="hidden size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-[color:var(--color-foreground-muted)] group-data-[unavailable]:flex">
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
                        className="text-xs break-words text-[color:var(--color-foreground-muted)]"
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

/* ===========================================================================
 * /media/photos
 * ========================================================================= */

export async function PhotosPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const trail = await photosTrail(locale);
  const offset = readOffset(query);
  const base = `/${locale}/media/photos`;
  const title = t('sections.photos');
  const page = await mediaReadRuntime().photos(offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('sectionBody.photos')}</p>
        </Prose>
        <PhotoSections locale={locale} current="photos" t={t} />
        {page.items.length === 0 ? (
          <EmptyState>{offset > 0 ? t('pageEmpty') : t('photosEmpty')}</EmptyState>
        ) : (
          <PhotoGrid locale={locale} photos={page.items} label={title} />
        )}
        <Pagination
          label={title}
          previous={
            offset > 0 ? offsetPath(base, Math.max(0, offset - MEDIA_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(base, offset + MEDIA_PAGE) : null}
          {...pages(t)}
        />
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
}: {
  readonly locale: Locale;
  readonly gallery: PublicGallery;
  readonly cover: boolean;
  readonly t: PhotosTranslator;
}) {
  const label = mediaLabel(gallery, locale);
  const direction = directionOf(label.locale);
  const photo = gallery.cover;
  const words = photo === null ? null : photoWords(photo, locale);

  return (
    <li className="relative flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] shadow-[var(--shadow-panel)]">
      {cover && photo !== null && photo.assetId !== null ? (
        <img
          src={photoAssetPath(photo.id, photo.assetId)}
          alt={words?.altText?.text ?? t('altMissing')}
          {...(words?.altText == null ? {} : { lang: words.altText.locale })}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full bg-[color:var(--color-surface-sunken)] object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-[color:var(--color-surface-sunken)] text-sm text-[color:var(--color-foreground-muted)]">
          <PictureMark />
          <span>{t('coverUnavailable')}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2 p-5">
        <h2
          className="text-lg font-semibold break-words"
          lang={label.locale}
          dir={direction}
        >
          <a
            href={galleryPath(locale, gallery.slug)}
            className="underline-offset-2 after:absolute after:inset-0 hover:underline"
          >
            {label.title}
          </a>
        </h2>
        {label.description === '' ? null : (
          <p
            className="line-clamp-3 text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={label.locale}
            dir={direction}
          >
            {label.description}
          </p>
        )}
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('count', { count: gallery.photoCount })}
        </p>
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
}: {
  readonly locale: Locale;
  readonly galleries: readonly PublicGallery[];
  readonly label: string;
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
        />
      ))}
    </ul>
  );
}

export async function GalleriesPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const trail = await photosTrail(locale);
  const offset = readOffset(query);
  const base = `/${locale}/media/galleries`;
  const title = t('sections.galleries');
  const page = await mediaReadRuntime().galleries(offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('sectionBody.galleries')}</p>
        </Prose>
        <PhotoSections locale={locale} current="galleries" t={t} />
        {page.items.length === 0 ? (
          <EmptyState>{offset > 0 ? t('pageEmpty') : t('galleriesEmpty')}</EmptyState>
        ) : (
          <GalleryCardGrid locale={locale} galleries={page.items} label={title} />
        )}
        <Pagination
          label={title}
          previous={
            offset > 0 ? offsetPath(base, Math.max(0, offset - MEDIA_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(base, offset + MEDIA_PAGE) : null}
          {...pages(t)}
        />
      </div>
    </Container>
  );
}

/**
 * One Gallery: its title and description, then its public photographs in the
 * Gallery's own order, in bounded pages. A published Gallery none of whose
 * photographs is public says so honestly.
 */
export async function GalleryDetailPage({
  locale,
  gallery,
  query,
}: {
  readonly locale: Locale;
  readonly gallery: PublicGallery;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const parts = await photosTrail(locale);
  const offset = readOffset(query);
  const path = galleryPath(locale, gallery.slug);
  const photos = await mediaReadRuntime().galleryPhotos(gallery.id, offset);
  const label = mediaLabel(gallery, locale);
  const direction = directionOf(label.locale);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: t('sections.galleries'), path: `/${locale}/media/galleries` },
    { name: label.title, path },
  ];

  return (
    <Container>
      <article className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={parts.label}
          trail={[
            ...trail
              .slice(0, -1)
              .map((entry) => ({ href: entry.path, text: entry.name })),
            { text: label.title },
          ]}
        />
        <Prose>
          <h1
            className="text-3xl font-semibold tracking-tight break-words"
            lang={label.locale}
            dir={direction}
          >
            {label.title}
          </h1>
          {paragraphsOf(label.description).map((paragraph, index) => (
            <p key={index} lang={label.locale} dir={direction}>
              {paragraph}
            </p>
          ))}
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('count', { count: gallery.photoCount })}
          </p>
        </Prose>

        <section className="flex flex-col gap-4" aria-labelledby="gallery-photos">
          <SectionHeading>
            <span id="gallery-photos">{t('galleryPhotos')}</span>
          </SectionHeading>
          {photos.items.length === 0 ? (
            <EmptyState>{offset > 0 ? t('pageEmpty') : t('galleryEmpty')}</EmptyState>
          ) : (
            <PhotoGrid locale={locale} photos={photos.items} label={t('galleryPhotos')} />
          )}
          <Pagination
            label={t('galleryPhotos')}
            previous={
              offset > 0 ? offsetPath(path, Math.max(0, offset - MEDIA_PAGE)) : null
            }
            next={photos.hasMore ? offsetPath(path, offset + MEDIA_PAGE) : null}
            {...pages(t)}
          />
        </section>

        <BreadcrumbData
          contentLocales={gallery.photoCount > 0 ? mediaLocales(gallery) : []}
          trail={trail}
        />
      </article>
    </Container>
  );
}

/* ===========================================================================
 * /media/archive
 * ========================================================================= */

function monthName(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

function yearText(year: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, 0, 1)),
  );
}

/**
 * The historical archive: published photographs whose date is KNOWN, latest
 * first, browsed by year and then by month. A photograph with no known date is
 * never placed here — its record's creation time is not its history — and one
 * known only to a year stays a year.
 */
export async function ArchivePage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const trail = await photosTrail(locale);
  const filter = readArchiveQuery(query);
  const title = t('sections.archive');
  const reads = mediaReadRuntime();

  const [years, months, page] = await Promise.all([
    reads.archiveYears(),
    filter.year === null
      ? Promise.resolve([] as readonly ArchiveMonth[])
      : reads.archiveMonths(filter.year),
    reads.archivePhotos(filter),
  ]);

  const heading =
    filter.year === null
      ? t('archiveAll')
      : filter.month === null
        ? t('archiveYear', { year: yearText(filter.year, locale) })
        : t('archiveMonth', {
            month: monthName(filter.month, locale),
            year: yearText(filter.year, locale),
          });

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t('sectionBody.archive')}</p>
        </Prose>
        <PhotoSections locale={locale} current="archive" t={t} />

        {years.length === 0 ? (
          <EmptyState>{t('archiveEmpty')}</EmptyState>
        ) : (
          <>
            <nav aria-label={t('archiveYears')} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">{t('archiveYears')}</h2>
              <ul className="flex flex-wrap gap-2">
                <li>
                  <FilterLink
                    href={archivePath(locale, { year: null, month: null })}
                    current={filter.year === null}
                  >
                    {t('archiveEveryYear')}
                  </FilterLink>
                </li>
                {years.map((entry) => (
                  <li key={entry.year}>
                    <FilterLink
                      href={archivePath(locale, { year: entry.year, month: null })}
                      current={filter.year === entry.year && filter.month === null}
                      partial={filter.year === entry.year && filter.month !== null}
                    >
                      {yearText(entry.year, locale)}
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {' '}
                        ({t('countShort', { count: entry.photos })})
                      </span>
                    </FilterLink>
                  </li>
                ))}
              </ul>
            </nav>

            {filter.year === null || months.length === 0 ? null : (
              <nav aria-label={t('archiveMonths')} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">{t('archiveMonths')}</h2>
                <ul className="flex flex-wrap gap-2">
                  {months.map((entry) => (
                    <li key={entry.month}>
                      <FilterLink
                        href={archivePath(locale, {
                          year: filter.year,
                          month: entry.month,
                        })}
                        current={filter.month === entry.month}
                      >
                        {monthName(entry.month, locale)}
                        <span className="text-[color:var(--color-foreground-muted)]">
                          {' '}
                          ({t('countShort', { count: entry.photos })})
                        </span>
                      </FilterLink>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <section className="flex flex-col gap-4" aria-labelledby="archive-photos">
              <SectionHeading>
                <span id="archive-photos">{heading}</span>
              </SectionHeading>
              {page.items.length === 0 ? (
                <EmptyState>
                  <span className="flex flex-col gap-2">
                    <span>{t('archiveFilteredEmpty')}</span>
                    <TextLink href={archivePath(locale, { year: null, month: null })}>
                      {t('archiveEveryYear')}
                    </TextLink>
                  </span>
                </EmptyState>
              ) : (
                <PhotoGrid locale={locale} photos={page.items} label={heading} />
              )}
              <Pagination
                label={heading}
                previous={
                  filter.offset > 0
                    ? archivePath(locale, filter, Math.max(0, filter.offset - MEDIA_PAGE))
                    : null
                }
                next={
                  page.hasMore
                    ? archivePath(locale, filter, filter.offset + MEDIA_PAGE)
                    : null
                }
                {...pages(t)}
              />
            </section>
          </>
        )}
      </div>
    </Container>
  );
}
