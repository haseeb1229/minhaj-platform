import type {
  DiscoveredItem,
  MigrationSourceAdapter,
  ParseResult,
  ParsedAsset,
  ParsedCollection,
  ParsedEditorial,
  ParsedImage,
  ParsedPage,
  ParsedPerson,
  StagedEditorialKind,
} from '@minhaj/contracts/migration';
import type { CheerioAPI } from 'cheerio';

import { cleanText, decodeHtml, loadHtml } from './html-source.ts';
import {
  checkSegment,
  commentRanges,
  createListingDiscovery,
  innerRange,
  isoDateOf,
  keyOf,
  outerRange,
  pageNumbersOf,
  sliceExcluding,
  writtenDateOf,
  type SourceRange,
} from './markup-support.ts';
import {
  checkSelection,
  firstPartyImage,
  fixedItemDiscovery,
  retrieveOnce,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * MINHAJ.ORG (MIGRATION_STRATEGY.md §3.1) — one language section's listing of
 * one Editorial kind, and (Phase 30-R) the organisational pages and public
 * profiles a committed catalogue names, everything that knows the site's
 * markup in one place.
 *
 *   discover — editorial: the section's paginated listing, `/{lang}/{section}/`
 *              then `/{lang}/{section}/page/{n}/`, item cards taken from the
 *              MAIN column only (the sidebar carries its own dated widgets);
 *              pages and profiles: the catalogue's fixed list of `tid`s,
 *              narrowed by `selection.items`. The site's sitemap is a 404 and
 *              its feeds are dead.
 *   key      — the numeric `tid`: `https://www.minhaj.org/{lang}/tid/{n}/`,
 *              the short form the site itself serves and names canonical,
 *              whatever slug or section a link carried.
 *   parse    — `article.post`: the title, the machine date, and the body as
 *              exact source minus the template's chrome (title, date line,
 *              like and share widgets, comments). Language comes from the URL
 *              section; `<html lang>` on this site is always English.
 *   image    — (Phase 30-R) the post's FIRST picture, when it is a JPEG or PNG
 *              on the site itself or on the organisation's own image host
 *              (`minhaj.net`, a registered asset host): the record's lead image
 *              — or a profile's portrait — with the picture's own `alt`, and
 *              its acquisition carrying the page's copyright notice as rights
 *              evidence. The picture stays out of the body.
 */

export const MINHAJ_ORG_EDITORIAL_ADAPTER_KEY = 'minhaj-org-editorial';
export const MINHAJ_ORG_PAGE_ADAPTER_KEY = 'minhaj-org-page';
export const MINHAJ_ORG_PERSON_ADAPTER_KEY = 'minhaj-org-person';
/** Phase 30-RD: the posts a curated archive holds, and the archives themselves. */
export const MINHAJ_ORG_ARCHIVE_NEWS_ADAPTER_KEY = 'minhaj-org-archive-news';
export const MINHAJ_ORG_COLLECTION_ADAPTER_KEY = 'minhaj-org-collection';
export const MINHAJ_ORG_BASE_URL = 'https://www.minhaj.org/';
/** The hosts a minhaj.org source registers: listing and item links stay on www. */
export const MINHAJ_ORG_HOST = 'www.minhaj.org';
export const MINHAJ_ORG_HOSTS: readonly string[] = Object.freeze([MINHAJ_ORG_HOST]);
/**
 * Phase 30-R. The organisation's own image hosts its posts name for their
 * pictures (surveyed 2026-10-29: `minhaj.net` from minhaj.org itself,
 * `www.minhaj.net` from its sister sites) — registered as ASSET hosts, reached
 * only to acquire a picture a post presents.
 */
export const MINHAJ_ORG_ASSET_HOSTS: readonly string[] = Object.freeze([
  'minhaj.net',
  'www.minhaj.net',
]);
const IMAGE_HOSTS: readonly string[] = Object.freeze([
  MINHAJ_ORG_HOST,
  ...MINHAJ_ORG_ASSET_HOSTS,
]);

const SECTION_LANGUAGES = Object.freeze({
  english: 'en',
  urdu: 'ur',
  arabic: 'ar',
} as const);
type SectionLanguage = keyof typeof SECTION_LANGUAGES;
type EditorialLanguage = (typeof SECTION_LANGUAGES)[SectionLanguage];

/**
 * The `og:locale` languages a URL section may carry. Arabic pages print
 * `ur_PK` (a template defect, seen on every Arabic page surveyed 2026-10-27),
 * so for them `ur` is tolerated; any other disagreement is a conflict.
 */
const OG_LOCALE_LANGUAGES: Readonly<Record<EditorialLanguage, readonly string[]>> = {
  en: ['en'],
  ur: ['ur'],
  ar: ['ar', 'ur'],
};

/** Template chrome inside an article: never content. */
const CHROME =
  'h1.entry_title, .meta_date, .shareaholic-canvas, [class*="shareaholic"], .fb-like, .fb-share-button, .fb-comments, #comments, .a2a_kit';

/**
 * A `tid` page's path. The category segment may be EMPTY: the site redirects a
 * page filed under no category to `/{lang}//tid/{n}/{slug}.html` (seen on the
 * founder's profile, the forums, achievements and social-media pages,
 * 2026-10-29), and that answer is the page itself.
 */
const TID_PATH = /^\/(english|urdu|arabic)\/(?:[^/]*\/)?tid\/([1-9][0-9]{0,8})(?:\/|$)/;

function isSectionLanguage(value: string | undefined): value is SectionLanguage {
  return value === 'english' || value === 'urdu' || value === 'arabic';
}

/** A tid as an item key, `/{lang}/tid/{n}/` on the site root. */
function tidItem(base: URL, language: SectionLanguage, tid: string): DiscoveredItem {
  const externalKey = keyOf(base, `/${language}/tid/${tid}/`);
  return { externalKey, originalUrl: externalKey, legacyIdentifier: `tid-${tid}` };
}

/* ===========================================================================
 * One post, read
 * ========================================================================= */

interface Post {
  readonly tid: string;
  readonly title: string;
  readonly publishedOn: string | null;
  readonly bodyHtml: string;
  readonly image: ParsedImage | null;
  readonly assets: readonly ParsedAsset[];
}

/**
 * The post on a `tid` page of `sectionLanguage`, or the parse result that says
 * why there is none. Everything the page's template adds is cut out; the
 * post's first picture becomes its image and is cut out of the body too.
 */
function readPost(
  evidence: Parameters<MigrationSourceAdapter['parse']>[0],
  sectionLanguage: SectionLanguage,
): { readonly kind: 'post'; readonly post: Post } | ParseResult {
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  const decoded = decodeHtml(evidence.body, evidence.contentType);
  if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
  const html = decoded.html;
  const $ = loadHtml(html);

  let path: string;
  try {
    path = new URL(evidence.finalUrl).pathname;
  } catch {
    return { kind: 'failed', detail: 'final-url-invalid' };
  }
  const tid = TID_PATH.exec(path);
  if (tid === null) return { kind: 'excluded', reason: 'not-a-tid-page' };
  if (tid[1] !== sectionLanguage) return { kind: 'failed', detail: 'language-conflict' };

  const article = $('article.post');
  if (article.length !== 1) {
    if ($('h1.page_title').length > 0)
      return { kind: 'excluded', reason: 'not-an-editorial-post' };
    return { kind: 'failed', detail: 'record-structure-missing' };
  }
  const content = article.find('div.entry_content').first();
  if (content.length !== 1) return { kind: 'failed', detail: 'record-structure-missing' };

  const title = cleanText(content.find('h1.entry_title').first().text());
  if (title.length === 0) return { kind: 'failed', detail: 'title-missing' };

  const ogLocale = $('meta[property="og:locale"]').attr('content');
  if (ogLocale !== undefined) {
    const ogLanguage = /^([a-z]{2,3})(?:[_-]|$)/i
      .exec(ogLocale.trim())?.[1]
      ?.toLowerCase();
    if (
      ogLanguage === undefined ||
      !OG_LOCALE_LANGUAGES[languageCode].includes(ogLanguage)
    )
      return { kind: 'failed', detail: 'language-conflict' };
  }

  const dateLine = content.find('.meta_date').first();
  const publishedOn =
    isoDateOf($('meta[itemprop="dateCreated"]').attr('content')) ??
    writtenDateOf(
      dateLine.find('a').length > 0
        ? dateLine.find('a').first().text()
        : dateLine.text().replace(/^[^:]*:/, ''),
    );

  const region = innerRange(content.get(0));
  if (region === null) return { kind: 'failed', detail: 'record-structure-missing' };
  const excluded: SourceRange[] = [...commentRanges(content.get(0))];
  content.find(CHROME).each((_index, element) => {
    const range = outerRange(element);
    if (range !== null) excluded.push(range);
  });
  // Empty layout clears between the chrome and the content.
  content.children('div').each((_index, element) => {
    const div = $(element);
    if (
      /clear/i.test(div.attr('style') ?? '') &&
      div.children().length === 0 &&
      cleanText(div.text()).length === 0
    ) {
      const range = outerRange(element);
      if (range !== null) excluded.push(range);
    }
  });

  // The post's first picture is its image when it is first-party; it leaves
  // the body either way, which shows no picture.
  const first = firstPicture($, content, evidence.finalUrl);
  if (first !== null && first.range !== null) excluded.push(first.range);

  const bodyHtml = sliceExcluding(html, region, excluded).trim();
  if (bodyHtml.length === 0) return { kind: 'failed', detail: 'body-missing' };

  return {
    kind: 'post',
    post: {
      tid: tid[2] ?? '',
      title,
      publishedOn,
      bodyHtml,
      image: first?.found?.image ?? null,
      assets: first?.found === null || first === null ? [] : [first.found.asset],
    },
  };
}

/** The first `img` of the post body that is not template chrome. */
function firstPicture(
  $: CheerioAPI,
  content: ReturnType<CheerioAPI>,
  pageUrl: string,
): {
  readonly found: ReturnType<typeof firstPartyImage>;
  readonly range: SourceRange | null;
} | null {
  const img = content
    .find('img')
    .filter((_index, element) => $(element).closest(CHROME).length === 0)
    .first();
  if (img.length !== 1) return null;
  return {
    found: firstPartyImage($, {
      src: img.attr('src'),
      alt: img.attr('alt'),
      pageUrl,
      hosts: IMAGE_HOSTS,
    }),
    range: outerRange(img.get(0)),
  };
}

/* ===========================================================================
 * Editorial: news, articles, press releases
 * ========================================================================= */

export interface MinhajOrgEditorialAdapterOptions {
  /** `https://www.minhaj.org/`. */
  readonly baseUrl: string;
  readonly selection: SourceSelection;
  readonly kind: StagedEditorialKind;
  /** The listing segment, e.g. `News-Events`, `Articles` or `Press-Release`. */
  readonly section: string;
  readonly language: SectionLanguage;
  /**
   * Phase 30-R. The `tid`s another source of this site owns — the catalogued
   * Explore pages — which a listing may also show. They are not items of this
   * listing, so one legacy address never maps to two records.
   */
  readonly reservedTids: readonly string[];
}

const EDITORIAL_KINDS: readonly string[] = Object.freeze([
  'editorial.news',
  'editorial.article',
  'editorial.press-release',
]);

export function createMinhajOrgEditorialAdapter(
  options: MinhajOrgEditorialAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_ORG_HOST);
  checkSelection(options.selection);
  const { selection } = options;
  const section = checkSegment('section', options.section);
  if (!isSectionLanguage(options.language))
    throw new Error('language must be english, urdu or arabic');
  if (!EDITORIAL_KINDS.includes(options.kind))
    throw new Error(
      'kind must be editorial.news, editorial.article or editorial.press-release',
    );
  const { kind } = options;
  const sectionLanguage = options.language;
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  const listingPath = `/${sectionLanguage}/${section}/`;
  const reserved = new Set(options.reservedTids);

  const discover = createListingDiscovery({
    base,
    selection,
    listingUrl: (page) =>
      new URL(page === 1 ? listingPath : `${listingPath}page/${page}/`, base).toString(),
    readListing($, finalUrl) {
      // The main column is the one holding the page title; the sidebars hold
      // their own dated widgets, which are never items.
      const main = $('h1.page_title').first().closest('.col');
      if (main.length !== 1) return null;
      const hrefs: string[] = [];
      main
        .find(
          '.layout_post_2 .item_content h4 a[href], .tb_widget_articles li > a[href], .tb_widget_recent_listpr .item_content h4 a[href]',
        )
        .each((_index, element) => {
          hrefs.push($(element).attr('href') ?? '');
        });
      const pagination: string[] = [];
      main.find('ul.page-numbers a[href]').each((_index, element) => {
        pagination.push($(element).attr('href') ?? '');
      });
      return { hrefs, pageLinks: pageNumbersOf(pagination, finalUrl, base, listingPath) };
    },
    itemOf(url): DiscoveredItem | null {
      const match = TID_PATH.exec(url.pathname);
      if (match === null || match[1] !== sectionLanguage) return null;
      if (reserved.has(match[2] ?? '')) return null;
      return tidItem(base, sectionLanguage, match[2] ?? '');
    },
  });

  return {
    adapterKey: MINHAJ_ORG_EDITORIAL_ADAPTER_KEY,
    adapterVersion: '4',
    parserKey: 'cheerio-minhaj-org-editorial',
    parserVersion: '3',
    contentKind: kind,
    accessMethod: 'http',
    discover,
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const read = readPost(evidence, sectionLanguage);
      if (read.kind !== 'post') return read;
      const { post } = read;
      const record: ParsedEditorial = {
        kind,
        title: post.title,
        primaryLocale: languageCode,
        languageCode,
        publishedOn: post.publishedOn,
        legacyIdentifier: `tid-${post.tid}`,
        categories: [{ key: section, label: section }],
        links: [],
        assets: post.assets,
        excerptHtml: null,
        bodyHtml: post.bodyHtml,
        leadImage: post.image,
      };
      return { kind: 'parsed', record };
    },
  };
}

/* ===========================================================================
 * Fixed lists: organisational pages and public profiles (Phase 30-R)
 * ========================================================================= */

export interface MinhajOrgFixedOptions {
  readonly baseUrl: string;
  readonly selection: SourceSelection;
  /** The operator's `--items`: catalogued tids to narrow to, or none for all. */
  readonly items: readonly string[];
  readonly language: SectionLanguage;
}

/** The catalogue's tids, narrowed to `items` when it names any. */
function selectedTids(
  catalogued: readonly string[],
  items: readonly string[],
): readonly string[] {
  for (const tid of catalogued)
    if (!/^[1-9][0-9]{0,8}$/.test(tid)) throw new Error('a catalogued tid is malformed');
  if (items.length === 0) return catalogued;
  for (const item of items)
    if (!catalogued.includes(item)) throw new Error('an item is not in the catalogue');
  return catalogued.filter((tid) => items.includes(tid));
}

export interface MinhajOrgPageOptions extends MinhajOrgFixedOptions {
  /**
   * tid → the shell route its page belongs at — the catalogue's reviewed
   * statement of where each organisational page goes, never inferred.
   */
  readonly bindings: Readonly<Record<string, string>>;
}

export function createMinhajOrgPageAdapter(
  options: MinhajOrgPageOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_ORG_HOST);
  checkSelection(options.selection);
  if (!isSectionLanguage(options.language))
    throw new Error('language must be english, urdu or arabic');
  const sectionLanguage = options.language;
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  const tids = selectedTids(Object.keys(options.bindings), options.items);
  const bindings = new Set(Object.values(options.bindings));
  if (bindings.size !== Object.keys(options.bindings).length)
    throw new Error('two pages may not share one binding');

  return {
    adapterKey: MINHAJ_ORG_PAGE_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-org-page',
    parserVersion: '2',
    contentKind: 'editorial.page',
    accessMethod: 'http',
    discover: fixedItemDiscovery(
      base,
      tids.map((tid) => tidItem(base, sectionLanguage, tid)),
      options.selection.limit,
    ),
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const read = readPost(evidence, sectionLanguage);
      if (read.kind !== 'post') return read;
      const { post } = read;
      const binding = options.bindings[post.tid];
      if (binding === undefined) return { kind: 'excluded', reason: 'not-catalogued' };
      const record: ParsedPage = {
        kind: 'editorial.page',
        binding,
        title: post.title,
        primaryLocale: languageCode,
        languageCode,
        publishedOn: post.publishedOn,
        legacyIdentifier: `tid-${post.tid}`,
        categories: [],
        links: [],
        assets: post.assets,
        excerptHtml: null,
        bodyHtml: post.bodyHtml,
        leadImage: post.image,
      };
      return { kind: 'parsed', record };
    },
  };
}

export interface MinhajOrgPersonOptions extends MinhajOrgFixedOptions {
  /** The profile pages' tids, as the catalogue lists them. */
  readonly tids: readonly string[];
}

/**
 * The person a profile page is about, from its title exactly as written:
 * "A Profile of NAME" or "NAME profile" give NAME; any other title is the name
 * as the page states it. Nothing else is inferred.
 */
export function profileName(title: string): string {
  const leading = /^A\s+Profile\s+of\s+(.+)$/i.exec(title);
  if (leading?.[1] !== undefined) return leading[1].trim();
  const trailing = /^(.+?)\s*[-–:]?\s*profile$/i.exec(title);
  if (trailing?.[1] !== undefined) return trailing[1].trim();
  return title;
}

export function createMinhajOrgPersonAdapter(
  options: MinhajOrgPersonOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_ORG_HOST);
  checkSelection(options.selection);
  if (!isSectionLanguage(options.language))
    throw new Error('language must be english, urdu or arabic');
  const sectionLanguage = options.language;
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  const tids = selectedTids(options.tids, options.items);

  return {
    adapterKey: MINHAJ_ORG_PERSON_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-org-person',
    parserVersion: '2',
    contentKind: 'people.person',
    accessMethod: 'http',
    discover: fixedItemDiscovery(
      base,
      tids.map((tid) => tidItem(base, sectionLanguage, tid)),
      options.selection.limit,
    ),
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const read = readPost(evidence, sectionLanguage);
      if (read.kind !== 'post') return read;
      const { post } = read;
      const record: ParsedPerson = {
        kind: 'people.person',
        name: profileName(post.title),
        title: post.title,
        primaryLocale: languageCode,
        languageCode,
        publishedOn: post.publishedOn,
        legacyIdentifier: `tid-${post.tid}`,
        categories: [],
        links: [],
        assets: post.assets,
        biographyHtml: post.bodyHtml,
        portrait: post.image,
      };
      return { kind: 'parsed', record };
    },
  };
}

/* ===========================================================================
 * Phase 30-RD: archive members and the curated archives themselves
 * ========================================================================= */

/** The category a `tid` page's address files it under, or null when none. */
function categoryOf(finalUrl: string): string | null {
  try {
    const match =
      /^\/(?:english|urdu|arabic)\/([^/]+)\/tid\/[1-9][0-9]{0,8}(?:\/|$)/.exec(
        new URL(finalUrl).pathname,
      );
    return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export interface MinhajOrgArchiveNewsOptions extends MinhajOrgFixedOptions {
  /** The catalogue's archive-member tids — the posts its Collections hold. */
  readonly tids: readonly string[];
}

/**
 * The news posts a catalogued curated archive holds, as `editorial.news` — a
 * fixed, reviewed list of `tid`s, never a crawl. Each is read exactly as the
 * listing sources read a post; its category is the one its own address files
 * it under ("Overseas", "Lahore" …), since no listing names it.
 */
export function createMinhajOrgArchiveNewsAdapter(
  options: MinhajOrgArchiveNewsOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_ORG_HOST);
  checkSelection(options.selection);
  if (!isSectionLanguage(options.language))
    throw new Error('language must be english, urdu or arabic');
  const sectionLanguage = options.language;
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  if (new Set(options.tids).size !== options.tids.length)
    throw new Error('a tid is listed twice');
  const tids = selectedTids(options.tids, options.items);

  return {
    adapterKey: MINHAJ_ORG_ARCHIVE_NEWS_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-org-editorial',
    parserVersion: '3',
    contentKind: 'editorial.news',
    accessMethod: 'http',
    discover: fixedItemDiscovery(
      base,
      tids.map((tid) => tidItem(base, sectionLanguage, tid)),
      options.selection.limit,
    ),
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const read = readPost(evidence, sectionLanguage);
      if (read.kind !== 'post') return read;
      const { post } = read;
      const category = categoryOf(evidence.finalUrl);
      const record: ParsedEditorial = {
        kind: 'editorial.news',
        title: post.title,
        primaryLocale: languageCode,
        languageCode,
        publishedOn: post.publishedOn,
        legacyIdentifier: `tid-${post.tid}`,
        categories: category === null ? [] : [{ key: category, label: category }],
        links: [],
        assets: post.assets,
        excerptHtml: null,
        bodyHtml: post.bodyHtml,
        leadImage: post.image,
      };
      return { kind: 'parsed', record };
    },
  };
}

/** A curated archive's path: `/{lang}/lkcatid/{n}/…`. */
const LKCATID_PATH = /^\/(english|urdu|arabic)\/lkcatid\/([1-9][0-9]{0,8})(?:\/|$)/;

/** The template's tail on every page description, which is not the description. */
const DESCRIPTION_TAIL = / by Minhaj-ul-Quran International\.$/;

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface MinhajOrgCollectionOptions extends MinhajOrgFixedOptions {
  /** The catalogue's curated archives, by `lkcatid` — never every category. */
  readonly archives: readonly string[];
}

/**
 * A source's own editor-curated archive (`/{lang}/lkcatid/{n}/`) as one
 * `editorial.collection` record: its title, its own description (the page's
 * meta description without the template's tail), and its members — every post
 * card in the main column's archive list, in document order, each under the
 * section heading (`h3`) and group heading (`h4`) above it.
 *
 * EXACT OR NOTHING. A card that links anywhere but a `tid` post of this site
 * in the archive's own language, an archive split over pages, or an empty one
 * is a parse failure — never a smaller Collection claimed as the archive.
 */
export function createMinhajOrgCollectionAdapter(
  options: MinhajOrgCollectionOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_ORG_HOST);
  checkSelection(options.selection);
  if (!isSectionLanguage(options.language))
    throw new Error('language must be english, urdu or arabic');
  const sectionLanguage = options.language;
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  const archives = selectedTids(options.archives, options.items);
  const catalogued = new Set(options.archives);

  return {
    adapterKey: MINHAJ_ORG_COLLECTION_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-org-collection',
    parserVersion: '1',
    contentKind: 'editorial.collection',
    accessMethod: 'http',
    discover: fixedItemDiscovery(
      base,
      archives.map((id) => {
        const externalKey = keyOf(base, `/${sectionLanguage}/lkcatid/${id}/`);
        return {
          externalKey,
          originalUrl: externalKey,
          legacyIdentifier: `lkcatid-${id}`,
        };
      }),
      options.selection.limit,
    ),
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const $ = loadHtml(decoded.html);
      let path: string;
      try {
        path = new URL(evidence.finalUrl).pathname;
      } catch {
        return { kind: 'failed', detail: 'final-url-invalid' };
      }
      const archive = LKCATID_PATH.exec(path);
      if (archive === null) return { kind: 'excluded', reason: 'not-an-archive-page' };
      if (archive[1] !== sectionLanguage)
        return { kind: 'failed', detail: 'language-conflict' };
      const id = archive[2] ?? '';
      if (!catalogued.has(id)) return { kind: 'excluded', reason: 'not-catalogued' };

      const heading = $('h1.page_title');
      if (heading.length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };
      const title = cleanText(heading.text());
      if (title.length === 0) return { kind: 'failed', detail: 'title-missing' };
      const main = heading.closest('.col');
      const list = main.find('.tb_widget_recent_list');
      if (main.length !== 1 || list.length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };
      if (main.find('ul.page-numbers').length > 0)
        return { kind: 'failed', detail: 'archive-paginated' };

      const members: { url: string; section: string | null; group: string | null }[] = [];
      let section: string | null = null;
      let group: string | null = null;
      let foreign = false;
      list
        .find('.widget_title h3, .widget_title h4, .item_content h4')
        .each((_index, element) => {
          const node = $(element);
          const card = node.closest('.item_content').length > 0;
          if (!card) {
            const text = cleanText(node.text());
            if (element.tagName === 'h3') {
              section = text.length > 0 ? text : null;
              group = null;
            } else group = text.length > 0 ? text : null;
            return;
          }
          const href = node.find('a[href]').first().attr('href') ?? '';
          let url: URL;
          try {
            url = new URL(href, evidence.finalUrl);
          } catch {
            foreign = true;
            return;
          }
          const tid = TID_PATH.exec(url.pathname);
          if (
            url.host !== MINHAJ_ORG_HOST ||
            tid === null ||
            tid[1] !== sectionLanguage
          ) {
            foreign = true;
            return;
          }
          members.push({
            url: tidItem(base, sectionLanguage, tid[2] ?? '').externalKey,
            section,
            group,
          });
        });
      if (foreign) return { kind: 'failed', detail: 'member-not-a-record' };
      if (members.length === 0) return { kind: 'failed', detail: 'archive-empty' };

      const described = cleanText($('meta[name="description"]').attr('content') ?? '');
      const record: ParsedCollection = {
        kind: 'editorial.collection',
        title,
        primaryLocale: languageCode,
        languageCode,
        publishedOn: null,
        legacyIdentifier: `lkcatid-${id}`,
        categories: [],
        links: [],
        assets: [],
        descriptionHtml: escapeText(described.replace(DESCRIPTION_TAIL, '')),
        members,
      };
      return { kind: 'parsed', record };
    },
  };
}
