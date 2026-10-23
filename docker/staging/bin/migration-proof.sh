#!/usr/bin/env bash
# =============================================================================
# migration-proof.sh — the Phase-29 migration FIXTURE proof on MinhajStaging
# =============================================================================
#
# Runs `staging-migration-proof` in the exact-SHA operations image of the
# deployed release (or of MINHAJ_OPS_RELEASE). That command proves the staging
# target in full — configuration, internal host, the SQL container's machine
# name and the database fingerprint — then:
#
#   1. writes ONE disposable synthetic operator (`@migration-proof.invalid`)
#      with the MIGRATION principal: the migration and media keys, a live
#      session and a live `migration-publication` step-up;
#   2. runs the proof in a child process as the RUNTIME principal, whose only
#      database setting is a URL built inside the container from ops.env's
#      DATABASE_APP_LOGIN / DATABASE_APP_PASSWORD — never on this host, never
#      in argv, never printed. The proof registers a unique fixture source,
#      serves its synthetic pages from a LOOPBACK fixture server inside the
#      container (no legacy host, no DNS, no outbound request), runs, resumes,
#      publishes through Media, promotes into a temporary bundle, withdraws,
#      and rolls back;
#   3. revokes the operator's assignment and deletes its session and grant —
#      also when the proof failed. Audit rows and the archived synthetic Videos
#      stay, as the record of what was proved.
#
# The last output line is the command's JSON summary.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
[ "$#" -eq 0 ] || die "usage: migration-proof.sh"
ops_json staging-migration-proof
