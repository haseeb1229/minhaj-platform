import { describe, expect, it } from 'vitest';

import {
  galleryDirectoryQuerySchema,
  photoListingQuerySchema,
} from '../../packages/contracts/src/media/index.ts';
import {
  DEFAULT_PHOTOS_VIEW,
  galleriesCanonicalRedirect,
  galleriesHref,
  galleriesReadQuery,
  galleryCanonicalRedirect,
  galleryPageHref,
  mediaArchiveCanonicalRedirect,
  mediaArchiveHref,
  periodHref,
  PHOTOS_MAX_PAGE,
  photosCanonicalRedirect,
  photosFiltered,
  photosHref,
  photosListingHref,
  photosReadQuery,
  readGalleriesView,
  readGalleryPage,
  readMediaArchiveView,
  readPhotosView,
} from '../../apps/web/src/components/media/photos-view.ts';

/**
 * News & Events Part 2 — the photograph surfaces' address rules: the view a
 * GET address means, the ONE address of each view, the redirect that spells
 * any other address of it that way (Phase 12's `?offset=` and the archive's
 * former listing parameters among them), and what Media is asked — accepted
 * by Media's own schemas. Pure, so these are the rules the pages, the filter
 * forms, the chips, the tabs, the pages and every link into the listing share.
 */

const GALLERY = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('the photographs listing', () => {
  it('reads the unfiltered listing from nothing, and every filter from its address', () => {
    expect(readPhotosView({})).toEqual(DEFAULT_PHOTOS_VIEW);
    expect(
      readPhotosView({
        year: '1995',
        month: '3',
        gallery: GALLERY.toUpperCase(),
        language: 'ur',
        sort: 'oldest',
        page: '4',
      }),
    ).toEqual({
      year: 1995,
      month: 3,
      gallery: GALLERY,
      language: 'ur',
      sort: 'oldest',
      page: 4,
    });
  });

  it('drops a malformed, repeated or out-of-range value rather than failing', () => {
    expect(
      readPhotosView({
        year: '19955',
        month: '3',
        gallery: 'a-gallery',
        language: 'fr',
        sort: 'popular',
        page: '0',
      }),
    ).toEqual(DEFAULT_PHOTOS_VIEW);
    expect(
      readPhotosView({ year: ['1995', '1996'], gallery: [GALLERY, GALLERY] }),
    ).toEqual(DEFAULT_PHOTOS_VIEW);
    expect(readPhotosView({ year: '1825' }).year).toBeNull();
    expect(readPhotosView({ page: String(PHOTOS_MAX_PAGE + 1) }).page).toBe(1);
  });

  it('reads a former offset as the page holding the photograph it began with, within the bound', () => {
    expect(readPhotosView({ offset: '48' }).page).toBe(3);
    expect(readPhotosView({ offset: '50' }).page).toBe(3);
    expect(readPhotosView({ offset: '999999999' }).page).toBe(1);
    // A page given beside it wins.
    expect(readPhotosView({ offset: '48', page: '2' }).page).toBe(2);
  });

  it('writes one address per view, neutral values omitted and identifiers in lower case', () => {
    expect(photosHref('en', DEFAULT_PHOTOS_VIEW)).toBe('/media/photos');
    expect(
      photosHref('ur', {
        year: 1995,
        month: 3,
        gallery: GALLERY.toUpperCase(),
        language: 'ar',
        sort: 'newest',
        page: 2,
      }),
    ).toBe(
      `/ur/media/photos?year=1995&month=3&gallery=${GALLERY}&language=ar&sort=newest&page=2`,
    );
    // A month never travels without its year.
    expect(photosHref('en', { ...DEFAULT_PHOTOS_VIEW, month: 3 })).toBe('/media/photos');
  });

  it('returns to the first page when a filter changes, and keeps it for a page', () => {
    const view = { ...DEFAULT_PHOTOS_VIEW, year: 1995, page: 3 };
    expect(photosHref('en', view)).toBe('/media/photos?year=1995&page=3');
    expect(photosHref('en', view, { language: 'en' })).toBe(
      '/media/photos?year=1995&language=en',
    );
    expect(photosHref('en', view, { page: 4 })).toBe('/media/photos?year=1995&page=4');
    // Removing a year removes its month.
    expect(photosHref('en', { ...view, month: 3 }, { year: null, month: null })).toBe(
      '/media/photos',
    );
    expect(photosListingHref('ar', { gallery: GALLERY })).toBe(
      `/ar/media/photos?gallery=${GALLERY}`,
    );
  });

  it('counts an order as no narrowing', () => {
    expect(photosFiltered({ ...DEFAULT_PHOTOS_VIEW, sort: 'oldest' })).toBe(false);
    expect(photosFiltered({ ...DEFAULT_PHOTOS_VIEW, gallery: GALLERY })).toBe(true);
    expect(photosFiltered({ ...DEFAULT_PHOTOS_VIEW, language: 'ur' })).toBe(true);
    expect(photosFiltered({ ...DEFAULT_PHOTOS_VIEW, year: 2001 })).toBe(true);
  });

  it('answers every other spelling of a view with ONE redirect, and the canonical one with none', () => {
    expect(photosCanonicalRedirect('en', {})).toBeNull();
    expect(photosCanonicalRedirect('en', { year: '1995', month: '3' })).toBeNull();
    // A GET form submits every control, empty ones included.
    expect(
      photosCanonicalRedirect('en', {
        year: '1995',
        month: '',
        gallery: '',
        language: '',
        sort: 'added',
      }),
    ).toBe('/media/photos?year=1995');
    // Another order of the same parameters.
    expect(photosCanonicalRedirect('ur', { month: '3', year: '1995' })).toBe(
      '/ur/media/photos?year=1995&month=3',
    );
    // Phase 12's offset, and a malformed value.
    expect(photosCanonicalRedirect('en', { offset: '24' })).toBe('/media/photos?page=2');
    expect(photosCanonicalRedirect('en', { gallery: 'nothing', page: '1' })).toBe(
      '/media/photos',
    );
    expect(photosCanonicalRedirect('en', { gallery: GALLERY.toUpperCase() })).toBe(
      `/media/photos?gallery=${GALLERY}`,
    );
    // A parameter the listing does not read is left alone.
    expect(photosCanonicalRedirect('en', { utm: 'x' })).toBeNull();
  });

  it('asks Media for exactly what its schema accepts', () => {
    const view = readPhotosView({
      year: '1995',
      month: '3',
      gallery: GALLERY,
      language: 'ur',
      sort: 'newest',
      page: '3',
    });
    expect(photosReadQuery(view)).toEqual({
      year: 1995,
      month: 3,
      gallery: GALLERY,
      language: 'ur',
      sort: 'newest',
      offset: 48,
      limit: 24,
    });
    expect(photoListingQuerySchema.safeParse(photosReadQuery(view)).success).toBe(true);
    expect(
      photoListingQuerySchema.safeParse(
        photosReadQuery(readPhotosView({ page: String(PHOTOS_MAX_PAGE) })),
      ).success,
    ).toBe(true);
  });
});

describe('the galleries directory and a gallery', () => {
  it('reads, writes and redirects the directory’s order and page', () => {
    expect(readGalleriesView({})).toEqual({ sort: 'newest', page: 1 });
    expect(readGalleriesView({ sort: 'title', page: '2' })).toEqual({
      sort: 'title',
      page: 2,
    });
    expect(readGalleriesView({ sort: 'popular', offset: '24' })).toEqual({
      sort: 'newest',
      page: 2,
    });
    expect(galleriesHref('ur', { sort: 'oldest', page: 3 })).toBe(
      '/ur/media/galleries?sort=oldest&page=3',
    );
    // A new order starts again at the first page.
    expect(galleriesHref('en', { sort: 'oldest', page: 3 }, { sort: 'title' })).toBe(
      '/media/galleries?sort=title',
    );
    expect(galleriesCanonicalRedirect('en', {})).toBeNull();
    expect(galleriesCanonicalRedirect('en', { sort: 'newest' })).toBe('/media/galleries');
    expect(galleriesCanonicalRedirect('en', { offset: '48' })).toBe(
      '/media/galleries?page=3',
    );
    expect(
      galleryDirectoryQuerySchema.safeParse(
        galleriesReadQuery({ sort: 'title', page: 2 }, 'ar'),
      ).data,
    ).toEqual({ sort: 'title', titleLocale: 'ar', offset: 24, limit: 24 });
  });

  it('pages a gallery by ?page, its former offset one redirect', () => {
    expect(readGalleryPage({})).toBe(1);
    expect(readGalleryPage({ offset: '24' })).toBe(2);
    expect(galleryPageHref('en', 'a-gallery', 1)).toBe('/media/galleries/a-gallery');
    expect(galleryPageHref('ur', 'a-gallery', 2)).toBe(
      '/ur/media/galleries/a-gallery?page=2',
    );
    expect(galleryCanonicalRedirect('en', 'a-gallery', {})).toBeNull();
    expect(galleryCanonicalRedirect('en', 'a-gallery', { page: '2' })).toBeNull();
    expect(galleryCanonicalRedirect('en', 'a-gallery', { offset: '24' })).toBe(
      '/media/galleries/a-gallery?page=2',
    );
    expect(galleryCanonicalRedirect('ar', 'a-gallery', { page: '1' })).toBe(
      '/ar/media/galleries/a-gallery',
    );
  });
});

describe('the archive is an index into the listing', () => {
  it('reads only a year, and leads each period into the listing by the date taken', () => {
    expect(readMediaArchiveView({ year: '1995', month: '3' })).toEqual({ year: 1995 });
    expect(mediaArchiveHref('en')).toBe('/media/archive');
    expect(mediaArchiveHref('ur', 1995)).toBe('/ur/media/archive?year=1995');
    expect(periodHref('en', 1995, null)).toBe('/media/photos?year=1995&sort=newest');
    expect(periodHref('ar', 1995, 3)).toBe(
      '/ar/media/photos?year=1995&month=3&sort=newest',
    );
  });

  it('answers each former listing address with ONE redirect to the period it named', () => {
    expect(mediaArchiveCanonicalRedirect('en', {})).toBeNull();
    expect(mediaArchiveCanonicalRedirect('en', { year: '1995' })).toBeNull();
    expect(mediaArchiveCanonicalRedirect('en', { year: '1995', month: '3' })).toBe(
      '/media/photos?year=1995&month=3&sort=newest',
    );
    expect(mediaArchiveCanonicalRedirect('en', { year: '1995', offset: '48' })).toBe(
      '/media/photos?year=1995&sort=newest&page=3',
    );
    // Without a year, a former offset or month means the index of every year.
    expect(mediaArchiveCanonicalRedirect('en', { offset: '24' })).toBe('/media/archive');
    expect(mediaArchiveCanonicalRedirect('en', { month: '3' })).toBe('/media/archive');
    expect(mediaArchiveCanonicalRedirect('ur', { year: 'soon' })).toBe(
      '/ur/media/archive',
    );
  });
});
