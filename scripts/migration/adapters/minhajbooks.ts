import {
  canonicalSourceUrl,
  type DiscoveredItem,
  type MigrationSourceAdapter,
  type ParseResult,
  type ParsedWork,
} from '@minhaj/contracts/migration';

import { cleanText, decodeHtml, innerSource, loadHtml } from './html-source.ts';
import {
  createListingDiscovery,
  pageNumbersOf,
  sequenceDiscovery,
} from './markup-support.ts';
import {
  checkSelection,
  firstPartyImage,
  nonEmpty,
  pathOf,
  retrieveOnce,
  scriptLocale,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * MINHAJ BOOKS — `library.work` (MIGRATION_STRATEGY.md §3.2), one Work and
 * the one Edition its book page describes.
 *
 *   discover — ONE category or listing path (`/english/cat/{Slug}/`), page 1
 *              at the path itself and page n at `{path}page/{n}/`, bounded by
 *              `selection.pages` and `selection.limit`. Only the id form
 *              `/english/book/{id}/{Slug}/` is queued — the key every later,
 *              wider run gives the same book. A listing that links books only
 *              by the slug form (the new-arrival page does) cannot be keyed
 *              without fetching each book, so it is REFUSED as unrecognised.
 *              The cursor is `{page}:{queued so far}`.
 *   parse    — `div.lib-book-detail`:
 *                title         `.kode-text > h2`, exactly as written;
 *                metadata      `.product-price p` rows, "Label : value";
 *                language      the "Book Language" row through a FIXED table
 *                              (the edition's content language, not the
 *                              `/english/` interface prefix, not `<html lang>`);
 *                locale        the title's script (see `scriptLocale`);
 *                id            `/english/book/{id}/` of the final URL, which
 *                              every `data-mbk-book-id` must agree with;
 *                description   the exact source of `#BookIntro`;
 *                edition       label = the Binding value, else the Book
 *                              Language value, as shown; publisher, year
 *                              and ISBN only from rows that state them;
 *                              pages from the "Pages" row as shown.
 *              NOT READ: the `#buybook` sale-point tab and `#sponsorlist`
 *              (organisational emails, phones, addresses, sponsor names), the
 *              buy and PayPal sponsor forms, and prices. No asset is acquired:
 *              the book PDFs exceed the 8 MiB acquisition cap (Stage 1A).
 */

export const MINHAJ_BOOKS_ADAPTER_KEY = 'minhajbooks-work';
export const MINHAJ_BOOKS_HOST = 'www.minhajbooks.com';
export const MINHAJ_BOOKS_DEFAULT_BASE_URL = `https://${MINHAJ_BOOKS_HOST}/`;

/**
 * The "Book Language" values the site uses, lower-cased, to their codes. A
 * value not in this table (the site's own "Others" facet among them) is no
 * signal: `languageCode` is null and the record cannot pass validation
 * without a person.
 */
export const MINHAJ_BOOKS_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  urdu: 'ur',
  english: 'en',
  arabic: 'ar',
  persian: 'fa',
  farsi: 'fa',
  punjabi: 'pa',
  sindhi: 'sd',
  pashto: 'ps',
  hindi: 'hi',
  bengali: 'bn',
  bangla: 'bn',
  gujarati: 'gu',
  kashmiri: 'ks',
  norwegian: 'no',
  danish: 'da',
  dutch: 'nl',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  italian: 'it',
  portuguese: 'pt',
  swedish: 'sv',
  greek: 'el',
  turkish: 'tr',
  albanian: 'sq',
  bosnian: 'bs',
  russian: 'ru',
  chinese: 'zh',
  japanese: 'ja',
  indonesian: 'id',
  malay: 'ms',
  swahili: 'sw',
  tamil: 'ta',
});

const LISTING_PATTERN =
  /^\/english\/(?:cat\/[A-Za-z0-9][A-Za-z0-9-]*|[A-Za-z][A-Za-z-]*)\/$/;
const BOOK_LINK_PATTERN = /^\/english\/book\/([1-9][0-9]{0,6})\/[^/]+\/$/;
const BOOK_PAGE_PATTERN = /^\/(?:english|urdu)\/book\/([1-9][0-9]{0,6})\/[^/]+\/$/;

export interface MinhajBooksWorkAdapterOptions {
  /** The site root; `https://www.minhajbooks.com/` only. */
  readonly baseUrl?: string;
  /**
   * The listing paths walked in turn, e.g. `/english/cat/The-Hadith/` —
   * the selection's pages and limit apply to EACH (Phase 30-R).
   */
  readonly listings: readonly string[];
  readonly selection: SourceSelection;
}

export function createMinhajBooksWorkAdapter(
  options: MinhajBooksWorkAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(
    options.baseUrl ?? MINHAJ_BOOKS_DEFAULT_BASE_URL,
    MINHAJ_BOOKS_HOST,
  );
  if (
    options.listings.length === 0 ||
    new Set(options.listings).size !== options.listings.length ||
    !options.listings.every((listing) => LISTING_PATTERN.test(listing))
  )
    throw new Error(
      'each listing must be a distinct /english/ listing path such as /english/cat/{Slug}/',
    );
  checkSelection(options.selection);
  const { selection } = options;

  /**
   * The shared listing walk (`markup-support.ts`): book cards of the
   * `div.lib-related-products` grid; pagination is the "Next" link alone,
   * which — when followed — must name this listing's page n+1.
   */
  const walk = (listing: string) =>
    createListingDiscovery({
      base,
      selection,
      listingUrl: (page) =>
        new URL(page === 1 ? listing : `${listing}page/${page}/`, base).toString(),
      readListing($, finalUrl) {
        const grid = $('div.lib-related-products');
        if (grid.length !== 1) return null;
        const hrefs: string[] = [];
        grid.find('.best-seller-pro a[href]').each((_index, anchor) => {
          hrefs.push($(anchor).attr('href') ?? '');
        });
        const nextHref = $('ul.pagination a[aria-label="Next"][href]')
          .first()
          .attr('href');
        if (nextHref === undefined) return { hrefs, pageLinks: [] };
        const pageLinks = pageNumbersOf([nextHref], finalUrl, base, listing);
        // A Next link that names no page of this listing cannot be walked.
        if (pageLinks.length !== 1) return null;
        return { hrefs, pageLinks, nextOnly: true };
      },
      itemOf(target): DiscoveredItem | null {
        const match = BOOK_LINK_PATTERN.exec(target.pathname);
        if (match === null || target.search !== '') return null;
        const externalKey = canonicalSourceUrl(target);
        return {
          externalKey,
          originalUrl: externalKey,
          legacyIdentifier: `book-${match[1] ?? ''}`,
        };
      },
    });
  const discover = sequenceDiscovery(options.listings.map(walk));

  return {
    adapterKey: MINHAJ_BOOKS_ADAPTER_KEY,
    adapterVersion: '2',
    parserKey: 'cheerio-minhajbooks-work',
    parserVersion: '2',
    contentKind: 'library.work',
    accessMethod: 'http',

    discover,

    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const html = decoded.html;
      const path = pathOf(evidence.finalUrl);
      const pageId = path === null ? null : (BOOK_PAGE_PATTERN.exec(path)?.[1] ?? null);
      if (pageId === null) return { kind: 'excluded', reason: 'not-a-book-page' };

      const $ = loadHtml(html);
      const detail = $('div.lib-book-detail');
      if (detail.length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };

      const statedIds = new Set<string>();
      detail.find('[data-mbk-book-id]').each((_index, element) => {
        statedIds.add($(element).attr('data-mbk-book-id') ?? '');
      });
      if ([...statedIds].some((id) => id !== pageId))
        return { kind: 'failed', detail: 'book-id-mismatch' };

      const title = cleanText(detail.find('.kode-text > h2').first().text());
      if (title.length === 0) return { kind: 'failed', detail: 'title-missing' };

      // "Label : value" rows; the value is the row's highlighted span(s). The
      // first row of a label wins. Prices are never read.
      const rows = new Map<string, string | null>();
      const categories: { key: string; label: string }[] = [];
      detail.find('.product-price p').each((_index, element) => {
        const row = $(element);
        const text = cleanText(row.text());
        const colon = text.indexOf(':');
        if (colon <= 0) return;
        const label = text.slice(0, colon).trim().toLowerCase();
        if (rows.has(label) || label === 'price') return;
        const spans = row.find('.color');
        rows.set(
          label,
          spans.length > 0
            ? nonEmpty(
                spans
                  .map((_spanIndex, span) => $(span).text())
                  .get()
                  .join(' '),
              )
            : nonEmpty(text.slice(colon + 1)),
        );
        if (label !== 'category') return;
        row.find('a[href]').each((_linkIndex, anchor) => {
          const key = /\/cat\/([^/?#]+)\/?$/.exec($(anchor).attr('href') ?? '')?.[1];
          const name = nonEmpty($(anchor).text());
          if (key !== undefined && name !== null) categories.push({ key, label: name });
        });
      });
      const field = (label: string) => rows.get(label) ?? null;

      const languageText = field('book language');
      const languageCode =
        languageText === null
          ? null
          : (MINHAJ_BOOKS_LANGUAGES[languageText.toLowerCase()] ?? null);
      const primaryLocale = scriptLocale(title, languageCode);
      if (primaryLocale === null)
        return { kind: 'failed', detail: 'primary-locale-undetermined' };

      // The book's description, exactly as written — and never a tab whose
      // words are sale-point or sponsor contact details.
      const intro = $('#BookIntro').first();
      if (intro.find('#buybook, #sponsorlist').length > 0)
        return { kind: 'failed', detail: 'description-structure-unexpected' };
      const descriptionHtml =
        intro.length === 1 && cleanText(intro.text()).length > 0
          ? innerSource(html, intro)
          : '';

      // Where the source offers the book to read or download, as written.
      const links: string[] = [];
      detail.find('.kode-text').each((_index, element) => {
        const block = $(element);
        if (cleanText(block.children('h4').first().text()) !== 'Read & Download') return;
        block.find('a.add-to-cart[href]').each((_linkIndex, anchor) => {
          links.push($(anchor).attr('href') ?? '');
        });
      });

      // The edition's cover: the book's own picture in the detail block, the
      // one its `og:image` names (Phase 30-R).
      const coverImg = detail
        .find('img[src*="/images-books/"]')
        .filter((_index, element) => !($(element).attr('src') ?? '').includes('/images/'))
        .first();
      const cover = firstPartyImage($, {
        src: $('meta[property="og:image:url"]').attr('content') ?? coverImg.attr('src'),
        alt: nonEmpty(coverImg.attr('alt')) ?? title,
        pageUrl: evidence.finalUrl,
        hosts: [MINHAJ_BOOKS_HOST],
      });

      const record: ParsedWork = {
        kind: 'library.work',
        title,
        primaryLocale,
        languageCode,
        publishedOn: null,
        legacyIdentifier: `book-${pageId}`,
        categories,
        links,
        assets: cover === null ? [] : [cover.asset],
        descriptionHtml,
        edition: {
          label: field('binding') ?? languageText,
          publisher: field('publisher'),
          publicationYear: field('publication year') ?? field('year'),
          isbn: field('isbn'),
          pageCount: field('pages'),
          readableAssetUrl: null,
          downloadAssetUrl: null,
          cover: cover?.image ?? null,
        },
      };
      return { kind: 'parsed', record };
    },
  };
}
