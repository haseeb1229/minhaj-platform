#!/usr/bin/env bash
# =============================================================================
# migration-run.sh — register or run ONE authorised migration source (Phase 30)
# =============================================================================
#
#   migration-run.sh register --source <key> --operator <accountId> \
#       --authorisation-reference <reference> --authorised-on <YYYY-MM-DD> [--activate]
#   migration-run.sh run --source <key> --operator <accountId> \
#       --pages <n> --limit <n> [--items <a,b,...>] [--max-items <n>]
#
# Runs `staging-migration-run` in the exact-SHA operations image of the
# deployed release, in the `ingest` service — the one operator container with
# an outbound network. That command proves the staging target in full, then
# starts the registration or the run as the RUNTIME principal: the operator's
# `migration.administer` is read live, the source's recorded written
# authorisation is required, and every request goes through the safe fetch
# boundary bound to the source's exact public hosts. Human review, rights,
# duplicates, mappings and publication stay in /admin/migration.
#
# The last output line is the command's JSON summary: counts and codes only.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
case "${1:-}" in
  register | run) ;;
  *) die "usage: migration-run.sh register|run --source <key> --operator <accountId> ..." ;;
esac
ingest "$@" | tail -n 1 | jq -c . || die "staging-migration-run did not end with a JSON summary"
