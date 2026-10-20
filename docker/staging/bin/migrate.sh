#!/usr/bin/env bash
# =============================================================================
# migrate.sh [<sha>] — the EXPLICIT staging schema step (never part of a deploy)
# =============================================================================
#
#   migrate.sh          use the deployed release's migrations
#   migrate.sh <sha>    use an already-fetched release's migrations (the deploy
#                       workflow's migrate-and-deploy mode, before the switch)
#
# Runs, in that release's exact-SHA operations image, behind the staging
# target guard (environment, environment id, `sqlserver:1433`,
# `MinhajStaging`, server machine name, database fingerprint):
#
#   staging-create     create MinhajStaging with its fingerprint (refuses to
#                      adopt an existing database that does not carry it)
#   staging-migrate    `prisma migrate deploy` — the reviewed history only
#   staging-provision  the runtime and operator principals, least privilege
#   staging-inspect    the resulting state, non-secret
#
# A backup set is taken first whenever the database already exists, so a
# migration is always one restore away from the state before it. That backup
# is recorded against the DEPLOYED release — the one whose schema it captures —
# not the incoming one. Migrations are never reversed automatically and
# history is never edited.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

[ "$#" -le 1 ] || die "usage: migrate.sh [<sha>]"
if [ "$#" -eq 1 ]; then
  assert_sha "$1"
  export MINHAJ_OPS_RELEASE="$1"
fi
staging_preflight
host_lock
dir="$(current_release_dir)"
ensure_sqlserver_image "$dir"
release_compose "$dir" up -d --wait --wait-timeout 600 sqlserver clamav

# An assignment, so a failed inspect stops here rather than reading as "no
# database" and skipping the backup.
exists="$(ops_json staging-inspect | jq -er '.databaseExists')"
case "$exists" in
  true)
    log "MinhajStaging exists; taking a backup set before migrating"
    if current_release_sha > /dev/null; then
      env -u MINHAJ_OPS_RELEASE bash "$(dirname "$(readlink -f "$0")")/backup.sh" > /dev/null
    else
      bash "$(dirname "$(readlink -f "$0")")/backup.sh" > /dev/null
    fi
    ;;
  false) ;;
  *) die "staging-inspect did not say whether MinhajStaging exists" ;;
esac

ops staging-create
ops staging-migrate
ops staging-provision
ops_json staging-inspect
