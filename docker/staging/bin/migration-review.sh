#!/usr/bin/env bash
# =============================================================================
# migration-review.sh — the staging HOST REVIEW of a completed run (Rebaseline R2)
# =============================================================================
#
#   migration-review.sh status      --operator <id> (--run <runId> | --source <key>)
#   migration-review.sh approve-run --run <runId> --operator <id> [--note <text>]
#                                   [--confirm-count <n> --confirm-fingerprint <hex>]
#   migration-review.sh rights      --run <runId> --host <host> --operator <id>
#                                   [--licence organisation-owned|licensed
#                                    --evidence <text> --rights-holder <text>
#                                    [--decide-non-first-party-host <host>]]
#                                   [--confirm-count <n> --confirm-fingerprint <hex>]
#   migration-review.sh manifest    --run <runId> --operator <id>
#                                   [--confirm-count <n> --confirm-fingerprint <hex>]
#   migration-review.sh publish     --manifest <id> --operator <id>
#                                   [--confirm-version <n> [--session <id>]]
#   migration-review.sh editorial   --kind <kind> --approver <secondAdminId>
#                                   [--confirm-count <n> --confirm-fingerprint <hex>]
#
# Owner decision 2026-11-09 (OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP,
# OPEN_DECISIONS.md §4.2; MIGRATION_STRATEGY.md §19.2): on the staging host
# the operator performs, as the named administrators, the acts a person
# otherwise clicks in /admin/migration and /admin/editorial for a completed
# run — through the SAME services, with every rule they keep: the run-wide
# confirmation of a set's size and fingerprint, 150 per act, the
# open-duplicate question before each approval, manifests of 100, the
# publisher's `migration.publish` with a live `migration-publication` step-up
# (`step-up.sh grant` first), and Editorial's second administrator (approver
# never the author, at most 25 per kind per act). Production never runs this.
#
# Every act WITHOUT its confirmation is a preview: it prints the exact set the
# confirmed act will take. Pictures: only first-party Minhaj hosts are decided
# public, with evidence naming the R2 attestation; any other host stays
# restricted unless --decide-non-first-party-host repeats it. The licence,
# evidence and rights holder are always stated; nothing defaults.
#
# BEFORE ANYTHING: root, the staging host proof (lib.sh), and the deployed web
# service must be the non-indexable staging build. The command refuses again
# unless it is told, exactly, that this deployment is staging and not
# indexable. It holds the host lock: it does not run beside an ingest, a
# backup or a deploy (issue the step-up AFTER such a run, not before it).
#
# SEARCH: a published record's search request is written with it; the web
# service's own sweep indexes it within about thirty seconds.
#
# The last output line is the command's JSON summary: identifiers, counts and
# reason codes. Never a title, a payload, a token or a password.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
case "${1:-}" in
  status | approve-run | rights | manifest | publish | editorial) ;;
  *) die "usage: migration-review.sh status|approve-run|rights|manifest|publish|editorial ... (see the header)" ;;
esac
assert_not_indexable
host_lock
release_compose "$(current_release_dir)" --profile ops run --rm --no-deps -T \
  -e PUBLIC_INDEXING_ENABLED=false ops \
  packages/database/scripts/staging-migration-review.ts "$@" < /dev/null \
  | tail -n 1 | jq -c . || die "staging-migration-review did not end with a JSON summary"
