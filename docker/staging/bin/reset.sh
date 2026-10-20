#!/usr/bin/env bash
# =============================================================================
# reset.sh --confirm "reset MinhajStaging <environment-id>" [--seed]
# =============================================================================
#
# The ONLY destructive staging operation, and deliberately awkward to run:
#
#   - an operator types the exact confirmation, which names THIS environment's
#     id — a command copied from another environment cannot match;
#   - the full staging host proof runs first (lib.sh);
#   - a FRESH backup set is taken and uploaded before anything is removed; its
#     `.bak` stays on the server's backup path as the evidence staging-reset
#     demands;
#   - web and realtime are stopped, so nothing writes during the reset — and
#     restarted whatever happens next, so a refused reset never leaves the
#     site down;
#   - `staging-reset` (in the ops image) re-checks the database fingerprint,
#     refuses the runtime and operator principals, requires that backup, then
#     drops and recreates MinhajStaging and re-applies migrations and
#     principals;
#   - only then are the contents of the staging storage root removed — the
#     positively identified staging data disk, never any other path.
#
# Nothing calls this automatically: not a deploy, not a migration, not a timer.
# Once migrated content exists here (Phase 30), a reset discards it; the
# backup taken first is the way back.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

confirmation='' seed=no
while [ "$#" -gt 0 ]; do
  case "$1" in
    --confirm) confirmation="${2:-}"; shift 2 ;;
    --seed) seed=yes; shift ;;
    *) die 'usage: reset.sh --confirm "reset MinhajStaging <environment-id>" [--seed]' ;;
  esac
done

staging_preflight
[ "$confirmation" = "reset MinhajStaging $MINHAJ_STAGING_ENVIRONMENT_ID" ] \
  || die "the confirmation does not name this staging environment exactly"
host_lock
dir="$(current_release_dir)"

log "taking a fresh backup set before the reset"
bash "$(dirname "$(readlink -f "$0")")/backup.sh" > /dev/null

restart_application() {
  release_compose "$dir" up -d --wait --wait-timeout 300 web realtime proxy \
    || log "WARNING: web, realtime or proxy did not come back healthy; operator action required"
}

log "stopping web and realtime"
release_compose "$dir" stop web realtime
trap restart_application EXIT

ops staging-reset --confirm "$confirmation"

storage="$MINHAJ_SRV/storage"
[ "$(readlink -f "$storage")" = "$storage" ] || die "$storage is not a plain directory on the staging disk"
find "$storage" -mindepth 1 -delete
log "staging storage root emptied"

[ "$seed" = yes ] && ops staging-seed

trap - EXIT
restart_application
log "RESET COMPLETE for environment $MINHAJ_STAGING_ENVIRONMENT_ID"
ops_json staging-inspect
