#!/usr/bin/env bash
# =============================================================================
# deploy.sh <sha> — switch staging to one already-fetched release
# =============================================================================
#
# Called by fetch-release.sh (from the staging deploy workflow) or by an
# operator re-deploying a release that is already on the host. It:
#
#   1. proves the staging host (lib.sh: environment file, Azure resource id and
#      tag, data-disk marker) and validates the release's pinned image digests;
#   2. ensures SQL Server and ClamAV are running — it never migrates, seeds or
#      resets them (bin/migrate.sh and bin/reset.sh are separate, deliberate);
#   3. replaces web, realtime and the proxy with this release's images;
#   4. proves the result through the REAL edge: valid TLS, the environment gate
#      (401 without the credential), robots and X-Robots-Tag;
#   5. on any failure, puts the previous known-good release back and says so.
#
# APP ROLLBACK ONLY. Restoring an earlier release changes which images run; it
# never reverses a database migration and never edits migration history.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

[ "$#" -eq 1 ] || die "usage: deploy.sh <sha>"
sha="$1"
staging_preflight
host_lock

dir="$(release_dir "$sha")"
[ -d "$dir" ] || die "release $sha is not on this host (run it through fetch-release.sh)"
load_release_env "$dir"
[ "$MINHAJ_RELEASE_SHA" = "$sha" ] || die "release.env does not describe $sha"
[ "$RELEASE_PUBLIC_HOST" = "$MINHAJ_PUBLIC_HOST" ] || die "the release was built for a different public host"
assert_image_ref "$MINHAJ_WEB_IMAGE" web
assert_image_ref "$MINHAJ_REALTIME_IMAGE" realtime
assert_image_ref "$MINHAJ_OPS_IMAGE" ops
for ref in "$MINHAJ_WEB_IMAGE" "$MINHAJ_REALTIME_IMAGE" "$MINHAJ_OPS_IMAGE"; do
  docker image inspect "$ref" > /dev/null 2>&1 || die "image $ref has not been pulled"
done

# The web image is origin-specific: canonical, cookie and same-origin decisions
# were bound when it was BUILT. The origin it was built for is a label on the
# image itself, so this compares the artifact with the host — not the host
# with its own configuration.
built_for="$(docker image inspect --format '{{ index .Config.Labels "org.minhaj.public-origin" }}' "$MINHAJ_WEB_IMAGE")"
[ "$built_for" = "https://$MINHAJ_PUBLIC_HOST" ] \
  || die "the web image was built for '$built_for', not https://$MINHAJ_PUBLIC_HOST"

assert_host_prerequisites
assert_imds_guard

previous="$(current_release_sha || true)"

# --- 2. the stateful services (unchanged by a release switch) -----------------
ensure_sqlserver_image "$dir"
release_compose "$dir" up -d --wait --wait-timeout 600 sqlserver clamav

# --- 3. the switch -------------------------------------------------------------
log "switching web, realtime and proxy to $sha (previous: ${previous:-none})"
if release_compose "$dir" up -d --wait --wait-timeout 300 --remove-orphans web realtime proxy \
  && edge_smoke; then
  ln -sfn "$dir" "$RELEASES_DIR/.current.new"
  mv -T "$RELEASES_DIR/.current.new" "$RELEASES_DIR/current"
  if [ -n "$previous" ] && [ "$previous" != "$sha" ]; then
    ln -sfn "$RELEASES_DIR/$previous" "$RELEASES_DIR/.previous.new"
    mv -T "$RELEASES_DIR/.previous.new" "$RELEASES_DIR/previous"
  fi
  date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/DEPLOYED_AT"
  prune_old_releases
  prune_unreferenced_images
  log "DEPLOYED $sha"
  log "  web      $MINHAJ_WEB_IMAGE"
  log "  realtime $MINHAJ_REALTIME_IMAGE"
  log "  ops      $MINHAJ_OPS_IMAGE"
  log "  previous ${previous:-none}"
  exit 0
fi

# --- 5. rollback ---------------------------------------------------------------
if [ -n "$previous" ] && [ "$previous" != "$sha" ]; then
  log "deployment of $sha FAILED; restoring previous release $previous"
  if release_compose "$RELEASES_DIR/$previous" up -d --wait --wait-timeout 300 web realtime proxy \
    && edge_smoke; then
    die "deployment of $sha failed; previous release $previous restored and healthy"
  fi
  die "deployment of $sha failed AND restoring $previous failed; operator action required"
fi
die "deployment of $sha failed and there is no previous release to restore"
