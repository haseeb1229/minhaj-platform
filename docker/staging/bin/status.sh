#!/usr/bin/env bash
# =============================================================================
# status.sh — the non-secret staging post-state, read-only
# =============================================================================
#
# Release and image digests, service health, the edge smoke, the certificate,
# the database state from `staging-inspect`, and host capacity. Prints no
# secret: no connection string, password, token or credential.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
dir="$(current_release_dir)"
load_release_env "$dir"

log "environment $MINHAJ_STAGING_ENVIRONMENT_ID  host $MINHAJ_PUBLIC_HOST"
log "release $MINHAJ_RELEASE_SHA deployed $(cat "$dir/DEPLOYED_AT" 2> /dev/null || printf 'never')"
log "previous $([ -L "$RELEASES_DIR/previous" ] && basename "$(readlink -f "$RELEASES_DIR/previous")" || printf none)"
log "web      $MINHAJ_WEB_IMAGE"
log "realtime $MINHAJ_REALTIME_IMAGE"
log "ops      $MINHAJ_OPS_IMAGE"
release_compose "$dir" ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Ports}}'
log "certificate: $(openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -issuer -enddate | tr '\n' ' ')"
edge_smoke || log "edge smoke FAILED"
if (assert_imds_guard); then
  log "IMDS guard present: containers cannot reach the metadata service"
else
  log "WARNING: IMDS guard MISSING"
fi
ops_json staging-inspect
log "memory (MiB):"
free -m
log "disk:"
df -h / "$MINHAJ_SRV"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
