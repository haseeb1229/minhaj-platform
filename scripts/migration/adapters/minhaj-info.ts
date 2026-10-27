import {
  canonicalSourceUrl,
  type DiscoveredItem,
  type MigrationSourceAdapter,
  type ParseResult,
  type ParsedMagazine,
  type ParsedMagazineIssue,
} from '@minhaj/contracts/migration';

import { cleanText, decodeHtml, innerSource, loadHtml } from './html-source.ts';
import { createListingDiscovery, isoDateOf } from './markup-support.ts';
import {
  checkSelection,
  escapeHtmlText,
  fixedItemDiscovery,
  hasJsonLdType,
  jsonLdObjects,
  nonEmpty,
  pathOf,
  retrieveOnce,
  scriptLocale,
  siteRoot,
  statedLanguage,
  type SourceSelection,
} from './source-support.ts';

/**
 * MINHAJ.INFO MAGAZINES — `library.magazine` and `library.magazine-issue`
 * (MIGRATION_STRATEGY.md §3.2). The site is the apex host `minhaj.info`;
 * every archive and issue link it prints is absolute on that host.
 *
 * A MAGAZINE is its archive page (`/minhaj-ul-quran-mags`,
 * `/dukhtran-e-islam`, `/ulama-mags`):
 *   title         `h1#pubTitle`, exactly as written;
 *   description   the exact source of `p#pubBlurb`;
 *   language      JSON-LD `inLanguage`, else `og:locale` — never `<html lang>`;
 *   locale        the title's script (see `scriptLocale`);
 *   id            the archive path's slug.
 *
 * An ISSUE is `/{archive}/{month-slug}`, discovered ONLY from that
 * archive's own grid (`#issueGrid a.icard`): the slugs are inconsistent on
 * the site and are never constructed.
 *   title         the issue's own heading (`section.dlc h3`, "شمارہ …"),
 *                 else the breadcrumb's last item — never the magazine's h1;
 *   magazine      the canonical archive URL, built by the SAME function as
 *                 the magazine adapter's external key, so the reference
 *                 resolves through that record's legacy mapping;
 *   published     JSON-LD `datePublished` when it is a full date, else null
 *                 (the issue pages carry no JSON-LD today: null);
 *   volume/issue  JSON-LD `volumeNumber` / `issueNumber` only;
 *   body          a table of contents of the source's OWN words — each
 *                 `article.acard` heading, then its `a.auth-link` names —
 *                 re-structured as `<ul><li>Title — Author</li>…</ul>`,
 *                 escaped; null when the page lists none;
 *   links         the article URLs, as written.
 * No PDF and no cover is acquired (the PDFs exceed the acquisition cap, and
 * webp is not an admitted asset type).
 */

export const MINHAJ_INFO_MAGAZINE_ADAPTER_KEY = 'minhaj-info-magazine';
export const MINHAJ_INFO_ISSUE_ADAPTER_KEY = 'minhaj-info-magazine-issue';
export const MINHAJ_INFO_HOST = 'minhaj.info';
export const MINHAJ_INFO_DEFAULT_BASE_URL = `https://${MINHAJ_INFO_HOST}/`;

const ARCHIVE_PATTERN = /^\/([A-Za-z0-9][A-Za-z0-9-]*)$/;
const ISSUE_PATTERN = /^\/([A-Za-z0-9][A-Za-z0-9-]*)\/([^/]+)$/;
/** A JSON-LD date or date-time; only its calendar date is read. */
const FULL_DATE = /^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:T.*)?$/;

/**
 * THE canonical URL of a magazine — its archive page. The magazine's
 * external key and every issue's `magazineUrl` are this one value.
 */
export function minhajInfoMagazineUrl(base: URL, archivePath: string): string {
  if (!ARCHIVE_PATTERN.test(archivePath))
    throw new Error('a magazine archive is one path segment, e.g. /minhaj-ul-quran-mags');
  return canonicalSourceUrl(new URL(archivePath, base));
}

export interface MinhajInfoMagazineAdapterOptions {
  /** The site root; `https://minhaj.info/` only. */
  readonly baseUrl?: string;
  /** The archive paths, e.g. `['/minhaj-ul-quran-mags', '/dukhtran-e-islam']`. */
  readonly magazines: readonly string[];
  readonly selection: SourceSelection;
}

export interface MinhajInfoIssueAdapterOptions {
  readonly baseUrl?: string;
  /** The ONE archive path whose issues are discovered. */
  readonly magazine: string;
  readonly selection: SourceSelection;
}

export function createMinhajInfoMagazineAdapter(
  options: MinhajInfoMagazineAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(
    options.baseUrl ?? MINHAJ_INFO_DEFAULT_BASE_URL,
    MINHAJ_INFO_HOST,
  );
  checkSelection(options.selection);
  if (options.magazines.length === 0)
    throw new Error('name at least one magazine archive');
  const keys = [
    ...new Set(options.magazines.map((path) => minhajInfoMagazineUrl(base, path))),
  ];
  // The named archives are the records: one page, no listing fetched.
  const discover = fixedItemDiscovery(
    base,
    keys.map((externalKey) => ({
      externalKey,
      originalUrl: externalKey,
      legacyIdentifier: new URL(externalKey).pathname.slice(1),
    })),
    options.selection.limit,
  );

  return {
    adapterKey: MINHAJ_INFO_MAGAZINE_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-info-magazine',
    parserVersion: '1',
    contentKind: 'library.magazine',
    accessMethod: 'http',

    discover,

    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const html = decoded.html;
      const slug = ARCHIVE_PATTERN.exec(pathOf(evidence.finalUrl) ?? '')?.[1];
      const $ = loadHtml(html);
      if (slug === undefined || $('#issueGrid').length !== 1)
        return { kind: 'excluded', reason: 'not-a-magazine-archive' };

      const heading = $('h1#pubTitle');
      const title = cleanText(heading.text());
      if (heading.length !== 1 || title.length === 0)
        return { kind: 'failed', detail: 'title-missing' };
      const languageCode = statedLanguage($);
      const primaryLocale = scriptLocale(title, languageCode);
      if (primaryLocale === null)
        return { kind: 'failed', detail: 'primary-locale-undetermined' };
      const blurb = $('p#pubBlurb').first();

      const record: ParsedMagazine = {
        kind: 'library.magazine',
        title,
        primaryLocale,
        languageCode,
        publishedOn: null,
        legacyIdentifier: slug,
        categories: [],
        links: [],
        assets: [],
        descriptionHtml:
          blurb.length === 1 && cleanText(blurb.text()).length > 0
            ? innerSource(html, blurb)
            : '',
      };
      return { kind: 'parsed', record };
    },
  };
}

export function createMinhajInfoIssueAdapter(
  options: MinhajInfoIssueAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(
    options.baseUrl ?? MINHAJ_INFO_DEFAULT_BASE_URL,
    MINHAJ_INFO_HOST,
  );
  checkSelection(options.selection);
  const magazineUrl = minhajInfoMagazineUrl(base, options.magazine);
  const magazineSlug = options.magazine.slice(1);

  /**
   * The archive's grid, newest first as the site orders it: ONE listing page
   * (the archive has no pagination), through the shared listing walk.
   */
  const discover = createListingDiscovery({
    base,
    selection: { pages: 1, limit: options.selection.limit },
    listingUrl: () => magazineUrl,
    readListing($) {
      const grid = $('#issueGrid');
      if (grid.length !== 1) return null;
      const hrefs: string[] = [];
      grid.find('a.icard[href]').each((_index, element) => {
        hrefs.push($(element).attr('href') ?? '');
      });
      return { hrefs, pageLinks: [] };
    },
    itemOf(target): DiscoveredItem | null {
      const match = ISSUE_PATTERN.exec(target.pathname);
      if (match === null || match[1] !== magazineSlug || target.search !== '')
        return null;
      const externalKey = canonicalSourceUrl(target);
      return {
        externalKey,
        originalUrl: externalKey,
        legacyIdentifier: `${magazineSlug}/${match[2] ?? ''}`,
      };
    },
  });

  return {
    adapterKey: MINHAJ_INFO_ISSUE_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-info-magazine-issue',
    parserVersion: '1',
    contentKind: 'library.magazine-issue',
    accessMethod: 'http',

    discover,

    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const match = ISSUE_PATTERN.exec(pathOf(evidence.finalUrl) ?? '');
      const $ = loadHtml(decoded.html);
      if (match === null || $('h1.issue-title').length !== 1)
        return { kind: 'excluded', reason: 'not-a-magazine-issue' };
      if (match[1] !== magazineSlug)
        return { kind: 'failed', detail: 'magazine-mismatch' };

      const title =
        nonEmpty($('section.dlc h3').first().text()) ??
        nonEmpty($('nav.crumbs > span').last().text());
      if (title === null) return { kind: 'failed', detail: 'title-missing' };
      const languageCode = statedLanguage($);
      const primaryLocale = scriptLocale(title, languageCode);
      if (primaryLocale === null)
        return { kind: 'failed', detail: 'primary-locale-undetermined' };

      const ld = jsonLdObjects($);
      const published = ld
        .map((object) => object['datePublished'])
        .find((value): value is string => typeof value === 'string');
      const stated = (type: string, key: string): string | null => {
        const value = ld.find((object) => hasJsonLdType(object, type))?.[key];
        return typeof value === 'string' || typeof value === 'number'
          ? nonEmpty(String(value))
          : null;
      };

      // The table of contents: the source's own titles and author names.
      const entries: string[] = [];
      const links: string[] = [];
      $('article.acard').each((_index, element) => {
        const card = $(element);
        const anchor = card.find('h3 a[href]').first();
        const articleTitle = nonEmpty(card.find('h3').first().text());
        if (articleTitle === null) return;
        if (anchor.length === 1) links.push(anchor.attr('href') ?? '');
        const authors = card
          .find('.foot a.auth-link')
          .map((_authorIndex, author) => cleanText($(author).text()))
          .get()
          .filter((name) => name.length > 0);
        const line =
          authors.length === 0 ? articleTitle : `${articleTitle} — ${authors.join(', ')}`;
        entries.push(`<li>${escapeHtmlText(line)}</li>`);
      });

      const record: ParsedMagazineIssue = {
        kind: 'library.magazine-issue',
        title,
        primaryLocale,
        languageCode,
        publishedOn:
          published === undefined ? null : isoDateOf(FULL_DATE.exec(published)?.[1]),
        legacyIdentifier: `${match[1]}/${match[2] ?? ''}`,
        categories: [],
        links,
        assets: [],
        bodyHtml: entries.length === 0 ? null : `<ul>${entries.join('')}</ul>`,
        volume: stated('PublicationVolume', 'volumeNumber'),
        issueNumber: stated('PublicationIssue', 'issueNumber'),
        magazineUrl,
      };
      return { kind: 'parsed', record };
    },
  };
}
