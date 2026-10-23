import 'server-only';

import { createHash } from 'node:crypto';

import {
  MIGRATION_LIMITS,
  canonicalSourceUrl,
  type StagedLinkInput,
} from '@minhaj/contracts/migration';

/**
 * LINK EXTRACTION AND REWRITING (MIGRATION_STRATEGY.md §4.5).
 *
 * Every href is resolved against the record's final URL WITH THE URL PARSER —
 * the same algorithm a browser applies — so a protocol-relative `//host`, a
 * backslash (`/\host`, `https:\\host`), tab-split schemes (`java\tscript:`),
 * userinfo (`https://legacy@evil`) and percent-encoding are judged by the host
 * and scheme a browser would actually use, never by a string prefix.
 *
 *   - not http(s) after resolution, or carrying credentials → `dropped`;
 *   - a source host at its default port → internal: `rewritten` to the
 *     canonical path when an ACTIVE legacy mapping exists, else `unresolved`
 *     and kept as the legacy absolute URL — a target is never fabricated;
 *   - any other host → `external`, unchanged.
 */

/** The record's own location and the source's hosts — what makes a link internal. */
export interface LinkScope {
  readonly baseUrl: string;
  readonly hosts: readonly string[];
}

/** Active legacy mappings, by digest of the canonical legacy URL. */
export type MappingLookup = ReadonlyMap<
  string,
  { readonly id: string; readonly canonicalPath: string }
>;

/** Lowercase hex SHA-256 of a legacy URL's canonical form (`canonicalSourceUrl`). */
export function legacyUrlDigest(url: string): string {
  let canonical = url;
  try {
    canonical = canonicalSourceUrl(new URL(url));
  } catch {
    // An unparseable stored URL is digested as it is: it simply matches nothing.
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export type ClassifiedLink =
  | { readonly kind: 'dropped'; readonly href: string }
  | { readonly kind: 'external'; readonly href: string; readonly url: string }
  | {
      readonly kind: 'internal';
      readonly href: string;
      readonly url: string;
      readonly digest: string;
    };

export function classifyLink(href: string, scope: LinkScope): ClassifiedLink {
  if (href.length > MIGRATION_LIMITS.url) return { kind: 'dropped', href };
  let url: URL;
  try {
    url = new URL(href, scope.baseUrl);
  } catch {
    return { kind: 'dropped', href };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { kind: 'dropped', href };
  if (url.username !== '' || url.password !== '') return { kind: 'dropped', href };
  const resolved = url.href;
  if (resolved.length > MIGRATION_LIMITS.url) return { kind: 'dropped', href };
  const host = url.hostname.toLowerCase();
  if (scope.hosts.includes(host) && url.port === '') {
    const canonical = canonicalSourceUrl(url);
    return {
      kind: 'internal',
      href,
      url: canonical,
      digest: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    };
  }
  return { kind: 'external', href, url: resolved };
}

/** The distinct digests of every internal link — what to ask the mapping store. */
export function internalDigests(hrefs: readonly string[], scope: LinkScope): string[] {
  const digests = new Set<string>();
  for (const href of hrefs) {
    const link = classifyLink(href, scope);
    if (link.kind === 'internal') digests.add(link.digest);
  }
  return [...digests].sort();
}

/** A mapping's canonical path, if it is one the stored HTML and the link row may carry. */
function usablePath(path: string): boolean {
  return (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    path.length <= 400 &&
    !/[\s\\]/.test(path)
  );
}

function bounded(text: string): string {
  return text.length <= MIGRATION_LIMITS.url
    ? text
    : `${text.slice(0, MIGRATION_LIMITS.url - 1)}…`;
}

/**
 * The link rows of one staged revision: each distinct href once, in document
 * order, at most `MIGRATION_LIMITS.links`. A row records the RESOLVED URL for
 * a live link (what the unresolved-link report needs) and the href as written
 * for a dropped one, bounded.
 */
export function stageLinks(
  hrefs: readonly string[],
  scope: LinkScope,
  mappings: MappingLookup,
): StagedLinkInput[] {
  const seen = new Set<string>();
  const rows: StagedLinkInput[] = [];
  for (const href of hrefs) {
    if (seen.has(href)) continue;
    seen.add(href);
    if (rows.length >= MIGRATION_LIMITS.links) break;
    const link = classifyLink(href, scope);
    const position = rows.length;
    if (link.kind === 'dropped') {
      rows.push({
        position,
        href: bounded(href),
        disposition: 'dropped',
        rewrittenTo: null,
        legacyMappingId: null,
      });
    } else if (link.kind === 'external') {
      rows.push({
        position,
        href: link.url,
        disposition: 'external',
        rewrittenTo: null,
        legacyMappingId: null,
      });
    } else {
      const mapping = mappings.get(link.digest);
      rows.push(
        mapping !== undefined && usablePath(mapping.canonicalPath)
          ? {
              position,
              href: link.url,
              disposition: 'rewritten',
              rewrittenTo: mapping.canonicalPath,
              legacyMappingId: mapping.id,
            }
          : {
              position,
              href: link.url,
              disposition: 'unresolved',
              rewrittenTo: null,
              legacyMappingId: null,
            },
      );
    }
  }
  return rows;
}

/**
 * What an anchor in the sanitised HTML points at: the canonical path when
 * mapped, the legacy absolute URL when not, the external URL unchanged, or
 * `null` (the words stay, the link goes) when dropped.
 */
export function rewriteHref(
  href: string,
  scope: LinkScope,
  mappings: MappingLookup,
): string | null {
  const link = classifyLink(href, scope);
  if (link.kind === 'dropped') return null;
  if (link.kind === 'external') return link.url;
  const mapping = mappings.get(link.digest);
  return mapping !== undefined && usablePath(mapping.canonicalPath)
    ? mapping.canonicalPath
    : link.url;
}
