import type {
  FetchOutcome,
  MigrationFetchPort,
  PendingItem,
} from '@minhaj/contracts/migration';

/**
 * A synthetic site for the real-source adapter suites: URL → outcome, no
 * network. Every page in these suites is MINIMAL SYNTHETIC markup shaped like
 * the real site's structure — no real page, religious text or name is copied.
 */

const encoder = new TextEncoder();

export function htmlPage(
  html: string,
  options: {
    status?: number;
    contentType?: string;
    finalUrl?: string;
    retryAfter?: string;
  } = {},
): (url: string) => FetchOutcome {
  return (url) => ({
    kind: 'response',
    status: options.status ?? 200,
    requestedUrl: url,
    finalUrl: options.finalUrl ?? url,
    contentType: options.contentType ?? 'text/html; charset=UTF-8',
    headers: {},
    body: encoder.encode(html),
    retryAfter: options.retryAfter ?? null,
  });
}

export function textFile(text: string, status = 200): (url: string) => FetchOutcome {
  return htmlPage(text, { status, contentType: 'text/plain' });
}

export interface FakeSite {
  readonly fetcher: MigrationFetchPort;
  /** Every URL fetched, in order. */
  readonly requested: string[];
  set(url: string, page: (url: string) => FetchOutcome): void;
}

/** Unknown URLs answer 404 — which, for robots.txt, allows everything. */
export function fakeSite(pages: Record<string, (url: string) => FetchOutcome>): FakeSite {
  const routes = new Map(Object.entries(pages));
  const requested: string[] = [];
  return {
    requested,
    set(url, page) {
      routes.set(url, page);
    },
    fetcher: {
      fetcherKey: 'fake-site',
      fetcherVersion: '1',
      async fetch(url) {
        requested.push(url);
        const page = routes.get(url) ?? htmlPage('not found', { status: 404 });
        return page(url);
      },
    },
  };
}

export function pendingItem(
  externalKey: string,
  legacyIdentifier: string | null,
): PendingItem {
  return {
    itemId: '00000000-0000-4000-8000-0000000000aa',
    recordId: '00000000-0000-4000-8000-0000000000bb',
    externalKey,
    originalUrl: externalKey,
    legacyIdentifier,
    attempts: 0,
    latestSnapshot: null,
    currentStaged: null,
  };
}

/** The bytes of a page as evidence for `parse`. */
export function evidenceOf(
  html: string,
  finalUrl: string,
  contentType: string | null = 'text/html; charset=UTF-8',
): { body: Uint8Array; contentType: string | null; finalUrl: string } {
  return { body: encoder.encode(html), contentType, finalUrl };
}

/** The decoding refusals every adapter turns into parse failures. */
export const UNDECODABLE = Object.freeze([
  {
    body: new Uint8Array([0x7b, 0x7d]),
    contentType: 'application/json',
    detail: 'unsupported-content-type',
  },
  {
    body: new Uint8Array([0x3c, 0xff, 0xfe]),
    contentType: 'text/html; charset=utf-8',
    detail: 'invalid-utf8',
  },
  {
    body: new Uint8Array([0x3c]),
    contentType: 'text/html; charset=windows-1256',
    detail: 'unsupported-charset',
  },
] as const);
