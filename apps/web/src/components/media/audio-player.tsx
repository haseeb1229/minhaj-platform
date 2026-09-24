'use client';

import { useState } from 'react';

import { audioAssetPath, audioPreviewPath } from './presentation';

/**
 * The audio player (DELIVERY_PLAN.md Phase 11; SECURITY_BASELINE.md §16.2).
 *
 * THE BROWSER'S OWN PLAYER. A native `<audio controls>` element is already
 * keyboard-operable — focus it, then Space or Enter to play, arrows to seek —
 * exposed to assistive technology, and usable on every phone, so no player
 * library, no custom scrubber and no second set of controls is drawn over it.
 * Without JavaScript it still plays; this component only adds an honest message
 * when playback fails.
 *
 * NO AUTOPLAY, AND NOTHING FETCHED UNTIL ASKED. There is no `autoplay`
 * attribute, the page's Permissions-Policy refuses autoplay outright, and
 * `preload="none"` means not a byte of the recording is requested until the
 * listener presses play — so opening a page costs a mobile visitor nothing.
 *
 * FIRST-PARTY BYTES ONLY. The source is DERIVED here from the track and asset
 * identifiers — the public route, or the administrator's preview route — and is
 * never a URL a prop could carry in from elsewhere. Seeking is served by the
 * same route with a `Range` request, under the same authorisation.
 *
 * AN HONEST FAILURE. If the browser cannot fetch or decode the file, the
 * listener is told so in words, politely announced, rather than left with a
 * control that silently does nothing. There is deliberately no download link:
 * playback grants no right to keep a copy.
 */

export interface AudioPlayerLabels {
  /** The player's accessible name — it names the recording. */
  readonly player: string;
  /** Shown inside the element by a browser with no audio support at all. */
  readonly unsupported: string;
  /** Announced when the recording cannot be played right now. */
  readonly failed: string;
}

export function AudioPlayer({
  trackId,
  assetId,
  mode,
  labels,
  describedBy,
}: {
  readonly trackId: string;
  readonly assetId: string;
  /** `public` is the listener's route; `preview` needs a live administrator. */
  readonly mode: 'public' | 'preview';
  readonly labels: AudioPlayerLabels;
  /** The element that says whether a genuine transcript exists. */
  readonly describedBy?: string;
}) {
  const [failed, setFailed] = useState(false);
  const source =
    mode === 'public'
      ? audioAssetPath(trackId, assetId)
      : audioPreviewPath(trackId, assetId);

  return (
    <div className="flex flex-col gap-3">
      <audio
        controls
        preload="none"
        src={source}
        aria-label={labels.player}
        aria-describedby={describedBy}
        onError={() => setFailed(true)}
        onPlaying={() => setFailed(false)}
        className="w-full"
      >
        {labels.unsupported}
      </audio>
      {failed ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 text-sm text-[color:var(--color-warning)]"
        >
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
