#!/usr/bin/env bash
# =============================================================================
# bootstrap-host.sh — one-time preparation of the staging host (idempotent)
# =============================================================================
#
#   sudo bash bootstrap-host.sh \
#     --vm-resource-id <Azure resource id of THIS VM> \
#     --public-host <approved staging host> \
#     --acr <registry login server> \
#     --backup-account <storage account> --backup-container <container> \n#     [--environment-id <existing id>]
#
# `--environment-id` is for REBUILDING the host of an existing environment
# (disaster recovery): its backup sets and its database fingerprint carry that
# id, and a fresh one would — correctly — refuse to restore them. Omitted, a
# new environment id is minted once.
#
# Run once, from a copy of `docker/staging/` taken from a reviewed commit, by
# the staging operator over SSH. Re-running changes nothing that exists.
#
# WHAT IT DOES
#   - refuses unless the Azure metadata service confirms this VM is the named
#     resource AND carries the tag environment=staging;
#   - writes the non-secret identity /etc/minhaj/staging.env (a fresh
#     environment id, once) and the data-disk marker;
#   - creates the /srv/minhaj layout with the owners the containers run as;
#   - generates every staging secret into root-only files under
#     /etc/minhaj/secrets — SQL `sa`, the runtime and operator principals, the
#     application keys and the environment (edge) credential. None is printed,
#     none is ever the same as any other environment's;
#   - writes the bcrypt edge credential for NGINX and a TLS placeholder so the
#     first deploy can start the proxy (tls.sh issue then replaces it);
#   - installs the daily backup and TLS renewal timers.
#
# WHAT IT NEVER DOES: no database, no migration, no seed, no deployment.
#
# The operator reads the edge credential, when needed, with
#   sudo cat /etc/minhaj/secrets/edge.netrc
# on the host itself. It is never sent anywhere by these scripts. This script
# only CREATES it; bin/rotate-edge-credential.sh replaces it.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root

usage() { die "usage: bootstrap-host.sh --vm-resource-id ID --public-host HOST --acr SERVER --backup-account NAME --backup-container NAME [--environment-id ID]"; }
vm_id='' public_host='' acr='' backup_account='' backup_container='' environment_id=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --vm-resource-id) vm_id="${2:-}"; shift 2 ;;
    --public-host) public_host="${2:-}"; shift 2 ;;
    --acr) acr="${2:-}"; shift 2 ;;
    --backup-account) backup_account="${2:-}"; shift 2 ;;
    --backup-container) backup_container="${2:-}"; shift 2 ;;
    --environment-id) environment_id="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$vm_id" ] && [ -n "$public_host" ] && [ -n "$acr" ] && [ -n "$backup_account" ] && [ -n "$backup_container" ] || usage

source_dir="$(dirname "$(readlink -f "$0")")/.."

export DEBIAN_FRONTEND=noninteractive
log "installing host tools (jq, apache2-utils for bcrypt htpasswd)"
apt-get install -y -qq jq apache2-utils openssl curl > /dev/null

mountpoint -q "$MINHAJ_SRV" || die "$MINHAJ_SRV is not the mounted data disk"

# --- identity -------------------------------------------------------------------
install -d -o root -g root -m 0755 "$MINHAJ_ETC"
if [ ! -f "$STAGING_ENV_FILE" ]; then
  if [ -n "$environment_id" ]; then
    [[ "$environment_id" =~ $UUID_PATTERN ]] || die "--environment-id is not a lowercase UUID v4"
  else
    environment_id="$(cat /proc/sys/kernel/random/uuid)"
  fi
  {
    printf '# One Minhaj STAGING identity — written once by bootstrap-host.sh. Not a secret.\n'
    printf 'MINHAJ_DEPLOYMENT_ENVIRONMENT=staging\n'
    printf 'MINHAJ_STAGING_ENVIRONMENT_ID=%s\n' "$environment_id"
    printf 'MINHAJ_PUBLIC_HOST=%s\n' "$public_host"
    printf 'MINHAJ_AZURE_VM_RESOURCE_ID=%s\n' "$vm_id"
    printf 'MINHAJ_ACR_LOGIN_SERVER=%s\n' "$acr"
    printf 'MINHAJ_BACKUP_ACCOUNT=%s\n' "$backup_account"
    printf 'MINHAJ_BACKUP_CONTAINER=%s\n' "$backup_container"
  } > "$STAGING_ENV_FILE"
  chmod 0644 "$STAGING_ENV_FILE"
fi
load_staging_identity
[ "$MINHAJ_PUBLIC_HOST" = "$public_host" ] && [ "${MINHAJ_AZURE_VM_RESOURCE_ID,,}" = "${vm_id,,}" ] \
  || die "$STAGING_ENV_FILE already describes a different host"
[ -f "$STAGING_ROOT_MARKER" ] || printf '%s' "$MINHAJ_STAGING_ENVIRONMENT_ID" > "$STAGING_ROOT_MARKER"
assert_staging_host

# --- layout ---------------------------------------------------------------------
readonly MSSQL_UID=10001 NODE_UID=1000 NGINX_GID=101
install -d -o "$MSSQL_UID" -g 0 -m 0770 "$MINHAJ_SRV/sqlserver"
install -d -o "$NODE_UID" -g "$NODE_UID" -m 0750 "$MINHAJ_SRV/storage"
install -d -o root -g root -m 0700 "$MINHAJ_SRV/restore" "$MINHAJ_SRV/backups" "$MINHAJ_SRV/letsencrypt"
install -d -o "$NODE_UID" -g "$NODE_UID" -m 0750 "$MINHAJ_SRV/restore/storage"
install -d -o root -g "$NGINX_GID" -m 0750 "$MINHAJ_SRV/tls" "$MINHAJ_SRV/edge-auth"
install -d -o root -g root -m 0755 "$MINHAJ_SRV/acme" "$RELEASES_DIR"
install -d -o root -g root -m 0700 "$SECRETS_DIR"

# --- secrets (generated here, never printed, never overwritten) ----------------
# Letters and digits only, so a value is safe inside a SQL Server URL's
# `{...}` quoting and in an env file; the prefix satisfies SQL Server's
# complexity policy (upper, lower, digit, symbol).
generate() { printf 'Mn7-%s' "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"; }

write_secret_file() {
  local file="$1"
  shift
  [ -f "$file" ] && return 0
  local temp
  temp="$(mktemp "$SECRETS_DIR/.new.XXXXXX")"
  printf '%s\n' "$@" > "$temp"
  chmod 0600 "$temp"
  mv "$temp" "$file"
}

# The three database secret files share passwords (sa, the runtime and the
# operator principals), so they are generated and moved into place TOGETHER.
# A partial set means an interrupted earlier run against a SQL Server that may
# already hold the first password: that is refused, never "repaired" by
# generating new values that would not match it.
present=0
for file in sqlserver.env ops.env app.env; do
  [ -f "$SECRETS_DIR/$file" ] && present=$((present + 1))
done
case "$present" in
  3) ;;
  0)
    sa_password="$(generate)"
    app_password="$(generate)"
    operator_password="$(generate)"
    staging_dir="$(mktemp -d "$SECRETS_DIR/.new.XXXXXX")"
    printf '%s\n' "MSSQL_SA_PASSWORD=$sa_password" > "$staging_dir/sqlserver.env"
    printf '%s\n' \
      "DATABASE_MIGRATION_URL=sqlserver://sqlserver:1433;database=MinhajStaging;user=sa;password={$sa_password};encrypt=true;trustServerCertificate=true" \
      "DATABASE_APP_LOGIN=minhaj_app" \
      "DATABASE_APP_PASSWORD=$app_password" \
      "DATABASE_OPERATOR_LOGIN=minhaj_operator_staging" \
      "DATABASE_OPERATOR_PASSWORD=$operator_password" > "$staging_dir/ops.env"
    # The application never receives `sa` or the operator credential: only the
    # runtime principal's URL.
    printf '%s\n' \
      "DATABASE_URL=sqlserver://sqlserver:1433;database=MinhajStaging;user=minhaj_app;password={$app_password};encrypt=true;trustServerCertificate=true" \
      "AUTH_SECRETS=1:$(generate)" \
      "RATE_LIMIT_DIGEST_KEY=$(generate)" \
      "EMAIL_DIGEST_KEY=$(generate)" \
      "NEWSLETTER_TOKEN_KEY=$(generate)" > "$staging_dir/app.env"
    unset sa_password app_password operator_password
    chmod 0600 "$staging_dir"/*.env
    for file in sqlserver.env ops.env app.env; do mv "$staging_dir/$file" "$SECRETS_DIR/$file"; done
    rmdir "$staging_dir"
    ;;
  *) die "a partial secret set exists in $SECRETS_DIR; inspect it by hand rather than regenerating" ;;
esac

if [ ! -f "$EDGE_NETRC" ]; then
  edge_password="$(generate)"
  write_secret_file "$EDGE_NETRC" "machine $MINHAJ_PUBLIC_HOST login minhaj-staging password $edge_password"
  # bcrypt, password on stdin (never argv). Cost 6, deliberately: NGINX
  # re-checks the hash on EVERY request (a page load is dozens), and the
  # credential is 40 random characters, so a slow hash would buy no security
  # while making each request — and each guess — expensive for the server.
  printf '%s' "$edge_password" | htpasswd -i -B -C 6 -c "$MINHAJ_SRV/edge-auth/htpasswd" minhaj-staging 2> /dev/null
  unset edge_password
  chown root:"$NGINX_GID" "$MINHAJ_SRV/edge-auth/htpasswd"
  chmod 0640 "$MINHAJ_SRV/edge-auth/htpasswd"
fi

# --- TLS placeholder (so the first deploy can start NGINX) --------------------
if [ ! -s "$TLS_DIR/fullchain.pem" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 -subj "/CN=minhaj-staging-placeholder" \
    -keyout "$TLS_DIR/privkey.pem" -out "$TLS_DIR/fullchain.pem" 2> /dev/null
  chown root:"$NGINX_GID" "$TLS_DIR/privkey.pem" "$TLS_DIR/fullchain.pem"
  chmod 0640 "$TLS_DIR/privkey.pem"
  chmod 0644 "$TLS_DIR/fullchain.pem"
fi

# --- units ----------------------------------------------------------------------
for unit in minhaj-staging-backup.service minhaj-staging-backup.timer \
  minhaj-staging-tls-renew.service minhaj-staging-tls-renew.timer \
  minhaj-staging-imds-guard.service; do
  install -o root -g root -m 0644 "$source_dir/systemd/$unit" "/etc/systemd/system/$unit"
done
# Docker must not start before the data disk is mounted: a missing mount would
# otherwise let SQL Server initialise an empty instance on the OS disk and web
# write authoritative bytes there.
install -d -o root -g root -m 0755 /etc/systemd/system/docker.service.d
install -o root -g root -m 0644 "$source_dir/systemd/docker-requires-minhaj-disk.conf" \
  /etc/systemd/system/docker.service.d/minhaj-staging-disk.conf
systemctl daemon-reload
systemctl enable --now minhaj-staging-imds-guard.service > /dev/null
systemctl enable --now minhaj-staging-backup.timer minhaj-staging-tls-renew.timer > /dev/null
assert_imds_guard

log "host prepared for environment $MINHAJ_STAGING_ENVIRONMENT_ID ($MINHAJ_PUBLIC_HOST)"
