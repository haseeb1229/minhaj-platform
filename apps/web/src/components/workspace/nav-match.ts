/**
 * Which entry of a workspace navigation is the page being shown.
 *
 * PURE, so the rule is proved by unit test rather than by eye, and so the
 * client island that marks `aria-current` holds no decision of its own.
 *
 * THE LONGEST ADDRESS WINS. An area's entries nest — `/admin/editorial` holds
 * `/admin/editorial/correspondence`, `/admin/donations` holds
 * `/admin/donations/campaigns` — so the entry whose address is the deepest
 * prefix of the current path is the one the reader is in. A segment boundary is
 * required: `/my/saved` is not under `/my/save`.
 *
 * AN AREA'S ROOT IS `exact`. Every page of an area sits under its root, so the
 * overview entry would otherwise be current on every page no other entry
 * claims. Navigation state is presentation only: it grants nothing, and a page
 * no entry claims simply has no current entry.
 */

export interface WorkspaceLink {
  readonly key: string;
  readonly href: string;
  readonly text: string;
  /** Further address prefixes this entry stands for; its own `href` always counts. */
  readonly also?: readonly string[];
  /** Current only on its own address — an area's root. */
  readonly exact?: boolean;
}

export interface WorkspaceLinkGroup {
  readonly key: string;
  /** A visible group label; a group without one is a plain run of links. */
  readonly label?: string;
  readonly links: readonly WorkspaceLink[];
}

/** An address without its query, fragment or trailing slash. */
function normalised(address: string): string {
  const path = address.split(/[?#]/u, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/u, '') : path;
}

/** The key of the entry the current path sits under, or `null` when none does. */
export function currentLinkKey(
  pathname: string | null,
  links: readonly WorkspaceLink[],
): string | null {
  if (pathname === null || pathname === '') return null;
  const path = normalised(pathname);
  let best: { readonly key: string; readonly length: number } | null = null;

  for (const link of links) {
    for (const candidate of [
      link.href,
      ...(link.exact === true ? [] : (link.also ?? [])),
    ]) {
      const base = normalised(candidate);
      if (base === '') continue;
      const matches =
        path === base || (link.exact !== true && path.startsWith(`${base}/`));
      if (matches && (best === null || base.length > best.length))
        best = { key: link.key, length: base.length };
    }
  }

  return best?.key ?? null;
}
