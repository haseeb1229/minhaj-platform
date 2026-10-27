import type {
  DiscoveredItem,
  MigrationSourceAdapter,
  ParseResult,
  ParsedFatwa,
} from '@minhaj/contracts/migration';

import { cleanText, decodeHtml, loadHtml } from './html-source.ts';
import {
  asciiDigits,
  commentRanges,
  createListingDiscovery,
  endTagRange,
  innerRange,
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
 * THEFATWA.COM PUBLISHED RULINGS (MIGRATION_STRATEGY.md §3.1) — REVIEW-ONLY
 * material: preserved, normalised and reviewed as evidence, never published
 * by migration. The site is Urdu only.
 *
 *   discover — `/urdu/{listing}/`, then `/urdu/{listing}/page/{n}`; the site's
 *              sitemap names only its home page.
 *   key      — `https://thefatwa.com/urdu/questionID/{n}/`, the short form
 *              the site names canonical (`www.` redirects to the apex).
 *   parse    — inside `#UmairID`: the reference number, the question as the
 *              site published it, the category, the publication date, the
 *              answer from its `جواب:` marker to the share widget, and the
 *              mufti line where the page has one (older rulings have none).
 *
 * PERSONAL DATA, FAIL CLOSED. Every ruling page names its asker and their
 * town (`سائل:` / `مقام:`) in the first `ul.featureInfo`. That block is never
 * read: no field is taken from it, and every `ul.featureInfo` is cut out of
 * any slice that could reach it. The Facebook comment widget is ignored.
 *
 * TITLE. The site's own short title of the ruling — the page `<title>` /
 * `og:title` less the site-name suffix, the same words its listings show —
 * else the question heading's text.
 */

export const THEFATWA_ADAPTER_KEY = 'thefatwa-ruling';
export const THEFATWA_BASE_URL = 'https://thefatwa.com/';
/** The apex only: every link the adapter follows is on it. */
export const THEFATWA_HOST = 'thefatwa.com';
export const THEFATWA_HOSTS: readonly string[] = Object.freeze([THEFATWA_HOST]);

export const THEFATWA_LISTINGS = Object.freeze(['latest', 'ImportantQuestions'] as const);
export type TheFatwaListing = (typeof THEFATWA_LISTINGS)[number];

const QUESTION_PATH = /^\/urdu\/questionID\/([1-9][0-9]{0,8})(?:\/|$)/;
const CATEGORY_PATH = /^\/urdu\/cat\/([1-9][0-9]{0,8})(?:\/|$)/;
const SITE_TITLE_SUFFIX = / - فتویٰ آن لائن$/;
const REFERENCE = /سوال نمبر\s*:\s*([0-9]{1,9})/;
const ANSWER_MARKER = /^جواب\s*:$/;
const PUBLISHED_LABEL = 'تاریخ اشاعت';
const MUFTI_LABEL = /^مفتی\s*:\s*/;
/** The asker's label. Its presence in any parsed field refuses the page. */
const ASKER_LABEL = /سائل\s*:/;

export interface TheFatwaAdapterOptions {
  /** `https://thefatwa.com/`. */
  readonly baseUrl: string;
  readonly selection: SourceSelection;
  readonly listing: TheFatwaListing;
}

export function createTheFatwaAdapter(
  options: TheFatwaAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, THEFATWA_HOST);
  checkSelection(options.selection);
  const { selection } = options;
  if (!(THEFATWA_LISTINGS as readonly string[]).includes(options.listing))
    throw new Error('listing must be latest or ImportantQuestions');
  const listingPath = `/urdu/${options.listing}/`;

  const discover = createListingDiscovery({
    base,
    selection,
    listingUrl: (page) =>
      new URL(page === 1 ? listingPath : `${listingPath}page/${page}`, base).toString(),
    readListing($, finalUrl) {
      const list = $('ul.listService');
      if (list.length !== 1) return null;
      const hrefs: string[] = [];
      list.find('.listWrpService.featured-wrap h3 > a[href]').each((_index, element) => {
        hrefs.push($(element).attr('href') ?? '');
      });
      const pagination: string[] = [];
      $('ul.pagination a[href]').each((_index, element) => {
        pagination.push($(element).attr('href') ?? '');
      });
      return { hrefs, pageLinks: pageNumbersOf(pagination, finalUrl, base, listingPath) };
    },
    itemOf(url): DiscoveredItem | null {
      const match = QUESTION_PATH.exec(url.pathname);
      if (match === null) return null;
      const externalKey = keyOf(base, `/urdu/questionID/${match[1]}/`);
      return { externalKey, originalUrl: externalKey, legacyIdentifier: `q-${match[1]}` };
    },
  });

  return {
    adapterKey: THEFATWA_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-thefatwa-ruling',
    parserVersion: '1',
    contentKind: 'fatwa.ruling',
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
      const question = QUESTION_PATH.exec(path);
      if (question === null) return { kind: 'excluded', reason: 'not-a-fatwa' };

      const block = $('#UmairID');
      if (block.length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };

      // The reference heading: "سوال نمبر:{n}" and the question beneath it.
      const heading = block
        .find('h3')
        .filter((_index, element) =>
          REFERENCE.test(asciiDigits(cleanText($(element).text()))),
        )
        .first();
      const reference = REFERENCE.exec(asciiDigits(cleanText(heading.text())))?.[1];
      if (reference === undefined) return { kind: 'failed', detail: 'reference-missing' };
      if (reference !== question[1])
        return { kind: 'failed', detail: 'reference-conflict' };

      // Every `ul.featureInfo` (the asker's block among them) and every comment
      // is cut out of any slice taken from the page.
      const personal: SourceRange[] = commentRanges($.root().get(0));
      $('ul.featureInfo').each((_index, element) => {
        const range = outerRange(element);
        if (range !== null) personal.push(range);
      });

      const questionSpan = heading.children('span').first();
      const questionRegion = innerRange(questionSpan.get(0));
      const questionHtml =
        questionRegion === null
          ? ''
          : sliceExcluding(html, questionRegion, personal).trim();
      if (questionHtml.length === 0)
        return { kind: 'failed', detail: 'question-missing' };

      const pageTitle = cleanText(
        $('meta[property="og:title"]').attr('content') ?? $('title').first().text(),
      );
      const title = SITE_TITLE_SUFFIX.test(pageTitle)
        ? cleanText(pageTitle.replace(SITE_TITLE_SUFFIX, ''))
        : cleanText(questionSpan.text());
      if (title.length === 0) return { kind: 'failed', detail: 'title-missing' };

      // Only the item that carries the publication label is read; the asker's
      // item is never touched.
      const published = block
        .find('ul.featureInfo li')
        .filter((_index, element) =>
          cleanText($(element).text()).startsWith(PUBLISHED_LABEL),
        )
        .first();
      const publishedOn =
        published.length === 1
          ? writtenDateOf(cleanText(published.text()).replace(/^[^:]*:/, ''))
          : null;

      const categories: { key: string; label: string }[] = [];
      block.find('h4 a[href^="/urdu/cat/"]').each((_index, element) => {
        const key = CATEGORY_PATH.exec($(element).attr('href') ?? '')?.[1];
        const label = cleanText($(element).text());
        if (key !== undefined && label.length > 0) categories.push({ key, label });
      });

      const jobDetail = $('.jobdetail').first();
      const scope = jobDetail.length === 1 ? jobDetail : block;
      const muftiHeading = scope
        .find('h3')
        .filter(
          (_index, element) => $(element).children('a[href^="/urdu/mufti/"]').length > 0,
        )
        .first();
      const mufti = cleanText(muftiHeading.children('a').first().text()).replace(
        MUFTI_LABEL,
        '',
      );
      const attributedTo = mufti.length === 0 ? null : mufti;

      // THE ANSWER: from the جواب: marker (and its line break) to the first of
      // the mufti line, the institutional note, the share widget, the print
      // button, the comment widget or the related questions — whichever the
      // page has first.
      const marker = scope
        .find('b')
        .filter((_index, element) => ANSWER_MARKER.test(cleanText($(element).text())))
        .first();
      const markerRange = outerRange(marker.get(0));
      if (markerRange === null) return { kind: 'failed', detail: 'answer-missing' };
      const lineBreak = /^\s*<br\s*\/?>/i.exec(html.slice(markerRange.end));
      const start = markerRange.end + (lineBreak?.[0].length ?? 0);
      const ends: number[] = [];
      const endAt = (selection: ReturnType<typeof $>) => {
        selection.each((_index, element) => {
          const range = outerRange(element);
          if (range !== null && range.start >= start) ends.push(range.start);
        });
      };
      endAt(muftiHeading);
      endAt(
        $('h3')
          .filter((_index, element) =>
            cleanText($(element).text()).includes('مفتی تعارف'),
          )
          .parent(),
      );
      endAt($('div.a2a_kit'));
      endAt($('.fb-comments'));
      endAt($('div.read-btn'));
      endAt($('ul.papu-post'));
      if (ends.length === 0) return { kind: 'failed', detail: 'answer-end-missing' };
      const region: SourceRange = { start, end: Math.min(...ends) };

      const excluded: SourceRange[] = [...personal];
      $('.fb-comments, .a2a_kit').each((_index, element) => {
        const range = outerRange(element);
        if (range !== null) excluded.push(range);
      });
      const blockEnd = endTagRange(block.get(0));
      if (blockEnd !== null) excluded.push(blockEnd);
      const answerHtml = sliceExcluding(html, region, excluded).trim();
      if (answerHtml.length === 0) return { kind: 'failed', detail: 'answer-missing' };

      // Fail closed: the asker's label never survives into any field.
      if (
        [title, questionHtml, answerHtml, attributedTo ?? ''].some((text) =>
          ASKER_LABEL.test(text),
        )
      )
        return { kind: 'failed', detail: 'personal-data-marker' };

      const record: ParsedFatwa = {
        kind: 'fatwa.ruling',
        title,
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn,
        legacyIdentifier: `q-${question[1]}`,
        categories,
        links: [],
        assets: [],
        questionHtml,
        answerHtml,
        sourceReference: reference,
        attributedTo,
      };
      return { kind: 'parsed', record };
    },
  };
}
