/**
 * The video providers, and EVERY address this platform derives from them
 * (ARCHITECTURE.md §4.7, §4.7.1; TECH_STACK.md §9).
 *
 * THE ONE PLACE A PROVIDER URL IS WRITTEN. An operator never supplies an iframe,
 * an embed address or a player URL: they supply a provider and either the
 * provider's video identifier or one of a small, strictly parsed set of that
 * provider's ordinary watch addresses. Both are reduced to `provider +
 * providerVideoId`, which is all that is stored, and every URL a page renders —
 * the privacy-enhanced embed, the described fallback link, the structured-data
 * embed address — is DERIVED here from that pair. There is therefore no path
 * from stored input to an arbitrary frame source, an arbitrary host or a
 * `javascript:` / `data:` address.
 *
 * PURE AND BROWSER-SAFE. No fetch, no provider API, no credential: nothing here
 * contacts a provider. The CSP frame allowlist (`next.config.ts`) and the
 * player read the same constants, so the origins a page may frame and the
 * origins the player loads cannot drift apart.
 */

export const VIDEO_PROVIDERS = Object.freeze(['youtube', 'vimeo'] as const);

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/**
 * The provider identifier grammars.
 *
 * YouTube identifiers are eleven characters of the URL-safe base-64 alphabet and
 * are CASE-SENSITIVE — which is why the database stores them under a binary
 * collation. Vimeo identifiers are decimal. A value outside these grammars is
 * refused rather than normalised into something that might name another video.
 */
const IDENTIFIER: Readonly<Record<VideoProvider, RegExp>> = Object.freeze({
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^[1-9][0-9]{0,11}$/,
});

export function isProviderVideoId(provider: VideoProvider, value: string): boolean {
  return IDENTIFIER[provider].test(value);
}

/**
 * The origins a page may FRAME, one per provider — the privacy-enhanced
 * YouTube host and Vimeo's player host. Nothing else is ever framed.
 */
export const PROVIDER_EMBED_ORIGINS: Readonly<Record<VideoProvider, string>> =
  Object.freeze({
    youtube: 'https://www.youtube-nocookie.com',
    vimeo: 'https://player.vimeo.com',
  });

/** The provider's own host for the one image URL a record may carry. */
const THUMBNAIL_PREFIX: Readonly<Record<VideoProvider, string>> = Object.freeze({
  youtube: 'https://i.ytimg.com/vi/',
  vimeo: 'https://i.vimeocdn.com/video/',
});

/** The host names a watch address may use, per provider. */
const WATCH_HOSTS: Readonly<Record<VideoProvider, readonly string[]>> = Object.freeze({
  youtube: [
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtube-nocookie.com',
  ],
  vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
});

/**
 * Reduces what an operator typed to a provider identifier, or `null`.
 *
 * ACCEPTED: the bare identifier, or an HTTPS address on one of the provider's
 * own hosts in one of its ordinary shapes —
 *
 *   YouTube  /watch?v={id} · youtu.be/{id} · /embed/{id} · /shorts/{id} · /live/{id}
 *   Vimeo    vimeo.com/{id} · player.vimeo.com/video/{id}
 *
 * REFUSED: any other scheme (`http:`, `javascript:`, `data:`), credentials, a
 * port, any other host, a malformed identifier, an extra path segment, and —
 * for Vimeo — the private-link hash of an unlisted video. Refusing the hash is
 * deliberate: dropping it silently would store a video the privacy-enhanced
 * player then cannot show, which is a broken embed produced by the platform.
 */
export function parseProviderReference(
  provider: VideoProvider,
  input: string,
): string | null {
  const value = input.trim();
  if (value.length === 0 || value.length > 300) return null;
  if (isProviderVideoId(provider, value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not a URL and not an identifier: refused, with nothing to report.
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !WATCH_HOSTS[provider].includes(url.hostname.toLowerCase())
  ) {
    return null;
  }

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const candidate =
    provider === 'youtube'
      ? youtubeIdentifier(url, segments)
      : vimeoIdentifier(url, segments);

  return candidate !== null && isProviderVideoId(provider, candidate) ? candidate : null;
}

function youtubeIdentifier(url: URL, segments: readonly string[]): string | null {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') return segments.length === 1 ? (segments[0] ?? null) : null;
  if (segments.length === 1 && segments[0] === 'watch') return url.searchParams.get('v');
  if (
    segments.length === 2 &&
    (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live')
  ) {
    return segments[1] ?? null;
  }
  return null;
}

function vimeoIdentifier(url: URL, segments: readonly string[]): string | null {
  // An unlisted video's private hash, in either of its two spellings.
  if (url.searchParams.has('h')) return null;
  if (url.hostname.toLowerCase() === 'player.vimeo.com') {
    return segments.length === 2 && segments[0] === 'video'
      ? (segments[1] ?? null)
      : null;
  }
  return segments.length === 1 ? (segments[0] ?? null) : null;
}

/**
 * The PRIVACY-ENHANCED embed address — what the player frames, only after the
 * visitor asks it to (ARCHITECTURE.md §4.7.1).
 *
 * YouTube's `youtube-nocookie.com` host is its provider-minimising mode, and
 * `rel=0` keeps suggested videos to the same channel. Vimeo's `dnt=1` asks the
 * player not to track the session. Neither carries `autoplay`: playback starts
 * only when the visitor presses play inside the player.
 */
export function providerEmbedUrl(provider: VideoProvider, id: string): string {
  const safe = encodeURIComponent(id);
  return provider === 'youtube'
    ? `${PROVIDER_EMBED_ORIGINS.youtube}/embed/${safe}?rel=0`
    : `${PROVIDER_EMBED_ORIGINS.vimeo}/video/${safe}?dnt=1`;
}

/** The provider's own page for the video — the described fallback link. */
export function providerWatchUrl(provider: VideoProvider, id: string): string {
  const safe = encodeURIComponent(id);
  return provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${safe}`
    : `https://vimeo.com/${safe}`;
}

/**
 * Whether a thumbnail address is the provider's own image for THIS video.
 *
 * NEVER RENDERED AS AN IMAGE BEFORE ACTIVATION. A remote thumbnail would disclose
 * the visitor to the provider just as the frame would, so pages paint a
 * first-party placeholder and this address is used only inside structured data,
 * which a browser does not fetch. It is still held to the provider's own image
 * host — and, for YouTube, to this video's own identifier — so a record cannot
 * be made to advertise somebody else's picture.
 */
export function isProviderThumbnail(
  provider: VideoProvider,
  id: string,
  value: string,
): boolean {
  if (value.length > 2000 || !value.startsWith(THUMBNAIL_PREFIX[provider])) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.port !== '')
    return false;
  const rest = url.pathname.split('/').filter((segment) => segment !== '');
  if (!rest.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment))) return false;
  return provider === 'youtube'
    ? rest.length === 3 &&
        rest[0] === 'vi' &&
        rest[1] === id &&
        /\.(jpg|webp)$/.test(rest[2] ?? '')
    : rest.length >= 2 && rest[0] === 'video';
}
