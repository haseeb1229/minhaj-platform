#!/usr/bin/env bash
# =============================================================================
# Shared host-side helpers for the staging scripts — Phase 28
# =============================================================================
#
# SOURCED, never executed. Every staging script starts with:
#
#   . "$(dirname "$0")/lib.sh"
#
# THE TARGET IS PROVEN, NOT ASSUMED. Before anything mutates, `assert_staging_host`
# demands several INDEPENDENT signals that this machine is the One Minhaj
# staging host, and refuses on any mismatch:
#
#   1. `/etc/minhaj/staging.env` declares MINHAJ_DEPLOYMENT_ENVIRONMENT=staging
#      and a well-formed environment id (written once by bootstrap-host.sh);
#   2. the Azure Instance Metadata Service reports THIS VM's resource id equal
#      to the one recorded there, and the VM carries the tag environment=staging;
#   3. `/srv/minhaj/.minhaj-staging-root` holds the same environment id, so a
#      data disk from somewhere else is not mistaken for this one.
#
# A host name, a directory name or a database name alone is never enough.
#
# SECRETS. Nothing here prints a token, password or connection string. Bearer
# tokens travel to curl through a 0600 header file, never argv (argv is visible
# in the process table). `set -x` is forbidden in every staging script.
# =============================================================================

set -euo pipefail
umask 077

readonly MINHAJ_SRV=/srv/minhaj
# shellcheck disable=SC2034 # used by bootstrap-host.sh, which sources this file
readonly MINHAJ_ETC=/etc/minhaj
readonly STAGING_ENV_FILE=/etc/minhaj/staging.env
readonly STAGING_ROOT_MARKER=/srv/minhaj/.minhaj-staging-root
readonly RELEASES_DIR=/srv/minhaj/releases
readonly IMDS=http://169.254.169.254/metadata

# The only keys staging.env may contain. An unknown key is a refusal, not a
# silently ignored line: the file is an identity, and identities do not grow.
readonly STAGING_ENV_KEYS='MINHAJ_DEPLOYMENT_ENVIRONMENT MINHAJ_STAGING_ENVIRONMENT_ID MINHAJ_PUBLIC_HOST MINHAJ_AZURE_VM_RESOURCE_ID MINHAJ_ACR_LOGIN_SERVER MINHAJ_BACKUP_ACCOUNT MINHAJ_BACKUP_CONTAINER'

readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

log() { printf 'minhaj-staging: %s\n' "$*"; }
die() { printf 'minhaj-staging: REFUSED: %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "must run as root (sudo)"
}

# -----------------------------------------------------------------------------
# Identity
# -----------------------------------------------------------------------------

# Parses staging.env strictly into shell variables. Values are taken verbatim;
# the file is root-owned and written only by bootstrap-host.sh.
load_staging_identity() {
  [ -f "$STAGING_ENV_FILE" ] || die "$STAGING_ENV_FILE is missing (run bootstrap-host.sh first)"
  [ "$(stat -c '%u' "$STAGING_ENV_FILE")" = 0 ] || die "$STAGING_ENV_FILE must be owned by root"

  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    [[ "$line" =~ ^([A-Z_]+)=([^[:space:]\"\'\$\`]+)$ ]] || die "malformed line in $STAGING_ENV_FILE"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case " $STAGING_ENV_KEYS " in *" $key "*) ;; *) die "unexpected key $key in $STAGING_ENV_FILE" ;; esac
    printf -v "$key" '%s' "$value"
  done < "$STAGING_ENV_FILE"

  [ "${MINHAJ_DEPLOYMENT_ENVIRONMENT:-}" = staging ] || die "deployment environment is not exactly 'staging'"
  [[ "${MINHAJ_STAGING_ENVIRONMENT_ID:-}" =~ $UUID_PATTERN ]] || die "environment id is not a lowercase UUID v4"
  [[ "${MINHAJ_PUBLIC_HOST:-}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "public host is malformed"
  [[ "${MINHAJ_AZURE_VM_RESOURCE_ID:-}" =~ ^/subscriptions/[0-9a-f-]{36}/resourceGroups/[A-Za-z0-9._-]+/providers/Microsoft\.Compute/virtualMachines/[A-Za-z0-9._-]+$ ]] || die "VM resource id is malformed"
  [[ "${MINHAJ_ACR_LOGIN_SERVER:-}" =~ ^[a-z0-9]{5,50}\.azurecr\.io$ ]] || die "registry login server is malformed"
  [[ "${MINHAJ_BACKUP_ACCOUNT:-}" =~ ^[a-z0-9]{3,24}$ ]] || die "backup account is malformed"
  [[ "${MINHAJ_BACKUP_CONTAINER:-}" =~ ^[a-z0-9-]{3,63}$ ]] || die "backup container is malformed"
}

imds_compute() {
  curl -fsS --max-time 5 -H 'Metadata: true' "$IMDS/instance/compute?api-version=2021-02-01"
}

# The independent signals described in the header. Call after load_staging_identity.
assert_staging_host() {
  local compute resource_id environment_tag marker
  compute="$(imds_compute)" || die "the Azure metadata service did not answer; this is not the staging VM"
  resource_id="$(printf '%s' "$compute" | jq -r '.resourceId')"
  environment_tag="$(printf '%s' "$compute" | jq -r '[.tagsList[]? | select(.name == "environment") | .value][0] // ""')"

  # Azure reports resource-group names case-insensitively; compare that way.
  [ "${resource_id,,}" = "${MINHAJ_AZURE_VM_RESOURCE_ID,,}" ] || die "this VM is not the recorded staging VM"
  [ "$environment_tag" = staging ] || die "this VM is not tagged environment=staging"

  [ -f "$STAGING_ROOT_MARKER" ] || die "$STAGING_ROOT_MARKER is missing; /srv/minhaj is not the staging data disk"
  marker="$(cat "$STAGING_ROOT_MARKER")"
  [ "$marker" = "$MINHAJ_STAGING_ENVIRONMENT_ID" ] || die "the data disk belongs to a different environment"
  mountpoint -q "$MINHAJ_SRV" || die "$MINHAJ_SRV is not a mounted data disk"
}

staging_preflight() {
  require_root
  load_staging_identity
  assert_staging_host
}

# -----------------------------------------------------------------------------
# Release references
# -----------------------------------------------------------------------------

assert_sha() {
  [[ "$1" =~ $SHA_PATTERN ]] || die "not a full 40-character lowercase commit SHA"
}

# `<registry>/minhaj/<name>@sha256:<64 hex>` — a digest, never a tag, and only
# from the staging registry recorded in staging.env.
#
# The registry is compared as an exact string, never spliced into a regex: a
# dot in a host name must not become a wildcard.
assert_image_ref() {
  local ref="$1" name="$2"
  [ "${ref%%/*}" = "$MINHAJ_ACR_LOGIN_SERVER" ] || die "image reference for $name is not from the staging registry"
  [[ "${ref#*/}" =~ ^minhaj/${name}@sha256:[0-9a-f]{64}$ ]] || die "image reference for $name is not a digest"
}

# The SQL Server image is BUILT on the host from the release's reviewed
# Dockerfile, and only when it is absent: compose never rebuilds it on `up`,
# so a deploy can never recreate the database container as a side effect.
ensure_sqlserver_image() {
  local dir="$1"
  docker image inspect minhaj-platform-sqlserver-fts:16.0.4265.3 > /dev/null 2>&1 && return 0
  log "building the SQL Server image from the reviewed Dockerfile"
  release_compose "$dir" build --quiet sqlserver
}

# Containers must not reach the Azure Instance Metadata Service: the VM's
# managed identity can read and write the backups and pull images, and a
# compromised web, realtime, scanner or certbot process must not be able to
# mint its tokens. bootstrap-host.sh installs the rule at boot, before Docker
# starts any container; host processes are unaffected (DOCKER-USER sees only
# forwarded container traffic).
assert_imds_guard() {
  iptables -C DOCKER-USER -d 169.254.169.254/32 -m comment --comment minhaj-imds-guard -j DROP 2> /dev/null \
    || die "containers can reach the Azure metadata service (the IMDS guard is missing; run bootstrap-host.sh)"
}

release_dir() {
  assert_sha "$1"
  printf '%s/%s' "$RELEASES_DIR" "$1"
}

current_release_sha() {
  [ -L "$RELEASES_DIR/current" ] || return 1
  basename "$(readlink -f "$RELEASES_DIR/current")"
}

# docker compose for one release, with that release's pinned images.
#
# `--progress quiet`: pull and build progress would otherwise flood the output,
# and Azure Run Command returns only the LAST 4 KB of it — an error must never
# be pushed out of that window by progress bars.
release_compose() {
  local dir="$1"
  shift
  docker compose --progress quiet --project-directory "$dir" -f "$dir/compose.yaml" \
    --env-file "$dir/release.env" "$@"
}

# -----------------------------------------------------------------------------
# Managed identity — no stored credential anywhere
# -----------------------------------------------------------------------------

# Prints an access token for the VM's system-assigned identity. Callers capture
# it into a variable and hand it to `bearer_header_file`; it is never logged.
imds_token() {
  local resource="$1"
  curl -fsS --max-time 10 -H 'Metadata: true' \
    "$IMDS/identity/oauth2/token?api-version=2018-02-01&resource=$resource" | jq -r '.access_token'
}

# Writes an Authorization header into a fresh 0600 file and prints its path.
bearer_header_file() {
  local token="$1" file
  file="$(mktemp)"
  chmod 600 "$file"
  printf 'Authorization: Bearer %s\n' "$token" > "$file"
  printf '%s' "$file"
}

# Logs Docker in to the staging registry for the next pull, using the VM's
# identity: an Entra token is exchanged for a short-lived ACR refresh token
# (`/oauth2/exchange`). No admin user, no stored password, no PAT.
acr_login() {
  local aad refresh
  aad="$(imds_token 'https://management.azure.com/')"
  # The token reaches curl on stdin (`@-`), never argv; printf adds no newline.
  refresh="$(printf '%s' "$aad" | curl -fsS --max-time 20 -X POST \
    "https://$MINHAJ_ACR_LOGIN_SERVER/oauth2/exchange" \
    --data-urlencode 'grant_type=access_token' \
    --data-urlencode "service=$MINHAJ_ACR_LOGIN_SERVER" \
    --data-urlencode 'access_token@-' | jq -r '.refresh_token')"
  unset aad
  [ -n "$refresh" ] && [ "$refresh" != null ] || die "the registry refused the VM identity"
  printf '%s' "$refresh" | docker login "$MINHAJ_ACR_LOGIN_SERVER" \
    --username 00000000-0000-0000-0000-000000000000 --password-stdin > /dev/null
  unset refresh
}

acr_logout() {
  docker logout "$MINHAJ_ACR_LOGIN_SERVER" > /dev/null 2>&1 || true
}

# -----------------------------------------------------------------------------
# Backup storage — Azure Blob over HTTPS with the VM's identity
# -----------------------------------------------------------------------------

readonly BLOB_API_VERSION=2023-11-03

blob_url() {
  printf 'https://%s.blob.core.windows.net/%s/%s' "$MINHAJ_BACKUP_ACCOUNT" "$MINHAJ_BACKUP_CONTAINER" "$1"
}

# One authenticated Blob request. The bearer token exists only in a 0600 header
# file, which is removed whether curl succeeds or fails.
blob_curl() {
  local header token rc=0
  token="$(imds_token 'https://storage.azure.com/')"
  header="$(bearer_header_file "$token")"
  unset token
  curl -fsS -H "@$header" -H "x-ms-version: $BLOB_API_VERSION" "$@" || rc=$?
  rm -f "$header"
  return "$rc"
}

readonly BLOB_SINGLE_PUT_LIMIT=$((256 * 1024 * 1024))
readonly BLOB_BLOCK_MIB=100

# blob_put <local file> <blob name>
#
# Streams from disk (`-T`), never buffering a file in memory. Up to 256 MiB is
# one Put Blob; anything larger is uploaded as 100 MiB blocks and committed
# with Put Block List, with only one block on disk at a time — so backups keep
# working once migrated content (Phase 30) makes the Storage archive large.
blob_put() {
  local file="$1" name="$2" size url
  size="$(stat -c %s "$file")"
  url="$(blob_url "$name")"
  if [ "$size" -le "$BLOB_SINGLE_PUT_LIMIT" ]; then
    blob_curl --max-time 1800 -H 'x-ms-blob-type: BlockBlob' -H 'Content-Type: application/octet-stream' \
      -T "$file" "$url" > /dev/null
    return
  fi

  local chunk list index=0 id rc=0
  local ids=()
  chunk="$(mktemp)"
  while [ $((index * BLOB_BLOCK_MIB * 1048576)) -lt "$size" ]; do
    dd if="$file" of="$chunk" bs=1M skip=$((index * BLOB_BLOCK_MIB)) count="$BLOB_BLOCK_MIB" status=none || rc=$?
    # Block ids: base64 of equal-length strings, as the service requires.
    id="$(printf 'minhaj-block-%08d' "$index" | base64 -w0)"
    [ "$rc" -eq 0 ] && { blob_curl --max-time 1800 -T "$chunk" "$url?comp=block&blockid=$(printf '%s' "$id" | jq -sRr '@uri')" > /dev/null || rc=$?; }
    [ "$rc" -eq 0 ] || { rm -f "$chunk"; return "$rc"; }
    ids+=("$id")
    index=$((index + 1))
  done
  rm -f "$chunk"

  list="$(mktemp)"
  {
    printf '<?xml version="1.0" encoding="utf-8"?><BlockList>'
    printf '<Latest>%s</Latest>' "${ids[@]}"
    printf '</BlockList>'
  } > "$list"
  blob_curl --max-time 300 -H 'Content-Type: application/xml' -T "$list" "$url?comp=blocklist" > /dev/null || rc=$?
  rm -f "$list"
  return "$rc"
}

# blob_get <blob name> <local file>
blob_get() {
  blob_curl --max-time 1800 -o "$2" "$(blob_url "$1")"
}

# blob_size <blob name> — the stored length, from a HEAD request.
blob_size() {
  blob_curl --max-time 30 -I "$(blob_url "$1")" \
    | tr -d '\r' | awk -F': ' 'tolower($1) == "content-length" { print $2 }'
}

# blob_list <prefix> — one blob name per line.
blob_list() {
  blob_curl --max-time 30 \
    "https://$MINHAJ_BACKUP_ACCOUNT.blob.core.windows.net/$MINHAJ_BACKUP_CONTAINER?restype=container&comp=list&prefix=$1" \
    | grep -o '<Name>[^<]*</Name>' | sed -e 's/<Name>//' -e 's/<\/Name>//'
}

# -----------------------------------------------------------------------------
# Serialisation — one staging operation at a time on this host
# -----------------------------------------------------------------------------

# Deploy, migrate, backup, restore proof and reset all take the same lock, so a
# scheduled backup can never interleave with a reset or a release switch.
#
# Re-entrant across processes: a script that already holds the lock (migrate
# and reset both take a backup first) marks it in the environment, and the
# child inherits the locked descriptor rather than waiting on itself.
host_lock() {
  [ "${MINHAJ_HOST_LOCK_HELD:-}" = 1 ] && return 0
  exec 9> /run/lock/minhaj-staging.lock
  flock -w 900 9 || die "another staging operation holds the host lock"
  export MINHAJ_HOST_LOCK_HELD=1
}

# The release whose operations image runs `ops` commands: the deployed one,
# unless MINHAJ_OPS_RELEASE names an already-fetched release — which is how a
# migration runs with the NEW release's migrations before its app is switched.
current_release_dir() {
  if [ -n "${MINHAJ_OPS_RELEASE:-}" ]; then
    local dir
    dir="$(release_dir "$MINHAJ_OPS_RELEASE")"
    [ -f "$dir/release.env" ] || die "release $MINHAJ_OPS_RELEASE is not on this host"
    printf '%s' "$dir"
    return 0
  fi
  [ -L "$RELEASES_DIR/current" ] || die "no release is deployed on this host yet"
  readlink -f "$RELEASES_DIR/current"
}

# ops <script> [args...] — one explicit operator command in the exact-SHA
# operations image of that release. Prints the command's output.
ops() {
  local script="$1"
  shift
  [[ "$script" =~ ^staging-[a-z-]+$ ]] || die "not a staging operations command: $script"
  release_compose "$(current_release_dir)" --profile ops run --rm --no-deps -T ops \
    "packages/database/scripts/$script.ts" "$@"
}

# ingest <register|run> [args...] — the authorised-source runner (Phase 30):
# `staging-migration-run` in the exact-SHA operations image, in the `ingest`
# service, the ONE operator container with an outbound network. Arguments are
# validated again, strictly, by the command itself.
ingest() {
  release_compose "$(current_release_dir)" --profile ingest run --rm --no-deps -T ingest     packages/database/scripts/staging-migration-run.ts "$@"
}

# The final line of an ops command's output, which by contract is one JSON
# object summarising the result.
ops_json() {
  ops "$@" | tail -n 1 | jq -c . || die "$1 did not end with a JSON summary"
}

# -----------------------------------------------------------------------------
# Releases
# -----------------------------------------------------------------------------

readonly RELEASE_ENV_KEYS='MINHAJ_RELEASE_SHA MINHAJ_PUBLIC_HOST MINHAJ_WEB_IMAGE MINHAJ_REALTIME_IMAGE MINHAJ_OPS_IMAGE'

# Reads `<release>/release.env` strictly. The release's public host is kept as
# RELEASE_PUBLIC_HOST so it can be compared with the host identity, not
# silently replace it.
load_release_env() {
  local file="$1/release.env" line key value
  [ -f "$file" ] || die "$file is missing"
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^([A-Z_]+)=([^[:space:]\"\'\$\`]+)$ ]] || die "malformed line in $file"
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case " $RELEASE_ENV_KEYS " in *" $key "*) ;; *) die "unexpected key $key in $file" ;; esac
    [ "$key" = MINHAJ_PUBLIC_HOST ] && key=RELEASE_PUBLIC_HOST
    printf -v "$key" '%s' "$value"
  done < "$file"
  [ -n "${MINHAJ_RELEASE_SHA:-}" ] && [ -n "${RELEASE_PUBLIC_HOST:-}" ] || die "$file is incomplete"
}

readonly SECRETS_DIR=/etc/minhaj/secrets
readonly EDGE_NETRC=/etc/minhaj/secrets/edge.netrc
readonly TLS_DIR=/srv/minhaj/tls

assert_root_only() {
  local file="$1"
  [ -f "$file" ] || die "$file is missing (run bootstrap-host.sh)"
  [ "$(stat -c '%u %a' "$file")" = '0 600' ] || die "$file must be owned by root with mode 600"
}

assert_host_prerequisites() {
  local file
  for file in app.env sqlserver.env ops.env edge.netrc; do
    assert_root_only "$SECRETS_DIR/$file"
  done
  [ -s /srv/minhaj/edge-auth/htpasswd ] || die "the edge credential is not provisioned (run bootstrap-host.sh)"
  [ -s "$TLS_DIR/fullchain.pem" ] && [ -s "$TLS_DIR/privkey.pem" ] \
    || die "no TLS certificate is installed (run bin/tls.sh issue)"
}

# Keeps `current`, `previous` and the three most recent other releases; removes
# only directories whose name is a full commit SHA.
prune_old_releases() {
  local keep_current keep_previous name
  keep_current="$(current_release_sha || true)"
  keep_previous="$([ -L "$RELEASES_DIR/previous" ] && basename "$(readlink -f "$RELEASES_DIR/previous")" || true)"
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -rn | cut -d' ' -f2 \
    | grep -E "$SHA_PATTERN" | while read -r name; do
    [ "$name" = "$keep_current" ] || [ "$name" = "$keep_previous" ] && continue
    printf '%s\n' "$name"
  done | tail -n +4 | while read -r name; do
    rm -rf -- "${RELEASES_DIR:?}/$name"
  done
}

# Removes this platform's release images (web, realtime, ops) that neither the
# current nor the previous release references. Each deploy pulls ~6 GB of new
# digests; without this the root disk fills within a handful of deploys. A
# retained older release can still be restored, because every digest stays
# pullable from the registry. Never touches volumes or the SQL Server, ClamAV,
# NGINX or certbot images, and never forces removal of an image a container
# uses. Refuses, removing nothing, unless both releases' digests were read.
# The releases directory is an argument only so a test can point it elsewhere.
prune_unreferenced_images() {
  local releases="${1:-$RELEASES_DIR}" keep ref id
  keep="$(cat "$releases/current/release.env" "$releases/previous/release.env" 2> /dev/null \
    | grep -E '^MINHAJ_(WEB|REALTIME|OPS)_IMAGE=' | cut -d= -f2- | tr -d '"' | sort -u)" || true
  if [ "$(printf '%s\n' "$keep" | grep -c '@sha256:')" -lt 3 ]; then
    log "image prune skipped: the current and previous release digests could not be read"
    return 0
  fi
  docker images --digests --format '{{.Repository}}@{{.Digest}} {{.ID}}' | while read -r ref id; do
    case "$ref" in
      */minhaj/web@sha256:* | */minhaj/realtime@sha256:* | */minhaj/ops@sha256:*) ;;
      *) continue ;;
    esac
    printf '%s\n' "$keep" | grep -qxF "$ref" && continue
    docker image rm "$id" > /dev/null 2>&1 || true
  done
}

# -----------------------------------------------------------------------------
# The real edge, probed from the host itself
# -----------------------------------------------------------------------------

# The bootstrap certificate exists only so NGINX can start before Let's
# Encrypt has validated the host; it is never an acceptable final state.
tls_is_placeholder() {
  openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -subject 2> /dev/null | grep -q 'minhaj-staging-placeholder'
}

# edge_probe <path> <yes|no: send the environment credential>
# Prints "<http status> <x-robots-tag noindex present: 1|0>".
edge_probe() {
  local path="$1" auth="$2" headers status robots
  local args=(-sS --max-time 20 --http1.1 --resolve "$MINHAJ_PUBLIC_HOST:443:127.0.0.1" -o /dev/null -D -)
  tls_is_placeholder && args+=(-k)
  [ "$auth" = yes ] && args+=(--netrc-file "$EDGE_NETRC")
  headers="$(curl "${args[@]}" "https://$MINHAJ_PUBLIC_HOST$path" | tr -d '\r')" || return 1
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  robots="$(printf '%s\n' "$headers" | grep -ci '^x-robots-tag: noindex, nofollow' || true)"
  printf '%s %s' "$status" "$robots"
}

# The minimum every deployment must show at the edge. Returns non-zero, naming
# the first failed expectation, rather than exiting — the caller decides
# whether that means rollback.
edge_smoke() {
  local result body
  tls_is_placeholder && log "WARNING: TLS is still the bootstrap placeholder; run bin/tls.sh issue"

  result="$(edge_probe /robots.txt no)" || { log "smoke: robots.txt unreachable"; return 1; }
  [ "$result" = '200 1' ] || { log "smoke: robots.txt expected '200 1', got '$result'"; return 1; }
  local insecure=()
  tls_is_placeholder && insecure=(-k)
  body="$(curl -sS --max-time 20 --resolve "$MINHAJ_PUBLIC_HOST:443:127.0.0.1" \
    "${insecure[@]}" "https://$MINHAJ_PUBLIC_HOST/robots.txt")"
  printf '%s' "$body" | grep -qx 'Disallow: /' || { log "smoke: robots.txt does not disallow /"; return 1; }

  result="$(edge_probe /en no)" || { log "smoke: /en unreachable"; return 1; }
  [ "$result" = '401 1' ] || { log "smoke: /en without the credential expected '401 1', got '$result'"; return 1; }

  result="$(edge_probe /en yes)" || { log "smoke: authorised /en unreachable"; return 1; }
  [ "$result" = '200 1' ] || { log "smoke: authorised /en expected '200 1', got '$result'"; return 1; }

  result="$(edge_probe '/socket.io/?EIO=4&transport=websocket' no)" || { log "smoke: socket path unreachable"; return 1; }
  [ "${result%% *}" = 401 ] || { log "smoke: the WebSocket path is not behind the environment gate ('$result')"; return 1; }

  log "edge smoke passed (TLS, gate, robots, X-Robots-Tag)"
}
