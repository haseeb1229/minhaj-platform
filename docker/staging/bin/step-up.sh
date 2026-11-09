#!/usr/bin/env bash
# =============================================================================
# step-up.sh — a staging HOST-ISSUED step-up grant (Rebaseline R2)
# =============================================================================
#
#   step-up.sh grant --account <accountId> --purpose <purpose> [--minutes <1-15>]
#
# Owner decision 2026-11-09 (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP,
# OPEN_DECISIONS.md §4.2; SECURITY_BASELINE.md §8.1): on the staging host,
# where root already holds the SQL Server administrator credential, the
# operator may issue the SAME short-lived step-up grant the browser issues, so
# the operator commands whose gates re-check the grant LIVE run unattended:
#
#   step-up.sh grant --account <id> --purpose quran-canonical-edit --minutes 15
#   quran-reference.sh import --sha256 <hex> --operator <id>
#
# Production keeps every confirmation unchanged and never runs this.
#
# BEFORE ANYTHING: root, the staging host proof (lib.sh), and the deployed web
# service must be the non-indexable staging build. The command refuses again
# unless it is told, exactly, that this deployment is staging and not
# indexable; then Identity's own service checks the account is active, holds
# a permission the purpose's gate demands, has a complete second-factor
# posture and a LIVE session (sign in once, in the ordinary way), binds the
# grant to that session for at most 15 minutes (default 5), and writes the
# browser step-up's own audit record, marked host-issued. `second-factor` is
# never host-issued.
#
# NO HOST LOCK. The command writes one grant row and one audit row through the
# runtime principal and touches no release, schema, Storage or migration
# state, so it does not conflict with an ingest, a backup or a deploy and must
# not wait up to 15 minutes behind one. A concurrent reset or restore can only
# remove the grant (it dies with its session) — the failure is closed. The
# command that USES the grant takes the lock as before.
#
# The last output line is the command's JSON summary: identifiers, the purpose
# and the expiry. Never a token or a password.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
case "${1:-}" in
  grant)
    assert_not_indexable
    release_compose "$(current_release_dir)" --profile ops run --rm --no-deps -T \
      -e PUBLIC_INDEXING_ENABLED=false ops \
      packages/database/scripts/staging-step-up.ts "$@" < /dev/null \
      | tail -n 1 | jq -c . || die "staging-step-up did not end with a JSON summary"
    ;;
  *) die "usage: step-up.sh grant --account <accountId> --purpose <purpose> [--minutes <1-15>]" ;;
esac
