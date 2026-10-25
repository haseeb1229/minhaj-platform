#!/usr/bin/env bash
# =============================================================================
# rotate-edge-credential.sh — replace the staging environment (edge) credential
# =============================================================================
#
# The staging host's HTTP Basic Authentication credential (SECURITY_BASELINE.md
# §21.1) is created once by bootstrap-host.sh. This command REPLACES it, and is
# what to run the moment the credential may have been disclosed.
#
#   1. proves the staging host (lib.sh) and takes the host lock, so it never
#      interleaves with a deploy, migration, backup, restore proof or reset;
#   2. requires the live secret files to have their provisioned owners and modes;
#   3. generates a NEW credential here, on the host, from the CSPRNG: never an
#      argument, never from CI or chat;
#   4. prepares the new bcrypt file (password on stdin) and the new root-only
#      netrc beside the live ones, verifies the hash, then switches each with a
#      same-filesystem rename — the htpasswd first, so the previous credential
#      stops working at the edge before anything else changes;
#   5. reloads only the NGINX proxy; SQL Server, the application, its keys and
#      the database principals are not touched;
#   6. proves, printing status codes only: unauthenticated -> 401, previous
#      credential -> 401, new credential -> 200 with noindex, robots.txt
#      readable and disallowing /, and the application layer unchanged behind
#      the gate (/my and /admin still need a session, the migration API refuses
#      an anonymous caller, the realtime handshake refuses a sessionless client).
#
# SECRET-SILENT. Neither the previous nor the new value is printed, logged,
# placed in a URL or passed as an argument; curl authenticates only through
# `--netrc-file`, and only status codes leave a probe. An operator who needs
# the new value reads it on the host: `sudo cat /etc/minhaj/secrets/edge.netrc`.
#
# FAIL CLOSED. Once the new htpasswd is in place the previous credential is
# never restored, whatever happens next. If any later step or proof fails, the
# edge proxy is STOPPED and the command exits non-zero: staging becomes
# unreachable rather than possibly open, and the operator deallocates the VM
# or investigates.
#
# Runs directly on the host (`sudo bash bin/rotate-edge-credential.sh`) or
# through Azure Run Command with NO parameters. Run Command delivers this file
# alone, so the helpers are then taken from the deployed release.
# =============================================================================

# Run Command may start the script with `sh` rather than honouring the shebang.
# This one line is POSIX, so `sh` executes it before reaching any bash syntax.
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi

set -euo pipefail
umask 077

[ "$(id -u)" -eq 0 ] || { printf 'minhaj-staging: REFUSED: must run as root\n' >&2; exit 1; }
[ "$#" -eq 0 ] || { printf 'minhaj-staging: REFUSED: takes no arguments\n' >&2; exit 1; }

lib="$(dirname "$(readlink -f "$0")")/lib.sh"
[ -f "$lib" ] || lib="$(readlink -f /srv/minhaj/releases/current)/bin/lib.sh"
# The helpers run as root, so they must be root's and writable by nobody else.
[ -f "$lib" ] && [ "$(stat -c '%u' "$lib")" = 0 ] && [ -z "$(find "$lib" -perm /022)" ] \
  || { printf 'minhaj-staging: REFUSED: no root-owned lib.sh beside this script or in the current release\n' >&2; exit 1; }
# shellcheck source=lib.sh
. "$lib"

staging_preflight
host_lock

readonly EDGE_HTPASSWD="$MINHAJ_SRV/edge-auth/htpasswd"
readonly EDGE_USER=minhaj-staging
readonly NGINX_GID=101

assert_root_only "$EDGE_NETRC"
[ -s "$EDGE_HTPASSWD" ] || die "$EDGE_HTPASSWD is missing (run bootstrap-host.sh)"
[ "$(stat -c '%u %g %a' "$EDGE_HTPASSWD")" = "0 $NGINX_GID 640" ] \
  || die "$EDGE_HTPASSWD must be owned by root, group $NGINX_GID, mode 640"
command -v htpasswd > /dev/null || die "htpasswd (apache2-utils) is not installed"

release="$(current_release_dir)"
release_compose "$release" ps --status running --services | grep -qx proxy \
  || die "the edge proxy is not running; rotate with the edge up so the change can be proven"

# --- secret material: root-only, beside the live files, removed on every path --
work="$(mktemp -d "$SECRETS_DIR/.rotate.XXXXXX")"
staged_htpasswd="$(mktemp "$MINHAJ_SRV/edge-auth/.htpasswd.XXXXXX")"
switched=0
verified=0

on_exit() {
  local status=$?
  rm -rf -- "$work"
  rm -f -- "$staged_htpasswd"
  if [ "$switched" = 1 ] && [ "$verified" != 1 ]; then
    release_compose "$release" stop proxy > /dev/null 2>&1 || true
    log "rotation FAILED after the switch: the edge proxy is STOPPED (fail closed); the previous credential stays revoked"
  fi
  exit "$status"
}
trap on_exit EXIT

# probe_status <netrc file|-> <path> [curl args...] — the HTTP status, nothing else.
probe_status() {
  local netrc="$1" path="$2"
  shift 2
  local args=(-sS --max-time 20 --http1.1 --resolve "$MINHAJ_PUBLIC_HOST:443:127.0.0.1" -o /dev/null -w '%{http_code}')
  tls_is_placeholder && args+=(-k)
  [ "$netrc" = - ] || args+=(--netrc-file "$netrc")
  curl "${args[@]}" "$@" "https://$MINHAJ_PUBLIC_HOST$path" 2> /dev/null || true
}

# 40 characters from the CSPRNG, the same shape bootstrap-host.sh provisions.
new_password() {
  local value
  value="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  [ "${#value}" -eq 40 ] || return 1
  printf 'Mn7-%s' "$value"
}

# The previous credential, kept only to prove it is refused afterwards.
cp -- "$EDGE_NETRC" "$work/previous.netrc"
log "before rotation: current credential -> $(probe_status "$work/previous.netrc" /en)"

password="$(new_password)" || die "could not generate a new credential"
printf 'machine %s login %s password %s\n' "$MINHAJ_PUBLIC_HOST" "$EDGE_USER" "$password" > "$work/edge.netrc"
printf '%s' "$password" | htpasswd -i -B -C 6 -c "$staged_htpasswd" "$EDGE_USER" 2> /dev/null
printf '%s' "$password" | htpasswd -v -i "$staged_htpasswd" "$EDGE_USER" > /dev/null 2>&1 \
  || die "the new bcrypt entry does not verify; nothing was switched"
unset password

[ "$(wc -l < "$staged_htpasswd")" -eq 1 ] && [[ "$(< "$staged_htpasswd")" == "$EDGE_USER:"'$2y$06$'* ]] \
  || die "the new htpasswd is not one bcrypt entry for $EDGE_USER; nothing was switched"
chown root:"$NGINX_GID" "$staged_htpasswd"
chmod 0640 "$staged_htpasswd"
chmod 0600 "$work/edge.netrc"

# --- switch: from here on the previous credential is never restored ------------
switched=1
mv -f -- "$staged_htpasswd" "$EDGE_HTPASSWD"
mv -f -- "$work/edge.netrc" "$EDGE_NETRC"
assert_root_only "$EDGE_NETRC"
[ "$(stat -c '%u %g %a' "$EDGE_HTPASSWD")" = "0 $NGINX_GID 640" ] || die "the switched htpasswd has the wrong owner or mode"
release_compose "$release" exec -T proxy nginx -s reload > /dev/null 2>&1 || die "the edge proxy did not reload"
log "switched: new htpasswd and netrc in place, previous credential revoked, proxy reloaded"

# --- proof: status codes only ------------------------------------------------
failed=0
check() {
  if [[ "$2" =~ ^($3)$ ]]; then
    log "verify: $1 -> $2 PASS"
  else
    log "verify: $1 -> $2 FAIL (expected $3)"
    failed=1
  fi
}
uuid=00000000-0000-4000-8000-000000000000

check 'unauthenticated /en' "$(edge_probe /en no)" '401 1'
check 'previous credential /en' "$(probe_status "$work/previous.netrc" /en)" '401'
check 'new credential /en (status, noindex)' "$(edge_probe /en yes)" '200 1'
check 'robots.txt (status, noindex)' "$(edge_probe /robots.txt no)" '200 1'
robots_disallow="$(curl -sS --max-time 20 --resolve "$MINHAJ_PUBLIC_HOST:443:127.0.0.1" \
  "https://$MINHAJ_PUBLIC_HOST/robots.txt" 2> /dev/null | grep -cx 'Disallow: /' || true)"
check 'robots.txt disallows /' "$robots_disallow" '1'
check 'new credential /en/signin' "$(probe_status "$EDGE_NETRC" /en/signin)" '200'
check 'new credential /en/my without a session' "$(probe_status "$EDGE_NETRC" /en/my)" '30[2378]'
check 'new credential /en/admin without a session' "$(probe_status "$EDGE_NETRC" /en/admin)" '30[2378]'
check 'new credential /en/admin/migration without a session' "$(probe_status "$EDGE_NETRC" /en/admin/migration)" '30[2378]'
check 'new credential migration API without a session' "$(probe_status "$EDGE_NETRC" "/api/admin/migration/runs/$uuid")" '404'
check 'new credential realtime handshake without a session' "$(probe_status "$EDGE_NETRC" '/socket.io/?EIO=4&transport=websocket' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==')" '400|401|403'

[ "$failed" = 0 ] || die "post-rotation proof failed"
verified=1
log "edge credential ROTATED: previous credential refused, new credential admitted, unauthenticated refused, application layer unchanged"
