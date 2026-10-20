#!/usr/bin/env bash
# `pass` always succeeds, so every `condition && pass ... || fail ...` below is
# a true if/else: `fail` runs only when the condition is false.
# shellcheck disable=SC2015
# =============================================================================
# Staging edge proof — Phase 28
# =============================================================================
#
# Runs the REAL staging front door (`docker/nginx/staging/default.conf.template`
# on the pinned NGINX image) against two echo upstreams standing in for web and
# realtime, with a THROWAWAY self-signed certificate and a THROWAWAY credential
# generated here and deleted afterwards, and asserts the edge contract:
#
#   - every path (pages, /my, /admin, assets, APIs, sitemap, 404s and the
#     WebSocket path) is refused without the environment credential, and with
#     a wrong one;
#   - the right credential is admitted — and is NOT forwarded to the
#     application (`Authorization` is cleared);
#   - `X-Robots-Tag: noindex, nofollow` is on every response, including 401s,
#     and an application's own X-Robots-Tag cannot replace it;
#   - /robots.txt is public and disallows everything;
#   - forwarding headers are the edge's own, never the client's;
#   - port 80 serves only the ACME challenge and a fixed-host redirect;
#   - a TLS client asking for any other host name is refused at the handshake.
#
# This is a proof of the CONFIGURATION, run in CI and locally. It is not the
# Phase 28 exit evidence, which is the same matrix against the real staging
# host (`docker/staging/bin/deploy.sh`, the staging deploy workflow).
# =============================================================================

set -euo pipefail

readonly NGINX_IMAGE='nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5'
readonly NODE_IMAGE='node:24.20.0-bookworm-slim'
readonly HOST='staging.invalid'
readonly NETWORK='minhaj-staging-edge-proof'
readonly HTTPS_PORT=18443
readonly HTTP_PORT=18080

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
failures=0

cleanup() {
  docker rm -f minhaj-edge-proof-proxy minhaj-edge-proof-web minhaj-edge-proof-realtime > /dev/null 2>&1 || true
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Docker on Windows (Git Bash) needs native paths for bind mounts.
host_path() { if command -v cygpath > /dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
export MSYS_NO_PATHCONV=1

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# --- throwaway certificate and credential ---------------------------------------
mkdir -p "$work/tls" "$work/auth" "$work/acme/.well-known/acme-challenge"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj "/CN=$HOST" \
  -addext "subjectAltName=DNS:$HOST" \
  -keyout "$(host_path "$work/tls/privkey.pem")" -out "$(host_path "$work/tls/fullchain.pem")" 2> /dev/null
password="proof-$(openssl rand -hex 16)"
printf 'edge-proof:%s\n' "$(printf '%s' "$password" | openssl passwd -6 -stdin)" > "$work/auth/htpasswd"
chmod 0644 "$work/auth/htpasswd" "$work/tls/privkey.pem"
printf 'proof-token-body' > "$work/acme/.well-known/acme-challenge/proof-token"

# --- echo upstreams ---------------------------------------------------------------
cat > "$work/echo.js" << 'EOF'
const http = require('node:http');
http
  .createServer((request, response) => {
    // An application trying to make a page indexable must not win at the edge.
    response.setHeader('X-Robots-Tag', 'index, follow');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ role: process.env.ROLE, method: request.method, url: request.url, headers: request.headers }));
  })
  .listen(Number(process.env.PORT), '0.0.0.0');
EOF

docker network create "$NETWORK" > /dev/null
for role in web realtime; do
  port=3000
  [ "$role" = realtime ] && port=3200
  docker run -d --name "minhaj-edge-proof-$role" --network "$NETWORK" \
    -e ROLE="$role" -e PORT="$port" -v "$(host_path "$work/echo.js"):/echo.js:ro" \
    "$NODE_IMAGE" node /echo.js > /dev/null
done

docker run -d --name minhaj-edge-proof-proxy --network "$NETWORK" \
  -p "127.0.0.1:$HTTP_PORT:80" -p "127.0.0.1:$HTTPS_PORT:443" \
  -e NGINX_ENVSUBST_FILTER='^MINHAJ_' \
  -e MINHAJ_PUBLIC_HOST="$HOST" \
  -e MINHAJ_WEB_UPSTREAM=minhaj-edge-proof-web:3000 \
  -e MINHAJ_REALTIME_UPSTREAM=minhaj-edge-proof-realtime:3200 \
  -v "$(host_path "$repo/docker/nginx/staging"):/etc/nginx/templates:ro" \
  -v "$(host_path "$work/tls"):/etc/nginx/tls:ro" \
  -v "$(host_path "$work/auth"):/etc/nginx/edge-auth:ro" \
  -v "$(host_path "$work/acme"):/var/www/acme:ro" \
  "$NGINX_IMAGE" > /dev/null

for _ in $(seq 1 30); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$HOST:$HTTPS_PORT:127.0.0.1" "https://$HOST:$HTTPS_PORT/robots.txt" || true)"
  [ "$code" = 200 ] && break
  sleep 1
done
[ "${code:-}" = 200 ] || { docker logs minhaj-edge-proof-proxy; echo "the staging edge did not start"; exit 1; }

# --- the matrix ---------------------------------------------------------------------
https() { curl -sk --max-time 10 --resolve "$HOST:$HTTPS_PORT:127.0.0.1" "$@"; }
status_of() { https -o /dev/null -w '%{http_code}' "$@"; }
headers_of() { https -o /dev/null -D - "$@" | tr -d '\r'; }
noindex() { headers_of "$@" | grep -ci '^x-robots-tag: noindex, nofollow' || true; }
robots_headers() { headers_of "$@" | grep -ci '^x-robots-tag:' || true; }

base="https://$HOST:$HTTPS_PORT"
good=(-u "edge-proof:$password")
bad=(-u "edge-proof:wrong-$password")

for path in /en /ur /ar /signin /my /admin /assets/synthetic /api/my/anything /sitemap.xml /no-such-page '/socket.io/?EIO=4&transport=websocket'; do
  [ "$(status_of "$base$path")" = 401 ] && pass "no credential: $path -> 401" || fail "no credential: $path is not refused"
  [ "$(status_of "${bad[@]}" "$base$path")" = 401 ] && pass "wrong credential: $path -> 401" || fail "wrong credential: $path is not refused"
  [ "$(noindex "$base$path")" = 1 ] && pass "401 for $path carries X-Robots-Tag" || fail "401 for $path lacks X-Robots-Tag"
done

[ "$(status_of "${good[@]}" "$base/en")" = 200 ] && pass "right credential: /en admitted" || fail "right credential: /en not admitted"
[ "$(noindex "${good[@]}" "$base/en")" = 1 ] && pass "admitted page carries X-Robots-Tag noindex" || fail "admitted page lacks X-Robots-Tag noindex"
[ "$(robots_headers "${good[@]}" "$base/en")" = 1 ] && pass "the application's X-Robots-Tag is replaced, not added" || fail "the application's X-Robots-Tag reached the client"

echoed="$(https "${good[@]}" -H 'X-Forwarded-For: 203.0.113.9' -H 'X-Forwarded-Host: evil.example' "$base/en")"
printf '%s' "$echoed" | grep -q '"authorization"' && fail "the environment credential reached the application" || pass "Authorization is cleared before the application"
printf '%s' "$echoed" | grep -q '203.0.113.9' && fail "a client X-Forwarded-For reached the application" || pass "client X-Forwarded-For is overwritten"
printf '%s' "$echoed" | grep -q 'evil.example' && fail "a client X-Forwarded-Host reached the application" || pass "client X-Forwarded-Host is cleared"
printf '%s' "$echoed" | grep -q '"x-forwarded-proto":"https"' && pass "X-Forwarded-Proto is https" || fail "X-Forwarded-Proto is not https"
printf '%s' "$echoed" | grep -q '"role":"web"' && pass "ordinary paths reach web" || fail "ordinary paths do not reach web"

socket="$(https "${good[@]}" "$base/socket.io/?EIO=4&transport=websocket")"
printf '%s' "$socket" | grep -q '"role":"realtime"' && pass "authorised /socket.io/ reaches realtime" || fail "authorised /socket.io/ does not reach realtime"
printf '%s' "$socket" | grep -q '"authorization"' && fail "the credential reached realtime" || pass "Authorization is cleared before realtime"
[ "$(status_of "${good[@]}" -X POST "$base/socket.io/")" = 403 ] && pass "non-GET on /socket.io/ is refused" || fail "non-GET on /socket.io/ is not refused"

[ "$(status_of "$base/robots.txt")" = 200 ] && pass "robots.txt is public" || fail "robots.txt is not public"
https "$base/robots.txt" | grep -qx 'Disallow: /' && pass "robots.txt disallows /" || fail "robots.txt does not disallow /"
https "$base/robots.txt" | grep -qi 'sitemap' && fail "robots.txt advertises a sitemap" || pass "robots.txt advertises no sitemap"
[ "$(noindex "$base/robots.txt")" = 1 ] && pass "robots.txt carries X-Robots-Tag" || fail "robots.txt lacks X-Robots-Tag"

http_base="http://127.0.0.1:$HTTP_PORT"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "$http_base/.well-known/acme-challenge/proof-token")" = 200 ] \
  && pass "port 80 serves the ACME challenge without a credential" || fail "port 80 does not serve the ACME challenge"
location="$(curl -s -o /dev/null -D - -H 'Host: evil.example' "$http_base/en?x=1" | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }')"
[ "$location" = "https://$HOST/en?x=1" ] && pass "port 80 redirects to the fixed HTTPS host" || fail "port 80 redirect is '$location'"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "$http_base/.well-known/acme-challenge/../../etc/passwd")" != 200 ] \
  && pass "the ACME path does not escape its directory" || fail "the ACME path escaped its directory"

wrong_host="$(https -o /dev/null -D - -H 'Host: other.invalid' "$base/en" | tr -d '\r')"
printf '%s\n' "$wrong_host" | awk 'NR == 1 { exit !($2 == 421) }' \
  && pass "a foreign Host on an approved TLS connection is answered 421, never proxied" \
  || fail "a foreign Host on an approved TLS connection was not refused"
printf '%s\n' "$wrong_host" | grep -qi '^x-robots-tag: noindex' \
  && pass "the 421 carries X-Robots-Tag" || fail "the 421 lacks X-Robots-Tag"

if curl -sk --max-time 10 --resolve "other.invalid:$HTTPS_PORT:127.0.0.1" "https://other.invalid:$HTTPS_PORT/" -o /dev/null 2> /dev/null; then
  fail "a TLS client for another host name was answered"
else
  pass "a TLS client for another host name is refused at the handshake"
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%s staging edge expectation(s) FAILED\n' "$failures"
  docker logs minhaj-edge-proof-proxy 2>&1 | tail -n 20
  exit 1
fi
printf '\nstaging edge proof: all expectations held\n'
