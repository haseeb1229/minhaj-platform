'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import {
  providerPlaybackUrl,
  providerWatchUrl,
  type VideoProvider,
} from '@minhaj/contracts/media';

import { Icon } from '@/components/ui/icon';

/**
 * The privacy-preserving provider player (ARCHITECTURE.md §4.7.1), redesigned
 * in Rebaseline R2 as ONE-PRESS PLAY (audit F08).
 *
 * NOTHING THIRD-PARTY LOADS UNTIL THE VISITOR PRESSES PLAY. The server renders
 * a first-party stage: the Video's own stored poster (or the ink stage), a play
 * mark and, beside it, one line saying which provider plays the video and that
 * nothing is loaded from it before the press — plus a described link to watch
 * on the provider's own site. No frame, no provider script, no preconnect and
 * no remote thumbnail is in that markup, so a visitor who never presses Play
 * never contacts the provider.
 *
 * THE PRESS IS THE REQUEST, AND IT PLAYS. Pressing the stage's one button is an
 * explicit request to contact the provider, and that same press creates the
 * frame with the privacy-enhanced address `providerPlaybackUrl` derives — the
 * embed with `autoplay=1` — so the video starts without a second press inside
 * the provider's frame. The frame is granted `autoplay`, and the player routes
 * alone delegate it, to exactly the two embed origins (`next.config.ts`). The
 * disclosure is a line BESIDE the stage, never a panel over the poster and
 * never a modal.
 *
 * AN ENGINEERING ACTIVATION, NOT A CONSENT RECORD. Nothing is stored about the
 * press — no cookie, no local storage, nothing sent anywhere — so the next page
 * starts at the stage again. Whether any jurisdiction requires more is the
 * legal decision OPEN_DECISIONS.md §2.2 and §2.3 reserve.
 *
 * WHAT IS FRAMED IS DERIVED, NEVER GIVEN: a provider and an identifier, turned
 * into the address by `@minhaj/contracts/media` — `youtube-nocookie.com` or
 * Vimeo's player with `dnt=1`, the only frame origins the CSP permits, and only
 * on the pages that render this player.
 *
 * TRUE 16:9 AT EVERY WIDTH. The stage and the frame share one aspect box, so
 * nothing moves when the frame replaces the poster, on a phone as on a laptop.
 *
 * NO DEAD CONTROL. Without JavaScript the button could do nothing, so until the
 * component is hydrated the play mark is a picture of one (hidden from
 * assistive technology) and the described provider link is the way to watch.
 *
 * NO FALSE FAILURE DETECTION. A cross-origin frame's failure is not observable,
 * so this component never claims to know the video played. A video known to be
 * unavailable is not given a player at all, and the fallback link is always
 * present.
 */

export interface VideoPlayerLabels {
  /** The button's name: the video's title and the provider that plays it. */
  readonly play: string;
  /** The one line beside the stage: who plays it, and nothing loads before the press. */
  readonly disclosure: string;
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

/** The play mark: a filled triangle on an ink disc, centred on the stage. */
function PlayMark() {
  return (
    <span className="flex size-16 items-center justify-center rounded-full bg-ink/85 text-ink-foreground shadow-raised ring-1 ring-ink-border transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-hover:bg-action group-active:bg-action-hover motion-safe:group-hover:scale-105 sm:size-20">
      <Icon
        name="play"
        size={24}
        className="size-8! translate-x-0.5 fill-current sm:size-9!"
      />
    </span>
  );
}

export function VideoPlayer({
  provider,
  providerVideoId,
  labels,
  backdrop = null,
  badge = null,
}: {
  readonly provider: VideoProvider;
  readonly providerVideoId: string;
  readonly labels: VideoPlayerLabels;
  /**
   * The stage's picture — the Video's FIRST-PARTY poster, rendered by the
   * server page from Media's own address — or null for the ink stage. It is
   * our stored copy, so the stage still makes no request to the provider;
   * this island itself never sets an image source.
   */
  readonly backdrop?: ReactNode;
  /** A short fact drawn on the stage's corner, such as the running time. */
  readonly badge?: ReactNode;
}) {
  const hydrated = useHydrated();
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // Focus follows the visitor's press into the player, so a keyboard user
  // continues inside it rather than being left on a button that has gone.
  useEffect(() => {
    if (playing) frame.current?.focus();
  }, [playing]);

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-panel bg-ink"
        data-player-state={playing ? 'playing' : 'ready'}
      >
        {playing ? (
          <iframe
            ref={frame}
            src={providerPlaybackUrl(provider, providerVideoId)}
            title={labels.frameTitle}
            className="absolute inset-0 size-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox={SANDBOX}
          />
        ) : (
          <>
            <span className="absolute inset-0 block">{backdrop}</span>
            {hydrated ? (
              <button
                type="button"
                aria-label={labels.play}
                onClick={() => setPlaying(true)}
                className="group absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-offset-[-4px] focus-visible:outline-ink-accent"
              >
                <PlayMark />
              </button>
            ) : (
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
              >
                <PlayMark />
              </span>
            )}
            {badge === null ? null : (
              <span className="pointer-events-none absolute end-3 bottom-3 rounded-control bg-ink/85 px-2 py-0.5 text-caption font-semibold text-ink-foreground tabular-nums">
                {badge}
              </span>
            )}
          </>
        )}
      </div>
      <p className="text-caption flex flex-wrap items-baseline gap-x-3 gap-y-1 text-foreground-muted">
        <span>{labels.disclosure}</span>
        <a
          href={providerWatchUrl(provider, providerVideoId)}
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 font-semibold text-action underline-offset-4 hover:underline sm:min-h-0"
        >
          {labels.fallback}
          <Icon name="external" size={16} />
        </a>
      </p>
    </div>
  );
}
