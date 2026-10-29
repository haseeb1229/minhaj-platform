import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  ASSET_LICENCES,
  canonicalSourceUrl,
  checkSourceUrl,
  isFixtureHost,
  type AssetLicence,
  type DiscoveredItem,
  type FetchOutcome,
  type MigrationFetchPort,
  type MigrationSourceAdapter,
  type ParseResult,
  type ParsedVideo,
  type PendingItem,
  type RetrievedEvidence,
} from '@minhaj/contracts/migration';

import { cleanText, decodeHtml, innerSource, loadHtml } from './html-source.ts';

/**
 * THE FIXTURE VIDEO ADAPTER (MIGRATION_STRATEGY.md §3.2) — everything that
 * knows the synthetic legacy video site's markup, in one place.
 *
 *   discover — one index page per call; the cursor is the next page number.
 *              Links outside the source's own host are not queued (§4.1:
 *              never follow links outside the authorised scope). An index the
 *              adapter cannot recognise is a REFUSAL, never an empty page: an
 *              empty page would end discovery as complete and mark every
 *              record missing.
 *   retrieve — one GET of the record URL through the given fetcher; anything
 *              but a 200 is handed back as the outcome for the pipeline to
 *              classify and, where transient, retry.
 *   parse    — Cheerio over the evidence bytes; untrusted markup is passed on
 *              exactly as written (sanitisation is normalisation's job).
 *
 * It persists nothing, decides nothing about review, and never reaches a
 * database.
 */

export const FIXTURE_VIDEO_ADAPTER_KEY = 'fixture-video';
export const FIXTURE_VIDEO_DEFAULT_BASE_URL = 'http://videos.fixture.invalid/';

const INDEX_PATH = 'videos/index.html';
const CURSOR_PATTERN = /^[1-9][0-9]{0,5}$/;

function isLocale(value: string | undefined): value is Locale {
  return localeSchema.safeParse(value).success;
}

function licenceOf(value: string | undefined): AssetLicence {
  return (ASSET_LICENCES as readonly string[]).includes(value ?? '')
    ? (value as AssetLicence)
    : 'unknown';
}

function nonEmpty(value: string | undefined): string | null {
  const text = cleanText(value ?? '');
  return text.length === 0 ? null : text;
}

function unrecognisedIndex(requestedUrl: string): FetchOutcome {
  return {
    kind: 'refused',
    classification: 'unsupported-type',
    requestedUrl,
    detail: 'index-unrecognised',
  };
}

export interface FixtureVideoAdapterOptions {
  /** The source's base URL; a `*.fixture.invalid` host. */
  readonly baseUrl?: string;
}

export function createFixtureVideoAdapter(
  options: FixtureVideoAdapterOptions = {},
): MigrationSourceAdapter {
  const baseText = options.baseUrl ?? FIXTURE_VIDEO_DEFAULT_BASE_URL;
  const base = new URL(baseText);
  if (
    !isFixtureHost(base.hostname) ||
    !checkSourceUrl(baseText, [base.hostname]).ok ||
    !base.pathname.endsWith('/')
  )
    throw new Error('the fixture video adapter serves a *.fixture.invalid base URL only');

  return {
    adapterKey: FIXTURE_VIDEO_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-fixture-video',
    parserVersion: '1',
    contentKind: 'media.video',
    accessMethod: 'http',

    async discover(cursor: string | null, fetcher: MigrationFetchPort) {
      if (cursor !== null && !CURSOR_PATTERN.test(cursor))
        throw new Error('invalid discovery cursor');
      const page = cursor === null ? 1 : Number(cursor);
      const url = new URL(INDEX_PATH, base);
      url.searchParams.set('page', String(page));
      const outcome = await fetcher.fetch(url.toString());
      if (outcome.kind !== 'response' || outcome.status !== 200)
        return { kind: 'outcome', outcome } as const;

      const decoded = decodeHtml(outcome.body, outcome.contentType);
      if (!decoded.ok)
        return {
          kind: 'outcome',
          outcome: unrecognisedIndex(outcome.requestedUrl),
        } as const;
      const $ = loadHtml(decoded.html);
      const list = $('ul.video-index');
      if (list.length !== 1)
        return {
          kind: 'outcome',
          outcome: unrecognisedIndex(outcome.requestedUrl),
        } as const;

      const items: DiscoveredItem[] = [];
      const seen = new Set<string>();
      list.find('a.video-link[href]').each((_index, element) => {
        let target: URL;
        try {
          target = new URL($(element).attr('href') ?? '', outcome.finalUrl);
        } catch {
          return;
        }
        if (
          target.hostname !== base.hostname ||
          (target.protocol !== 'http:' && target.protocol !== 'https:')
        )
          return;
        const externalKey = canonicalSourceUrl(target);
        if (seen.has(externalKey)) return;
        seen.add(externalKey);
        items.push({
          externalKey,
          originalUrl: externalKey,
          legacyIdentifier: nonEmpty(
            $(element).closest('[data-legacy-id]').attr('data-legacy-id'),
          ),
        });
      });

      let next: string | null = null;
      const nextHref = $('nav.pagination a[rel="next"][href]').attr('href');
      if (nextHref !== undefined) {
        try {
          const nextPage =
            new URL(nextHref, outcome.finalUrl).searchParams.get('page') ?? '';
          if (CURSOR_PATTERN.test(nextPage) && Number(nextPage) > page) next = nextPage;
          else
            return {
              kind: 'outcome',
              outcome: unrecognisedIndex(outcome.requestedUrl),
            } as const;
        } catch {
          return {
            kind: 'outcome',
            outcome: unrecognisedIndex(outcome.requestedUrl),
          } as const;
        }
      }
      return { kind: 'page', items, next } as const;
    },

    async retrieve(
      item: PendingItem,
      fetcher: MigrationFetchPort,
    ): Promise<RetrievedEvidence> {
      const outcome = await fetcher.fetch(item.originalUrl ?? item.externalKey);
      if (outcome.kind !== 'response' || outcome.status !== 200)
        return { kind: 'outcome', outcome };
      return {
        kind: 'evidence',
        requestedUrl: outcome.requestedUrl,
        finalUrl: outcome.finalUrl,
        httpStatus: outcome.status,
        contentType: outcome.contentType,
        headers: outcome.headers,
        body: outcome.body,
      };
    },

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const html = decoded.html;
      const $ = loadHtml(html);

      const article = $('article[data-kind]');
      if (article.length !== 1)
        return { kind: 'failed', detail: 'record-structure-missing' };
      const kind = article.attr('data-kind');
      if (kind !== 'video') return { kind: 'excluded', reason: 'not-a-video' };

      const heading = article.find('h1.video-title');
      const title = cleanText(heading.text());
      const primaryLocale = heading.attr('data-locale');
      if (heading.length !== 1 || title.length === 0)
        return { kind: 'failed', detail: 'title-missing' };
      if (!isLocale(primaryLocale))
        return { kind: 'failed', detail: 'primary-locale-invalid' };

      const field = (name: string) =>
        nonEmpty(article.find(`[data-field="${name}"]`).first().text());
      const published = nonEmpty(
        article.find('time[data-field="published"]').attr('datetime'),
      );
      const secondsText =
        article.find('[data-field="duration"]').attr('data-seconds') ?? '';
      const durationSeconds = /^[0-9]{1,9}$/.test(secondsText)
        ? Number(secondsText)
        : null;

      const labels: { locale: Locale; title: string; descriptionHtml: string }[] = [];
      article.find('section.video-variant').each((_index, element) => {
        const variant = $(element);
        const locale = variant.attr('data-locale');
        const variantTitle = cleanText(variant.find('.variant-title').first().text());
        if (!isLocale(locale) || variantTitle.length === 0) return;
        labels.push({
          locale,
          title: variantTitle,
          descriptionHtml: innerSource(
            html,
            variant.find('.variant-description').first(),
          ),
        });
      });

      const categories: { key: string; label: string }[] = [];
      article.find('[data-category]').each((_index, element) => {
        const key = nonEmpty($(element).attr('data-category'));
        const label = nonEmpty($(element).text());
        if (key !== null && label !== null) categories.push({ key, label });
      });

      // Every href of the description regions, in document order, as written.
      const links: string[] = [];
      article.find('[data-region="description"] a[href]').each((_index, element) => {
        links.push($(element).attr('href') ?? '');
      });

      const assets: ParsedVideo['assets'][number][] = [];
      article.find('a.asset[href]').each((_index, element) => {
        const anchor = $(element);
        let url: URL;
        try {
          url = new URL(anchor.attr('href') ?? '', evidence.finalUrl);
        } catch {
          return;
        }
        assets.push({
          url: url.toString(),
          licence: licenceOf(anchor.attr('data-licence')),
          licenceEvidence: nonEmpty(anchor.attr('data-licence-evidence')),
          rightsHolder: nonEmpty(anchor.attr('data-rights-holder')),
        });
      });

      const record: ParsedVideo = {
        kind: 'media.video',
        title,
        primaryLocale,
        languageCode: field('language'),
        provider: field('provider'),
        providerReference: field('provider-ref'),
        labels,
        descriptionHtml: innerSource(
          html,
          article.find('section.video-description').first(),
        ),
        publishedOn: published,
        durationSeconds,
        legacyIdentifier: nonEmpty(article.attr('data-legacy-id')),
        categories,
        links,
        assets,
        poster: null,
      };
      return { kind: 'parsed', record };
    },
  };
}
