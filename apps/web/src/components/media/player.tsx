'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  providerEmbedUrl,
  providerWatchUrl,
  type VideoProvider,
} from '@minhaj/contracts/media';

import { Button } from '@/components/ui';

/**
 * The privacy-gated provider player (ARCHITECTURE.md §4.7.1).
 *
 * NOTHING THIRD-PARTY LOADS UNTIL THE VISITOR ASKS. The server renders a
 * first-party placeholder: what the video is, who provides it, what loading it
 * means, and a described link to watch it on the provider's own site. No frame,
 * no provider script, no preconnect and no remote thumbnail is in that markup,
 * so a visitor who never presses the button never contacts the provider.
 *
 * AN ENGINEERING ACTIVATION GATE, NOT A CONSENT RECORD. Pressing "Load video"
 * is an explicit request to contact the provider, and nothing is stored about
 * it — no cookie, no local storage, nothing sent anywhere — so the next page
 * starts gated again. Whether any jurisdiction requires more than this is the
 * legal decision OPEN_DECISIONS.md §2.2 and §2.3 reserve; this component makes
 * no claim to settle it.
 *
 * WHAT IS FRAMED IS DERIVED, NEVER GIVEN. The component receives a provider and
 * an identifier and asks `@minhaj/contracts/media` for the privacy-enhanced embed
 * address — `youtube-nocookie.com` or Vimeo's player with `dnt=1`, the only
 * frame origins the CSP permits, and only on the pages that render a player.
 *
 * NO AUTOPLAY. The embed address carries no autoplay parameter, the frame is not
 * granted the `autoplay` permission, and the page's Permissions-Policy refuses
 * it outright: playback starts when the visitor presses play inside the player.
 *
 * NO DEAD CONTROL. Without JavaScript the button could do nothing, so it is not
 * rendered until the component is hydrated; the described provider link works
 * either way.
 *
 * NO FALSE FAILURE DETECTION. A cross-origin frame's failure is not observable,
 * so this component never claims to know the video played. A video known to be
 * unavailable is not given a player at all — the page says so instead — and the
 * fallback link is always present.
 */

export interface VideoPlayerLabels {
  /** What loading means: which provider, and that it is contacted only now. */
  readonly notice: string;
  readonly load: string;
  /** The described fallback link to the provider's own page. */
  readonly fallback: string;
  /** The frame's accessible name, naming the video and the provider. */
  readonly frameTitle: string;
}

/**
 * The frame's sandbox. Scripts and its own origin, which every provider player
 * needs; popups, so the provider's "watch on" link can open; presentation, for
 * casting. NOT top navigation and NOT forms: the frame can never move or submit
 * this page.
 */
const SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';

/** `true` once hydrated, `false` during the server render — no effect, no flash. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function VideoPlayer({
  provider,
  providerVideoId,
  labels,
  backdrop = null,
}: {
  readonly provider: VideoProvider;
  readonly providerVideoId: string;
  readonly labels: VideoPlayerLabels;
  /**
   * Phase 30-R: what the gate shows behind its notice — the Video's FIRST-PARTY
   * poster, rendered by the server page from Media's own address — or null.
   * It is our stored copy, so the gate still makes no request to the provider;
   * this island itself never sets an image source.
   */
  readonly backdrop?: ReactNode;
}) {
  const hydrated = useHydrated();
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // Focus follows the visitor's request into the player, so a keyboard user
  // continues inside it rather than being left on a button that has gone.
  useEffect(() => {
    if (loaded) frame.current?.focus();
  }, [loaded]);

  return (
    <div className="flex flex-col gap-3">
      {loaded ? (
        <div className="aspect-video w-full overflow-hidden rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)]">
          <iframe
            ref={frame}
            src={providerEmbedUrl(provider, providerVideoId)}
            title={labels.frameTitle}
            className="h-full w-full"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox={SANDBOX}
          />
        </div>
      ) : (
        <div
          className="relative flex min-h-48 w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)] p-6 text-center sm:aspect-video"
          data-player-state="gated"
        >
          {backdrop}
          <div
            className={`relative flex flex-col items-center gap-4 ${
              backdrop === null
                ? ''
                : 'rounded-[var(--radius-panel)] bg-[color:var(--color-surface-raised)] p-4 shadow-[var(--shadow-raised)]'
            }`}
          >
            <p className="max-w-[var(--measure-prose)] text-sm">{labels.notice}</p>
            {hydrated ? (
              <Button type="button" onClick={() => setLoaded(true)}>
                {labels.load}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <p className="text-sm">
        <a
          href={providerWatchUrl(provider, providerVideoId)}
          rel="noopener noreferrer"
          className="font-medium text-[color:var(--color-action)] underline underline-offset-2"
        >
          {labels.fallback}
        </a>
      </p>
    </div>
  );
}
