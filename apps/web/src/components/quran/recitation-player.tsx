'use client';

import { useState } from 'react';

import { recitationAssetPath } from './presentation';

/**
 * A recitation segment's player (Phase 18; SECURITY_BASELINE.md §16.2).
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
 * FIRST-PARTY BYTES ONLY. The source is DERIVED from the recitation, segment and
 * asset identifiers — never a URL a prop could carry in — and the byte route
 * decides again whether the segment is public now. There is deliberately no
 * download link: listening grants no right to keep a copy.
 */

export interface RecitationPlayerLabels {
  /** The player's accessible name — it names the recitation and the range. */
  readonly player: string;
  readonly unsupported: string;
  readonly failed: string;
}

export function RecitationPlayer({
  recitationId,
  segmentId,
  assetId,
  labels,
}: {
  readonly recitationId: string;
  readonly segmentId: string;
  readonly assetId: string;
  readonly labels: RecitationPlayerLabels;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <audio
        controls
        preload="none"
        src={recitationAssetPath({ recitationId, segmentId, assetId })}
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
          className="rounded-[var(--radius-control)] border border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 text-sm text-[color:var(--color-warning)]"
        >
          {labels.failed}
        </p>
      ) : null}
    </div>
  );
}
