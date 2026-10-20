#!/usr/bin/env bash
# =============================================================================
# tls.sh issue | renew — the staging certificate (Let's Encrypt, HTTP-01)
# =============================================================================
#
# issue  First issuance. If no certificate is installed yet, a short-lived
#        self-signed PLACEHOLDER is written first so NGINX can start and serve
#        the ACME challenge on port 80; Let's Encrypt then validates through
#        that path and the real certificate replaces the placeholder. The
#        placeholder is never an acceptable final state: deploy.sh and the
#        edge smoke both name it.
# renew  Run by the systemd timer. `certbot renew` only acts inside the renewal
#        window; the installed copy and NGINX are refreshed only when the
#        certificate actually changed.
#
# KEYS STAY ON THE HOST. Let's Encrypt state lives in /srv/minhaj/letsencrypt;
# NGINX reads a copy in /srv/minhaj/tls readable by root and the NGINX group
# only. Neither directory is in any image, artifact, backup upload or log.
# No e-mail address is registered with the CA (no personal data leaves the
# host); expiry is handled by the renewal timer, not by CA mail.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

[ "$#" -eq 1 ] || die "usage: tls.sh issue|renew"
mode="$1"
staging_preflight
host_lock

dir="$RELEASES_DIR/current"
[ -L "$dir" ] || die "no release is deployed yet; deploy once before issuing TLS"
dir="$(readlink -f "$dir")"

readonly NGINX_GID=101
live="/srv/minhaj/letsencrypt/live/$MINHAJ_PUBLIC_HOST"

install_certificate() {
  install -o root -g "$NGINX_GID" -m 0644 "$live/fullchain.pem" "$TLS_DIR/fullchain.pem"
  install -o root -g "$NGINX_GID" -m 0640 "$live/privkey.pem" "$TLS_DIR/privkey.pem"
  release_compose "$dir" exec -T proxy nginx -s reload
}

fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 2> /dev/null || true
}

certbot() {
  release_compose "$dir" --profile acme run --rm --no-deps certbot "$@"
}

case "$mode" in
  issue)
    install -d -o root -g "$NGINX_GID" -m 0750 "$TLS_DIR"
    if [ ! -s "$TLS_DIR/fullchain.pem" ]; then
      log "installing a bootstrap placeholder certificate so NGINX can answer the ACME challenge"
      openssl req -x509 -nodes -newkey rsa:2048 -days 2 \
        -subj "/CN=minhaj-staging-placeholder" \
        -keyout "$TLS_DIR/privkey.pem" -out "$TLS_DIR/fullchain.pem" 2> /dev/null
      chown root:"$NGINX_GID" "$TLS_DIR/privkey.pem" "$TLS_DIR/fullchain.pem"
      chmod 0640 "$TLS_DIR/privkey.pem"
      chmod 0644 "$TLS_DIR/fullchain.pem"
      release_compose "$dir" up -d --wait --wait-timeout 300 proxy
    fi
    certbot certonly --webroot -w /var/www/acme -d "$MINHAJ_PUBLIC_HOST" \
      --agree-tos --non-interactive --register-unsafely-without-email --keep-until-expiring
    install_certificate
    tls_is_placeholder && die "the placeholder is still installed after issuance"
    log "certificate installed: $(openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -issuer -enddate | tr '\n' ' ')"
    ;;
  renew)
    before="$(fingerprint "$live/fullchain.pem")"
    certbot renew --webroot -w /var/www/acme --non-interactive
    after="$(fingerprint "$live/fullchain.pem")"
    if [ "$before" != "$after" ]; then
      install_certificate
      log "certificate renewed and installed"
    else
      log "certificate not yet due for renewal"
    fi
    ;;
  *) die "usage: tls.sh issue|renew" ;;
esac
