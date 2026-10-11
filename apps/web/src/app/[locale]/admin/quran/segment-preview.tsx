'use client';

import { useState } from 'react';

/**
 * The administrator's private preview of one recitation segment's audio.
 *
 * THE BROWSER'S OWN PLAYER, as on the Media screens: a native `<audio
 * controls>` element is keyboard-operable and exposed to assistive technology
 * without a library. No autoplay, `preload="none"`, and no download link.
 *
 * FIRST-PARTY BYTES ONLY. The source is DERIVED here from the Recitation,
 * segment and asset identifiers as the private preview route — never a URL a
 * prop could carry in from elsewhere. That route re-checks the administrator's
 * permission live and serves only the asset already recorded against that
 * exact segment; Storage still refuses an uncleared file.
 */
export function SegmentPreview({
  recitationId,
  segmentId,
  assetId,
  labels,
}: {
  readonly recitationId: string;
  readonly segmentId: string;
  readonly assetId: string;
  readonly labels: {
    /** The player's accessible name — it names the segment. */
    readonly player: string;
    readonly unsupported: string;
    readonly failed: string;
  };
}) {
  const [failed, setFailed] = useState(false);
  const source = `/assets/quran/previews/recitations/${encodeURIComponent(
    recitationId,
  )}/${encodeURIComponent(segmentId)}/${encodeURIComponent(assetId)}`;

  return (
    <div className="flex flex-col gap-2">
      <audio
        controls
        preload="none"
        src={source}
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
