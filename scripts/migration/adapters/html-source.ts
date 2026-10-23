import { load, type CheerioAPI } from 'cheerio';

/**
 * Shared HTML reading for the fixture adapters: strict decoding, Cheerio
 * (parse5, the HTML specification's parser) with source locations, and the
 * EXACT source text of an element's content.
 *
 * Untrusted markup is handed on as the source wrote it, sliced from the
 * decoded document by the parser's offsets, rather than re-serialised: a
 * re-serialisation would quietly normalise the very constructs the
 * sanitiser has to see. Nothing here sanitises — normalisation does, before
 * staging (SECURITY_BASELINE.md §10.2).
 */

/** Decodes a UTF-8 HTML body, refusing other charsets and invalid bytes. */
export function decodeHtml(
  body: Uint8Array,
  contentType: string | null,
):
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly detail: string } {
  const type = (contentType ?? '').toLowerCase();
  const mediaType = (type.split(';', 1)[0] ?? '').trim();
  if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml')
    return { ok: false, detail: 'unsupported-content-type' };
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/.exec(type)?.[1];
  if (charset !== undefined && charset !== 'utf-8' && charset !== 'utf8')
    return { ok: false, detail: 'unsupported-charset' };
  try {
    return { ok: true, html: new TextDecoder('utf-8', { fatal: true }).decode(body) };
  } catch {
    return { ok: false, detail: 'invalid-utf8' };
  }
}

export function loadHtml(html: string): CheerioAPI {
  return load(html, { sourceCodeLocationInfo: true });
}

interface Located {
  readonly sourceCodeLocation?: {
    readonly startTag?: { readonly endOffset: number } | undefined;
    readonly endTag?: { readonly startOffset: number } | undefined;
  } | null;
}

/** The part of a Cheerio selection this module reads. */
interface Selection {
  get(index: 0): Located | undefined;
  html(): string | null;
}

/**
 * The exact source text between the first selected element's start and end
 * tags. Where the source omitted the end tag the parser's own serialisation
 * is the only faithful answer left, and is used instead.
 */
export function innerSource(html: string, selection: Selection): string {
  const location = selection.get(0)?.sourceCodeLocation;
  if (location?.startTag && location.endTag)
    return html.slice(location.startTag.endOffset, location.endTag.startOffset);
  return selection.html() ?? '';
}

/** Collapsed, trimmed element text. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
