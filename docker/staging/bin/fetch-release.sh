#!/usr/bin/env bash
# =============================================================================
# fetch-release.sh <sha> <web-digest> <realtime-digest> <ops-digest>
# =============================================================================
#
# The ONE staging script that runs before its release exists on the host. The
# staging deploy workflow sends this file — from the exact commit being
# deployed — through Azure Run Command (no inbound SSH from GitHub), with four
# positional arguments and nothing else.
#
# It does the minimum needed to obtain that commit's own deploy bundle:
#
#   1. read the registry name from the host's staging identity;
#   2. log Docker in with the VM's managed identity (no stored credential);
#   3. pull the three images BY DIGEST and confirm each digest locally;
#   4. extract `/opt/minhaj-staging` from the OPS image of that same commit
#      into `/srv/minhaj/releases/<sha>/` and write its `release.env`;
#   5. hand over to that release's own `bin/deploy.sh`, which performs the full
#      staging target proof before changing anything that runs.
#
# Steps 1–4 only ADD a release directory; they never stop, start or replace a
# running container. The identity checks therefore repeat in deploy.sh rather
# than being trusted from here.
# =============================================================================

# Run Command may start the script with `sh` rather than honouring the shebang.
# This one line is POSIX, so `sh` executes it before reaching any bash syntax.
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi

set -euo pipefail
umask 077

die() { printf 'minhaj-staging: REFUSED: %s\n' "$*" >&2; exit 1; }
log() { printf 'minhaj-staging: %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ "$#" -eq 4 ] || [ "$#" -eq 5 ] \
  || die "usage: fetch-release.sh <sha> <web-digest> <realtime-digest> <ops-digest> [deploy|migrate-and-deploy]"

sha="$1"
mode="${5:-deploy}"
case "$mode" in deploy | migrate-and-deploy) ;; *) die "mode must be deploy or migrate-and-deploy" ;; esac
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "not a full 40-character lowercase commit SHA"
for digest in "$2" "$3" "$4"; do
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "image digests must be sha256:<64 hex>"
done

registry="$(grep -E '^MINHAJ_ACR_LOGIN_SERVER=[a-z0-9]{5,50}\.azurecr\.io$' /etc/minhaj/staging.env | cut -d= -f2)"
[ -n "$registry" ] || die "/etc/minhaj/staging.env does not name a staging registry"

web="$registry/minhaj/web@$2"
realtime="$registry/minhaj/realtime@$3"
ops="$registry/minhaj/ops@$4"

releases=/srv/minhaj/releases
target="$releases/$sha"

# --- 2. registry login with the VM identity ----------------------------------
aad="$(curl -fsS --max-time 10 -H 'Metadata: true' \
  'http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/' \
  | jq -r '.access_token')"
refresh="$(printf '%s' "$aad" | curl -fsS --max-time 20 -X POST "https://$registry/oauth2/exchange" \
  --data-urlencode 'grant_type=access_token' \
  --data-urlencode "service=$registry" \
  --data-urlencode 'access_token@-' | jq -r '.refresh_token')"
unset aad
[ -n "$refresh" ] && [ "$refresh" != null ] || die "the registry refused the VM identity"
printf '%s' "$refresh" | docker login "$registry" \
  --username 00000000-0000-0000-0000-000000000000 --password-stdin > /dev/null
unset refresh
trap 'docker logout "$registry" > /dev/null 2>&1 || true' EXIT

# --- 3. pull by digest and confirm --------------------------------------------
for ref in "$web" "$realtime" "$ops"; do
  docker pull --quiet "$ref" > /dev/null
  docker image inspect --format '{{join .RepoDigests "\n"}}' "$ref" | grep -qxF "$ref" \
    || die "the pulled image does not carry the requested digest"
done
# Nothing after this point pulls; the short-lived registry credential is
# removed now rather than at exit, because the final `exec` skips EXIT traps.
docker logout "$registry" > /dev/null 2>&1 || true
trap - EXIT
log "pulled web, realtime and ops for $sha by digest"

# --- 4. extract this commit's bundle ------------------------------------------
mkdir -p "$releases"
if [ -d "$target" ]; then
  # Re-deploying the same commit: the images are digest-identical, so the
  # bundle already extracted from this ops digest is reused unchanged.
  grep -qxF "MINHAJ_OPS_IMAGE=$ops" "$target/release.env" \
    || die "release $sha already exists from a different ops image"
else
  staging_dir="$(mktemp -d "$releases/.incoming.XXXXXX")"
  container="$(docker create "$ops")"
  docker cp "$container:/opt/minhaj-staging/." "$staging_dir/" > /dev/null
  docker rm "$container" > /dev/null
  [ -f "$staging_dir/compose.yaml" ] && [ -f "$staging_dir/bin/deploy.sh" ] \
    || die "the ops image does not contain a staging bundle"
  public_host="$(grep -E '^MINHAJ_PUBLIC_HOST=' /etc/minhaj/staging.env | cut -d= -f2)"
  {
    printf 'MINHAJ_RELEASE_SHA=%s\n' "$sha"
    printf 'MINHAJ_PUBLIC_HOST=%s\n' "$public_host"
    printf 'MINHAJ_WEB_IMAGE=%s\n' "$web"
    printf 'MINHAJ_REALTIME_IMAGE=%s\n' "$realtime"
    printf 'MINHAJ_OPS_IMAGE=%s\n' "$ops"
  } > "$staging_dir/release.env"
  chmod -R go-w "$staging_dir"
  chmod 0755 "$staging_dir"
  mv "$staging_dir" "$target"
fi

# --- 5. the release's own migration (only when asked) and deploy ---------------
if [ "$mode" = migrate-and-deploy ]; then
  bash "$target/bin/migrate.sh" "$sha"
fi
exec bash "$target/bin/deploy.sh" "$sha"
