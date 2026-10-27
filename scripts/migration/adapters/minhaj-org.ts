import type {
  DiscoveredItem,
  MigrationSourceAdapter,
  ParseResult,
  ParsedEditorial,
} from '@minhaj/contracts/migration';

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
  retrieveOnce,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * MINHAJ.ORG NEWS AND ARTICLES (MIGRATION_STRATEGY.md §3.1) — one language
 * section's listing of one kind, everything that knows the site's markup in
 * one place.
 *
 *   discover — the section's paginated listing, `/{lang}/{section}/` then
 *              `/{lang}/{section}/page/{n}/`, item cards taken from the MAIN
 *              column only (the sidebar carries its own dated widgets). The
 *              site's sitemap is a 404 and its feeds are dead.
 *   key      — the numeric `tid`: `https://www.minhaj.org/{lang}/tid/{n}/`,
 *              the short form the site itself serves and names canonical,
 *              whatever slug or section a listing link carried.
 *   parse    — `article.post`: the title, the machine date, and the body as
 *              exact source minus the template's chrome (title, date line,
 *              like and share widgets, comments). Language comes from the
 *              URL section; `<html lang>` on this site is always English.
 *
 * Body images live on another host (minhaj.net) and are not acquired here.
 */

export const MINHAJ_ORG_EDITORIAL_ADAPTER_KEY = 'minhaj-org-editorial';
export const MINHAJ_ORG_BASE_URL = 'https://www.minhaj.org/';
/** The hosts a minhaj.org source registers: listing and item links stay on www. */
export const MINHAJ_ORG_HOST = 'www.minhaj.org';
export const MINHAJ_ORG_HOSTS: readonly string[] = Object.freeze([MINHAJ_ORG_HOST]);

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

const TID_PATH = /^\/(english|urdu|arabic)\/(?:[^/]+\/)?tid\/([1-9][0-9]{0,8})(?:\/|$)/;

function isSectionLanguage(value: string | undefined): value is SectionLanguage {
  return value === 'english' || value === 'urdu' || value === 'arabic';
}

export interface MinhajOrgEditorialAdapterOptions {
  /** `https://www.minhaj.org/`. */
  readonly baseUrl: string;
  readonly selection: SourceSelection;
  readonly kind: 'editorial.news' | 'editorial.article';
  /** The listing segment, e.g. `News-Events` or `Articles`. */
  readonly section: string;
  readonly language: SectionLanguage;
}

export function createMinhajOrgEditorialAdapter(
  options: MinhajOrgEditorialAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_ORG_HOST);
  checkSelection(options.selection);
  const { selection } = options;
  const section = checkSegment('section', options.section);
  if (!isSectionLanguage(options.language))
    throw new Error('language must be english, urdu or arabic');
  if (options.kind !== 'editorial.news' && options.kind !== 'editorial.article')
    throw new Error('kind must be editorial.news or editorial.article');
  const { kind } = options;
  const sectionLanguage = options.language;
  const languageCode = SECTION_LANGUAGES[sectionLanguage];
  const listingPath = `/${sectionLanguage}/${section}/`;

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
        .find('.layout_post_2 .item_content h4 a[href], .tb_widget_articles li > a[href]')
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
      const externalKey = keyOf(base, `/${sectionLanguage}/tid/${match[2]}/`);
      return {
        externalKey,
        originalUrl: externalKey,
        legacyIdentifier: `tid-${match[2]}`,
      };
    },
  });

  return {
    adapterKey: MINHAJ_ORG_EDITORIAL_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-org-editorial',
    parserVersion: '1',
    contentKind: kind,
    accessMethod: 'http',
    discover,
    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
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
      if (tid[1] !== sectionLanguage)
        return { kind: 'failed', detail: 'language-conflict' };

      const article = $('article.post');
      if (article.length !== 1) {
        if ($('h1.page_title').length > 0)
          return { kind: 'excluded', reason: 'not-an-editorial-post' };
        return { kind: 'failed', detail: 'record-structure-missing' };
      }
      const content = article.find('div.entry_content').first();
      if (content.length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };

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
      const bodyHtml = sliceExcluding(html, region, excluded).trim();
      if (bodyHtml.length === 0) return { kind: 'failed', detail: 'body-missing' };

      const record: ParsedEditorial = {
        kind,
        title,
        primaryLocale: languageCode,
        languageCode,
        publishedOn,
        legacyIdentifier: `tid-${tid[2]}`,
        categories: [{ key: section, label: section }],
        links: [],
        assets: [],
        excerptHtml: null,
        bodyHtml,
      };
      return { kind: 'parsed', record };
    },
  };
}
