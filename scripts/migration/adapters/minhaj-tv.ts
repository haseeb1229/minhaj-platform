import type {
  DiscoveredItem,
  MigrationSourceAdapter,
  ParseResult,
  ParsedVideo,
} from '@minhaj/contracts/migration';

import { cleanText, decodeHtml, loadHtml } from './html-source.ts';
import {
  checkSegment,
  createListingDiscovery,
  innerRange,
  keyOf,
  pageNumbersOf,
  writtenDateOf,
} from './markup-support.ts';
import {
  checkSelection,
  retrieveOnce,
  scriptLocale,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * MINHAJ.TV VIDEO METADATA (MIGRATION_STRATEGY.md §3.1: metadata only, never
 * a video file) — one speeches listing of the `/english/` interface, the only
 * interface robots.txt permits (`/urdu` is disallowed).
 *
 *   discover — `/english/{listing}/`, then `/english/{listing}/page/{n}/`;
 *              only `/english/video/{id}/…` cards of the main column are
 *              queued. Audio speeches are another kind and are never queued.
 *   key      — `https://www.minhaj.tv/english/video/{id}/{Slug}.html`, the
 *              form every listing, canonical link and og:url names.
 *   parse    — the provider reference is the YouTube id of the video tab's
 *              embed, scoped to `#VideoTabsContent` (the footer carries a
 *              constant YouTube embed on every page). A video page with no
 *              YouTube embed is still PARSED, with a null provider, so that
 *              validation rejects it visibly rather than it vanishing.
 *
 * LANGUAGE. The speech language is no field of the page; the only explicit
 * signal is a language category (`English-Speeches`, `Urdu-Speeches`,
 * `Arabic-Speeches`) in the Category row. Subtitle categories say nothing of
 * the speech. No signal: `null`, and the source's default applies.
 *
 * PRIMARY LOCALE is the locale of the TITLE as written, by the shared
 * `scriptLocale` rule: a Latin-only title is `en` (the English interface's
 * romanised titles); an Arabic-script-only title takes the speech language
 * when that is `ur` or `ar`; anything else is refused
 * (`primary-locale-undetermined`) rather than guessed.
 */

export const MINHAJ_TV_VIDEO_ADAPTER_KEY = 'minhaj-tv-video';
export const MINHAJ_TV_BASE_URL = 'https://www.minhaj.tv/';
export const MINHAJ_TV_HOST = 'www.minhaj.tv';
export const MINHAJ_TV_HOSTS: readonly string[] = Object.freeze([MINHAJ_TV_HOST]);

const VIDEO_PATH = /^\/english\/video\/([1-9][0-9]{0,8})\/([^/]+\.html)$/;
const AUDIO_PATH = /^\/english\/audio\//;
const YOUTUBE_EMBED =
  /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})(?:[?#/&]|$)/;

/** Category slugs that state the speech language. */
const LANGUAGE_CATEGORIES: Readonly<Record<string, 'en' | 'ur' | 'ar'>> = {
  'English-Speeches': 'en',
  'Urdu-Speeches': 'ur',
  'Arabic-Speeches': 'ar',
};

/** `77 Minutes`, `1 Hour 5 Minutes`, `1:05:00`, `45:30` — else null. */
export function durationSecondsOf(text: string): number | null {
  const value = text.trim();
  let match = /^([0-9]{1,4})\s*(?:minutes?|mins?)\.?$/i.exec(value);
  if (match) return Number(match[1]) * 60 || null;
  match =
    /^([0-9]{1,3})\s*(?:hours?|hrs?)(?:\s*(?:and\s*)?([0-9]{1,2})\s*(?:minutes?|mins?))?\.?$/i.exec(
      value,
    );
  if (match) return Number(match[1]) * 3600 + Number(match[2] ?? 0) * 60 || null;
  match = /^([0-9]{1,3}):([0-5][0-9]):([0-5][0-9])$/.exec(value);
  if (match)
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) || null;
  match = /^([0-9]{1,3}):([0-5][0-9])$/.exec(value);
  if (match) return Number(match[1]) * 60 + Number(match[2]) || null;
  return null;
}

export interface MinhajTvVideoAdapterOptions {
  /** `https://www.minhaj.tv/`. */
  readonly baseUrl: string;
  readonly selection: SourceSelection;
  /** The `/english/` listing segment, e.g. `Latest-Speeches` or `English-Speeches`. */
  readonly listing: string;
}

export function createMinhajTvVideoAdapter(
  options: MinhajTvVideoAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(options.baseUrl, MINHAJ_TV_HOST);
  checkSelection(options.selection);
  const { selection } = options;
  const listing = checkSegment('listing', options.listing);
  const listingPath = `/english/${listing}/`;

  const discover = createListingDiscovery({
    base,
    selection,
    listingUrl: (page) =>
      new URL(page === 1 ? listingPath : `${listingPath}page/${page}/`, base).toString(),
    readListing($, finalUrl) {
      const main = $('.main-content').first();
      const grid = main.children('.video-section');
      if (main.length !== 1 || grid.length === 0) return null;
      const hrefs: string[] = [];
      grid.find('.item h3 > a[href]').each((_index, element) => {
        hrefs.push($(element).attr('href') ?? '');
      });
      const pagination: string[] = [];
      main.find('ul.pagination a[href]').each((_index, element) => {
        pagination.push($(element).attr('href') ?? '');
      });
      return { hrefs, pageLinks: pageNumbersOf(pagination, finalUrl, base, listingPath) };
    },
    itemOf(url): DiscoveredItem | null {
      const match = VIDEO_PATH.exec(url.pathname);
      if (match === null) return null;
      const externalKey = keyOf(base, `/english/video/${match[1]}/${match[2]}`);
      return {
        externalKey,
        originalUrl: externalKey,
        legacyIdentifier: `mtv-${match[1]}`,
      };
    },
  });

  return {
    adapterKey: MINHAJ_TV_VIDEO_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-minhaj-tv-video',
    parserVersion: '1',
    contentKind: 'media.video',
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
      if (AUDIO_PATH.test(path)) return { kind: 'excluded', reason: 'not-a-video' };
      const video = VIDEO_PATH.exec(path);
      if (video === null) return { kind: 'excluded', reason: 'not-a-video-page' };

      const title = cleanText($('.video-info h1').first().text());
      if (title.length === 0) return { kind: 'failed', detail: 'title-missing' };
      const rows = $('.video-details .post-entry > div.col');
      if (rows.length === 0)
        return { kind: 'failed', detail: 'record-structure-missing' };

      // Rows read "Label: value"; the first row of each label wins.
      const fields = new Map<string, typeof rows>();
      rows.each((index) => {
        const row = rows.eq(index);
        const label = /^([A-Za-z][A-Za-z ]{0,30}?)\s*:/.exec(cleanText(row.text()))?.[1];
        if (label !== undefined && !fields.has(label.toLowerCase()))
          fields.set(label.toLowerCase(), row);
      });
      const valueOf = (label: string): string | null => {
        const row = fields.get(label);
        return row === undefined ? null : cleanText(row.text()).replace(/^[^:]*:\s*/, '');
      };

      const embed = $('#VideoTabsContent #youtube-tab iframe[src*="youtube.com/embed/"]')
        .first()
        .attr('src');
      const youtubeId = YOUTUBE_EMBED.exec(embed ?? '')?.[1] ?? null;

      const categories: { key: string; label: string }[] = [];
      fields
        .get('category')
        ?.find('a[href]')
        .each((_index, element) => {
          let categoryPath: string;
          try {
            categoryPath = new URL($(element).attr('href') ?? '', evidence.finalUrl)
              .pathname;
          } catch {
            return;
          }
          const key = /^\/english\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/.exec(
            categoryPath,
          )?.[1];
          const label = cleanText($(element).text());
          if (key !== undefined && label.length > 0) categories.push({ key, label });
        });

      const languages = new Set(
        categories.flatMap(({ key }) => {
          const language = LANGUAGE_CATEGORIES[key];
          return language === undefined ? [] : [language];
        }),
      );
      if (languages.size > 1) return { kind: 'failed', detail: 'language-conflict' };
      const languageCode = [...languages][0] ?? null;

      const primaryLocale = scriptLocale(title, languageCode);
      if (primaryLocale === null)
        return { kind: 'failed', detail: 'primary-locale-undetermined' };

      // The description is the Description row after its label (and line break).
      let descriptionHtml = '';
      const descriptionRow = fields.get('description');
      const region =
        descriptionRow === undefined ? null : innerRange(descriptionRow.get(0));
      if (region !== null) {
        const inner = html.slice(region.start, region.end);
        const label = /Description\s*:\s*(?:<br\s*\/?>)?/i.exec(inner);
        if (label !== null)
          descriptionHtml = inner.slice(label.index + label[0].length).trim();
      }

      const duration = valueOf('duration');
      const record: ParsedVideo = {
        kind: 'media.video',
        title,
        primaryLocale,
        languageCode,
        provider: youtubeId === null ? null : 'youtube',
        providerReference: youtubeId,
        labels: [],
        descriptionHtml,
        publishedOn: writtenDateOf(valueOf('dated') ?? undefined),
        durationSeconds: duration === null ? null : durationSecondsOf(duration),
        legacyIdentifier: `mtv-${video[1]}`,
        categories,
        links: [],
        assets: [],
      };
      return { kind: 'parsed', record };
    },
  };
}
