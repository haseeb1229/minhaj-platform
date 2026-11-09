'use client';

import { useState } from 'react';

import { audioSource, type SegmentAudio } from './recitation-plan';

/**
 * A recitation segment's NATIVE player (Phase 18; SECURITY_BASELINE.md §16.2)
 * — since Quran Part 5 the plain fallback a page offers without JavaScript;
 * with it, the Quran layout's recitation player takes over and this is hidden.
 *
 * THE BROWSER'S OWN PLAYER, exactly as the Listen pages use it: a native
 * `<audio controls>` is keyboard-operable and exposed to assistive technology
 * on every phone, so no player library and no second set of controls is drawn.
 * Without JavaScript it still plays; this island only adds an honest message
 * when playback fails.
 *
 * NO AUTOPLAY, AND NOTHING FETCHED UNTIL ASKED: no `autoplay` attribute, and
 * `preload="none"` so opening a Surah costs a mobile reader nothing.
 *
 * THE SOURCE IS DERIVED, NEVER CARRIED: from the recitation, segment and asset
 * identifiers (first-party bytes, whose route decides again whether the segment
 * is public now), or from an allowlisted stream and its Surah
 * (`recitationStreamUrl` refuses any other) — never a URL a prop could carry
 * in. There is deliberately no download link: listening grants no right to
 * keep a copy.
 */

export interface RecitationPlayerLabels {
  /** The player's accessible name — it names the recitation and the range. */
  readonly player: string;
  readonly unsupported: string;
  readonly failed: string;
}

export function RecitationPlayer({
  audio,
  labels,
}: {
  readonly audio: SegmentAudio;
  readonly labels: RecitationPlayerLabels;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <audio
        controls
        preload="none"
        src={audioSource(audio)}
        aria-label={labels.player}
        onError={() => setFailed(true)}
        onPlaying={() => setFailed(false)}
        className="w-full"
      >
        {labels.unsupported}
      </audio>
      {failed ? (
        <p
          role="status"
          className="rounded-control border border-warning bg-warning-surface px-4 py-3 text-sm text-warning"
        >
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
