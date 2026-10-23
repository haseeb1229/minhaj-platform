import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { AssetLicence } from '@minhaj/contracts/migration';

import type { FixtureEndpoint } from './safe-fetch.ts';

/**
 * THE LOCAL FIXTURE SOURCE — a deterministic, entirely synthetic "legacy video
 * site" for engineering proof (MIGRATION_STRATEGY.md §1.2: no live legacy
 * access of any kind).
 *
 * It listens on 127.0.0.1 only, on an ephemeral port, and answers by `Host`:
 * `videos.fixture.invalid` (the source) and `archive.fixture.invalid` (a
 * second synthetic host, for cross-source duplicates and out-of-scope
 * redirects). `.invalid` never resolves in public DNS; only the fixture
 * resolver in `safe-fetch.ts` maps these names here. Every text is marked
 * FIXTURE, every address `example.invalid`, every provider id synthetic but
 * valid-shaped.
 *
 * `control` switches deterministic behaviours on and off — status overrides,
 * 429 with any Retry-After, slow and oversized responses, redirect chains,
 * content revisions, disappearance, hostile markup, synthetic personal data,
 * hard and folded-title duplicates — and counts requests per path so retry
 * and politeness behaviour can be asserted exactly.
 */

export const FIXTURE_VIDEO_HOST = 'videos.fixture.invalid';
export const FIXTURE_ARCHIVE_HOST = 'archive.fixture.invalid';
export const FIXTURE_BASE_URL = `http://${FIXTURE_VIDEO_HOST}/`;
export const FIXTURE_ARCHIVE_BASE_URL = `http://${FIXTURE_ARCHIVE_HOST}/`;

/** Videos every corpus carries, before any optional record is enabled. */
export const FIXTURE_BASE_VIDEO_COUNT = 12;

/** Retry-After values worth exercising: one per class the pipeline handles. */
export const FIXTURE_RETRY_AFTER = Object.freeze({
  seconds: '2',
  httpDate: 'Fri, 23 Oct 2026 10:00:00 GMT',
  malformed: 'soon, perhaps',
  negative: '-5',
  absurd: '99999999',
});

/** Synthetic personal-data placeholders (MIGRATION_STRATEGY.md §8.3). */
export const FIXTURE_PERSONAL_EMAIL = 'fixture.person@example.invalid';
export const FIXTURE_PERSONAL_PHONE = '+92 300 0000000';

/**
 * Every hostile construct the sanitiser must neutralise, as the source page
 * carries it. Inert even if rendered: scripts only touch a fixture global and
 * every external address is `example.invalid`.
 */
export const FIXTURE_HOSTILE_HTML = [
  '<p>FIXTURE hostile payload record.</p>',
  '<script>window.__fixtureHostile = 1;</script>',
  '<img src="/files/poster-v001.png" onerror="window.__fixtureHostile = 2" alt="FIXTURE">',
  '<a href="javascript:void(0)">FIXTURE script link</a>',
  '<a href="data:text/html;base64,PHA+RklYVFVSRTwvcD4=">FIXTURE data link</a>',
  '<a href="https://external.example.invalid/ok" onclick="window.__fixtureHostile = 3">FIXTURE external</a>',
  '<meta http-equiv="refresh" content="0;url=https://external.example.invalid/">',
  '<svg><animate attributeName="href" values="javascript:void(0)"></animate><set attributeName="onmouseover" to="void(0)"></set></svg>',
  '<object data="/files/guide.pdf"></object><embed src="/files/guide.pdf">',
  '<form action="https://external.example.invalid/collect"><input name="q"></form>',
  '<iframe src="https://external.example.invalid/frame"></iframe>',
  '<noscript><p>FIXTURE noscript region</p></noscript>',
  '<style>p { color: red }</style>',
  '<p style="position:fixed">FIXTURE styled text</p>',
].join('\n');

/** Optional records, each switched on by name. */
export const FIXTURE_FEATURES = Object.freeze([
  'hostile',
  'personal-data',
  'duplicates',
  'title-duplicates',
  'not-a-video',
  'malformed',
] as const);
export type FixtureFeature = (typeof FIXTURE_FEATURES)[number];

type FixtureLocale = 'en' | 'ur' | 'ar';

export interface FixtureAsset {
  readonly name: string;
  readonly licence: AssetLicence;
  readonly licenceEvidence: string | null;
  readonly rightsHolder: string | null;
}

/** One synthetic legacy page, as the generator models it. */
export interface FixtureRecord {
  readonly id: string;
  readonly host: string;
  readonly kind: 'video' | 'article' | 'malformed';
  readonly primaryLocale: FixtureLocale;
  readonly languageCode: string;
  readonly titles: Readonly<Record<FixtureLocale, string>>;
  readonly descriptions: Readonly<Record<FixtureLocale, string>>;
  readonly provider: 'youtube' | 'vimeo';
  readonly providerReference: string;
  readonly categories: readonly { readonly key: string; readonly label: string }[];
  readonly publishedOn: string;
  readonly durationSeconds: number;
  readonly assets: readonly FixtureAsset[];
}

/* ===========================================================================
 * The synthetic corpus
 * ========================================================================= */

const pad = (value: number, width: number) => String(value).padStart(width, '0');

const LOCALE_CYCLE = ['ar', 'ur', 'en'] as const satisfies readonly FixtureLocale[];

const CATEGORY_LECTURES = { key: 'fixture-lectures', label: 'FIXTURE Lectures' };
const CATEGORY_SPIRITUALITY = {
  key: 'fixture-spirituality',
  label: 'FIXTURE Spirituality',
};
const CATEGORY_YOUTH = { key: 'fixture-youth', label: 'FIXTURE Youth' };

function titlesFor(n: number, suffix = ''): Record<FixtureLocale, string> {
  return {
    en: `FIXTURE Sample lecture ${n}${suffix}`,
    ur: `FIXTURE نمونہ خطاب ${n} (فکسچر)${suffix}`,
    ar: `FIXTURE محاضرة تجريبية ${n} (اختبار)${suffix}`,
  };
}

function plainDescriptions(n: number): Record<FixtureLocale, string> {
  return {
    en: `<p>FIXTURE synthetic English description ${n}.</p>`,
    ur: `<p>FIXTURE مصنوعی اردو وضاحت ${n} (فکسچر)</p>`,
    ar: `<p>FIXTURE وصف عربي تجريبي ${n} (اختبار)</p>`,
  };
}

function baseVideo(n: number): FixtureRecord {
  const primaryLocale = LOCALE_CYCLE[(n % 3) as 0 | 1 | 2];
  const id = `v${pad(n, 3)}`;
  const vimeo = n % 4 === 0;
  const next = n < FIXTURE_BASE_VIDEO_COUNT ? n + 1 : 1;
  const descriptions = plainDescriptions(n);
  descriptions[primaryLocale] = [
    `<p>FIXTURE synthetic description of lecture ${n}.</p>`,
    `<p>See <a href="/videos/v${pad(next, 3)}.html">the next lecture</a>,`,
    ` <a href="/legacy/old-page-${n}.php?id=${n}">an unmapped legacy page</a>`,
    ` and <a href="https://external.example.invalid/reference/${n}">an external reference</a>.</p>`,
  ].join('');
  const categories = [n % 2 === 1 ? CATEGORY_LECTURES : CATEGORY_SPIRITUALITY];
  if (n % 3 === 0) categories.push(CATEGORY_YOUTH);
  const assets: FixtureAsset[] = [];
  if (n === 1)
    assets.push({
      name: 'poster-v001.png',
      licence: 'organisation-owned',
      licenceEvidence: 'FIXTURE licence record 1',
      rightsHolder: 'FIXTURE Organisation',
    });
  if (n === 2)
    assets.push({
      name: 'guide.pdf',
      licence: 'unknown',
      licenceEvidence: null,
      rightsHolder: null,
    });
  if (n === 5)
    // The same bytes as poster-v001.png under another URL and another licence:
    // rights belong to an acquisition, never to the bytes.
    assets.push({
      name: 'poster-copy.png',
      licence: 'third-party',
      licenceEvidence: 'FIXTURE third-party notice',
      rightsHolder: 'FIXTURE Third Party',
    });
  return {
    id,
    host: FIXTURE_VIDEO_HOST,
    kind: 'video',
    primaryLocale,
    languageCode: primaryLocale,
    titles: titlesFor(n),
    descriptions,
    provider: vimeo ? 'vimeo' : 'youtube',
    providerReference: vimeo ? `90000${pad(n, 4)}` : `FIXTURE${id}`,
    categories,
    publishedOn: `2015-${pad(((n - 1) % 12) + 1, 2)}-${pad(n + 10, 2)}`,
    durationSeconds: 600 + n * 60,
    assets,
  };
}

function extraRecord(
  id: string,
  overrides: Partial<FixtureRecord> &
    Pick<FixtureRecord, 'primaryLocale' | 'providerReference'>,
): FixtureRecord {
  return {
    id,
    host: FIXTURE_VIDEO_HOST,
    kind: 'video',
    languageCode: overrides.primaryLocale,
    titles: {
      en: `FIXTURE Extra record ${id}`,
      ur: `FIXTURE اضافی ریکارڈ ${id} (فکسچر)`,
      ar: `FIXTURE سجل إضافي ${id} (اختبار)`,
    },
    descriptions: plainDescriptions(0),
    provider: 'youtube',
    categories: [CATEGORY_LECTURES],
    publishedOn: '2016-06-15',
    durationSeconds: 900,
    assets: [],
    ...overrides,
  };
}

/** The optional records, in the order the index lists them. */
const EXTRA_RECORDS: readonly (readonly [FixtureFeature, FixtureRecord])[] = [
  [
    'hostile',
    extraRecord('x-hostile', {
      primaryLocale: 'en',
      providerReference: 'FIXTUREhst1',
      descriptions: { ...plainDescriptions(0), en: FIXTURE_HOSTILE_HTML },
    }),
  ],
  [
    'personal-data',
    extraRecord('x-personal', {
      primaryLocale: 'en',
      providerReference: 'FIXTUREpii1',
      descriptions: {
        ...plainDescriptions(0),
        en: `<p>FIXTURE contact ${FIXTURE_PERSONAL_EMAIL} or ${FIXTURE_PERSONAL_PHONE} for the synthetic record.</p>`,
      },
    }),
  ],
  // v002 is English, so the same provider id in English is a same-language
  // hard identity; v001 is Urdu, so its English pair is cross-language.
  [
    'duplicates',
    extraRecord('x-dup-same', { primaryLocale: 'en', providerReference: 'FIXTUREv002' }),
  ],
  [
    'duplicates',
    extraRecord('x-dup-cross', { primaryLocale: 'en', providerReference: 'FIXTUREv001' }),
  ],
  [
    'title-duplicates',
    // Folds (case and punctuation) to v002's English title.
    extraRecord('x-title-dup', {
      primaryLocale: 'en',
      providerReference: 'FIXTUREttl1',
      titles: { ...titlesFor(0), en: 'FIXTURE Sample LECTURE 2!' },
    }),
  ],
  [
    'not-a-video',
    extraRecord('x-article', {
      kind: 'article',
      primaryLocale: 'en',
      providerReference: 'FIXTUREart1',
    }),
  ],
  [
    'malformed',
    extraRecord('x-malformed', {
      kind: 'malformed',
      primaryLocale: 'en',
      providerReference: 'FIXTUREbad1',
    }),
  ],
];

/** A second synthetic host: a001 repeats v001's provider id (cross-source). */
const ARCHIVE_RECORDS: readonly FixtureRecord[] = [1, 2, 3].map((n) => ({
  ...baseVideo(n),
  id: `a${pad(n, 3)}`,
  host: FIXTURE_ARCHIVE_HOST,
  titles: titlesFor(n, ' (archive)'),
  descriptions: plainDescriptions(n),
  providerReference: n === 1 ? 'FIXTUREv001' : `FIXTUREa${pad(n, 3)}`,
  assets: [],
}));

/** 1×1 transparent PNG — synthetic. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n% FIXTURE synthetic document\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);
const FILES: ReadonlyMap<string, { readonly type: string; readonly bytes: Buffer }> =
  new Map([
    ['poster-v001.png', { type: 'image/png', bytes: PNG_BYTES }],
    ['poster-copy.png', { type: 'image/png', bytes: PNG_BYTES }],
    ['guide.pdf', { type: 'application/pdf', bytes: PDF_BYTES }],
  ]);

/* ===========================================================================
 * Markup
 * ========================================================================= */

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const dir = (locale: FixtureLocale) => (locale === 'en' ? 'ltr' : 'rtl');

function withRevision(record: FixtureRecord, revision: number): FixtureRecord {
  if (revision <= 1) return record;
  const locale = record.primaryLocale;
  return {
    ...record,
    titles: { ...record.titles, [locale]: `${record.titles[locale]} r${revision}` },
    descriptions: {
      ...record.descriptions,
      [locale]: `${record.descriptions[locale]}<p>FIXTURE revision ${revision} note.</p>`,
    },
  };
}

function videoPage(record: FixtureRecord): string {
  if (record.kind === 'malformed')
    return `<!doctype html><html><head><title>FIXTURE broken page</title></head><body><div class="legacy-video">FIXTURE malformed record ${record.id} without structure`;
  const primary = record.primaryLocale;
  const variants = (['en', 'ur', 'ar'] as const)
    .filter((locale) => locale !== primary)
    .map(
      (locale) =>
        `<section class="video-variant" data-locale="${locale}" lang="${locale}" dir="${dir(locale)}">` +
        `<h2 class="variant-title">${escapeHtml(record.titles[locale])}</h2>` +
        `<div class="variant-description" data-region="description">${record.descriptions[locale]}</div>` +
        `</section>`,
    )
    .join('\n');
  const categories = record.categories
    .map(
      (category) =>
        `<li data-category="${escapeHtml(category.key)}">${escapeHtml(category.label)}</li>`,
    )
    .join('');
  const assets = record.assets
    .map(
      (asset) =>
        `<li><a class="asset" href="/files/${asset.name}" data-licence="${asset.licence}"` +
        (asset.licenceEvidence === null
          ? ''
          : ` data-licence-evidence="${escapeHtml(asset.licenceEvidence)}"`) +
        (asset.rightsHolder === null
          ? ''
          : ` data-rights-holder="${escapeHtml(asset.rightsHolder)}"`) +
        `>FIXTURE ${escapeHtml(asset.name)}</a></li>`,
    )
    .join('');
  return [
    '<!doctype html>',
    `<html lang="${primary}" dir="${dir(primary)}"><head><meta charset="utf-8">`,
    `<title>${escapeHtml(record.titles[primary])} — FIXTURE legacy video site</title></head>`,
    '<body><header class="site-header"><a href="/">FIXTURE legacy site</a></header>',
    `<article class="legacy-video" data-kind="${record.kind}" data-legacy-id="${record.id}">`,
    `<h1 class="video-title" data-locale="${primary}" lang="${primary}">${escapeHtml(record.titles[primary])}</h1>`,
    '<dl class="video-meta">',
    `<dt>Language</dt><dd data-field="language">${record.languageCode}</dd>`,
    `<dt>Provider</dt><dd data-field="provider">${record.provider}</dd>`,
    `<dt>Reference</dt><dd data-field="provider-ref">${escapeHtml(record.providerReference)}</dd>`,
    `<dt>Published</dt><dd><time data-field="published" datetime="${record.publishedOn}">${record.publishedOn}</time></dd>`,
    `<dt>Duration</dt><dd data-field="duration" data-seconds="${record.durationSeconds}">${Math.floor(record.durationSeconds / 60)} min</dd>`,
    '</dl>',
    `<section class="video-description" data-region="description" data-locale="${primary}" lang="${primary}">${record.descriptions[primary]}</section>`,
    variants,
    `<ul class="video-categories">${categories}</ul>`,
    `<ul class="video-assets">${assets}</ul>`,
    '</article>',
    '<footer><a href="/legacy/contact.php">FIXTURE contact</a></footer>',
    '</body></html>',
  ].join('\n');
}

function indexPage(
  records: readonly FixtureRecord[],
  page: number,
  pages: number,
  crossHostLink: boolean,
): string {
  const items = records
    .map(
      (record) =>
        `<li data-legacy-id="${record.id}"><a class="video-link" href="/videos/${record.id}.html">${escapeHtml(record.titles[record.primaryLocale])}</a></li>`,
    )
    .join('\n');
  // A link to another host inside the list: discovery must keep to its scope.
  const foreign = crossHostLink
    ? `\n<li data-legacy-id="a001"><a class="video-link" href="${FIXTURE_ARCHIVE_BASE_URL}videos/a001.html">FIXTURE archive copy</a></li>`
    : '';
  const prev =
    page > 1
      ? `<a rel="prev" href="/videos/index.html?page=${page - 1}">Previous</a>`
      : '';
  const next =
    page < pages
      ? `<a rel="next" href="/videos/index.html?page=${page + 1}">Next</a>`
      : '';
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>FIXTURE video index — page ${page} of ${pages}</title></head><body>`,
    `<ul class="video-index">${items}${foreign}</ul>`,
    `<nav class="pagination">${prev}${next}</nav>`,
    '</body></html>',
  ].join('\n');
}

/* ===========================================================================
 * The server
 * ========================================================================= */

interface StatusOverride {
  readonly status: number;
  readonly retryAfter: string | null;
  remaining: number | null;
}

export interface FixtureControl {
  /** Answers `path` (pathname + search) with `status`; `times` limits how often. */
  setStatus(
    path: string,
    status: number,
    options?: {
      readonly retryAfter?: string;
      readonly times?: number;
      readonly host?: string;
    },
  ): void;
  clearStatus(path: string, host?: string): void;
  /** Delays the answer to `path` by `ms` (the client may give up first). */
  setDelay(path: string, ms: number, host?: string): void;
  /** Changes one record's primary title and description: a new revision. */
  bumpVersion(id: string): number;
  /** Removes a record from the index; its page stays reachable. */
  hide(id: string): void;
  unhide(id: string): void;
  enable(feature: FixtureFeature): void;
  disable(feature: FixtureFeature): void;
  /** Requests received for `path` (pathname + search) on `host`. */
  requestCount(path: string, host?: string): number;
  totalRequests(): number;
  /** The records the video host currently lists, in index order. */
  listed(): readonly FixtureRecord[];
  /** One record as currently served (revision applied), or null. */
  record(id: string): FixtureRecord | null;
  /** Back to the deterministic initial state; counts cleared. */
  reset(): void;
}

export interface FixtureServer {
  readonly endpoint: FixtureEndpoint;
  readonly control: FixtureControl;
  close(): Promise<void>;
}

export interface FixtureServerOptions {
  /** Index page size (default 5). */
  readonly pageSize?: number;
}

const REDIRECTS: ReadonlyMap<string, string> = new Map([
  ['/redirect/in-scope', '/videos/v001.html'],
  ['/redirect/chain/3', '/redirect/chain/2'],
  ['/redirect/chain/2', '/redirect/chain/1'],
  ['/redirect/chain/1', '/videos/v001.html'],
  ['/redirect/same-host', `${FIXTURE_BASE_URL}videos/v002.html`],
  ['/redirect/out-of-scope', `${FIXTURE_ARCHIVE_BASE_URL}videos/a001.html`],
  ['/redirect/non-http', `ftp://${FIXTURE_VIDEO_HOST}/videos/v001.html`],
  ['/redirect/file', 'file:///etc/hostname'],
  [
    '/redirect/credentials',
    `http://fixture:secret@${FIXTURE_VIDEO_HOST}/videos/v001.html`,
  ],
  ['/redirect/port', `http://${FIXTURE_VIDEO_HOST}:8080/videos/v001.html`],
  ['/redirect/literal-ip', 'http://127.0.0.1/videos/v001.html'],
  ['/redirect/loop', '/redirect/loop'],
]);

const ENDLESS_CHUNK = Buffer.alloc(16 * 1024, 0x46);
const ENDLESS_SAFETY_BYTES = 64 * 1024 * 1024;

export async function startFixtureServer(
  options: FixtureServerOptions = {},
): Promise<FixtureServer> {
  const pageSize = options.pageSize ?? 5;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new Error('invalid page size');

  const baseVideos = Array.from({ length: FIXTURE_BASE_VIDEO_COUNT }, (_, index) =>
    baseVideo(index + 1),
  );
  const statuses = new Map<string, StatusOverride>();
  const delays = new Map<string, number>();
  const revisions = new Map<string, number>();
  const hidden = new Set<string>();
  const features = new Set<FixtureFeature>();
  const counts = new Map<string, number>();
  let total = 0;

  const key = (host: string, path: string) => `${host}${path}`;

  function current(record: FixtureRecord): FixtureRecord {
    return withRevision(record, revisions.get(record.id) ?? 1);
  }

  function available(): FixtureRecord[] {
    const extras = EXTRA_RECORDS.filter(([feature]) => features.has(feature)).map(
      ([, record]) => record,
    );
    return [...baseVideos, ...extras].map(current);
  }

  function findRecord(host: string, id: string): FixtureRecord | null {
    const pool = host === FIXTURE_ARCHIVE_HOST ? ARCHIVE_RECORDS : available();
    return pool.find((record) => record.id === id) ?? null;
  }

  function send(
    response: ServerResponse,
    status: number,
    type: string,
    body: string | Buffer,
    extra: Record<string, string> = {},
  ) {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    response.writeHead(status, {
      'content-type': type,
      'content-length': String(bytes.length),
      ...extra,
    });
    response.end(bytes);
  }

  function serve(
    host: string,
    url: URL,
    headers: IncomingHttpHeaders,
    response: ServerResponse,
  ): void {
    const path = url.pathname;
    const redirect = REDIRECTS.get(path);
    if (redirect !== undefined) {
      response.writeHead(302, { location: redirect, 'content-length': '0' });
      response.end();
      return;
    }
    if (path === '/redirect/missing-location') {
      response.writeHead(302, { 'content-length': '0' });
      response.end();
      return;
    }
    if (path === '/headers') {
      // What the client sent: header NAMES, plus the User-Agent it claimed.
      send(
        response,
        200,
        'application/json',
        JSON.stringify({
          names: Object.keys(headers).sort(),
          userAgent: headers['user-agent'] ?? null,
        }),
      );
      return;
    }
    if (path === '/slow') {
      // Never answers in time; released when the client gives up.
      const timer = setTimeout(
        () => send(response, 200, 'text/plain', 'FIXTURE late'),
        30_000,
      );
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (path === '/oversized') {
      // Declares more than any source policy admits.
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(16 * 1024 * 1024),
      });
      response.write(ENDLESS_CHUNK);
      return;
    }
    if (path === '/endless') {
      // No declared length: only a reader that counts can stop it.
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      let written = 0;
      let closed = false;
      response.on('close', () => {
        closed = true;
      });
      const pump = () => {
        while (written < ENDLESS_SAFETY_BYTES && !closed) {
          written += ENDLESS_CHUNK.length;
          if (!response.write(ENDLESS_CHUNK)) {
            response.once('drain', pump);
            return;
          }
        }
        if (!closed) response.end();
      };
      pump();
      return;
    }
    if (path.startsWith('/files/') && host === FIXTURE_VIDEO_HOST) {
      const file = FILES.get(path.slice('/files/'.length));
      if (file !== undefined) {
        send(response, 200, file.type, file.bytes);
        return;
      }
    }
    if (path === '/videos/index.html') {
      const listed =
        host === FIXTURE_ARCHIVE_HOST
          ? ARCHIVE_RECORDS
          : available().filter((record) => !hidden.has(record.id));
      const pages = Math.max(1, Math.ceil(listed.length / pageSize));
      const pageText = url.searchParams.get('page') ?? '1';
      const page = /^[1-9][0-9]{0,5}$/.test(pageText) ? Number(pageText) : 0;
      if (page < 1 || page > pages) {
        send(
          response,
          404,
          'text/html; charset=utf-8',
          '<!doctype html><title>FIXTURE not found</title>',
        );
        return;
      }
      const slice = listed.slice((page - 1) * pageSize, page * pageSize);
      send(
        response,
        200,
        'text/html; charset=utf-8',
        indexPage(slice, page, pages, host === FIXTURE_VIDEO_HOST && page === 1),
      );
      return;
    }
    const match = /^\/videos\/([a-z0-9-]{1,32})\.html$/.exec(path);
    const id = match?.[1];
    const record = id === undefined ? null : findRecord(host, id);
    if (record !== null) {
      send(response, 200, 'text/html; charset=utf-8', videoPage(record));
      return;
    }
    send(
      response,
      404,
      'text/html; charset=utf-8',
      '<!doctype html><title>FIXTURE not found</title>',
    );
  }

  const server = createServer((request, response) => {
    total += 1;
    const host = (request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${host || 'unknown.invalid'}`);
    } catch {
      send(response, 400, 'text/plain', 'FIXTURE bad request');
      return;
    }
    const path = `${url.pathname}${url.search}`;
    counts.set(key(host, path), (counts.get(key(host, path)) ?? 0) + 1);
    if (request.method !== 'GET') {
      send(response, 405, 'text/plain', 'FIXTURE method not allowed', { allow: 'GET' });
      return;
    }
    if (host !== FIXTURE_VIDEO_HOST && host !== FIXTURE_ARCHIVE_HOST) {
      send(response, 421, 'text/plain', 'FIXTURE misdirected request');
      return;
    }
    const answer = () => {
      const override = statuses.get(key(host, path));
      if (override !== undefined) {
        if (override.remaining !== null) {
          override.remaining -= 1;
          if (override.remaining <= 0) statuses.delete(key(host, path));
        }
        send(
          response,
          override.status,
          'text/html; charset=utf-8',
          `<!doctype html><title>FIXTURE status ${override.status}</title>`,
          override.retryAfter === null ? {} : { 'retry-after': override.retryAfter },
        );
        return;
      }
      serve(host, url, request.headers, response);
    };
    const delay = delays.get(key(host, path));
    if (delay === undefined) {
      answer();
      return;
    }
    const timer = setTimeout(answer, delay);
    response.on('close', () => clearTimeout(timer));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;

  const control: FixtureControl = {
    setStatus(path, status, settings = {}) {
      if (!Number.isInteger(status) || status < 100 || status > 599)
        throw new Error('invalid status');
      statuses.set(key(settings.host ?? FIXTURE_VIDEO_HOST, path), {
        status,
        retryAfter: settings.retryAfter ?? null,
        remaining: settings.times ?? null,
      });
    },
    clearStatus(path, host = FIXTURE_VIDEO_HOST) {
      statuses.delete(key(host, path));
    },
    setDelay(path, ms, host = FIXTURE_VIDEO_HOST) {
      delays.set(key(host, path), ms);
    },
    bumpVersion(id) {
      const revision = (revisions.get(id) ?? 1) + 1;
      revisions.set(id, revision);
      return revision;
    },
    hide(id) {
      hidden.add(id);
    },
    unhide(id) {
      hidden.delete(id);
    },
    enable(feature) {
      features.add(feature);
    },
    disable(feature) {
      features.delete(feature);
    },
    requestCount(path, host = FIXTURE_VIDEO_HOST) {
      return counts.get(key(host, path)) ?? 0;
    },
    totalRequests() {
      return total;
    },
    listed() {
      return available().filter((record) => !hidden.has(record.id));
    },
    record(id) {
      return findRecord(FIXTURE_VIDEO_HOST, id) ?? findRecord(FIXTURE_ARCHIVE_HOST, id);
    },
    reset() {
      statuses.clear();
      delays.clear();
      revisions.clear();
      hidden.clear();
      features.clear();
      counts.clear();
      total = 0;
    },
  };

  return {
    endpoint: { address: address.address, port: address.port },
    control,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
