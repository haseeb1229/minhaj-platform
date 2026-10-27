#!/usr/bin/env bash
# =============================================================================
# identity-bootstrap.sh — the one-time initial Platform Administrator on staging
# =============================================================================
#
#   identity-bootstrap.sh --user <accountId> --ticket "<reason>"
#
# Runs `staging-identity-bootstrap` in the exact-SHA operations image of the
# deployed release. That command proves the staging target in full, then asks
# the bootstrap procedure — as the OPERATOR principal, the only one granted it —
# to give the named, already-registered and verified account the protected
# Platform Administrator role. The procedure refuses if any administrator
# already exists, so this works exactly once per environment. The account must
# then enrol a second factor before it can exercise any protected capability.
#
# The last output line is the command's JSON summary; nothing printed is a
# credential.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
[ "$#" -eq 4 ] && [ "$1" = --user ] && [ "$3" = --ticket ] \
  || die 'usage: identity-bootstrap.sh --user <accountId> --ticket "<reason>"'
ops_json staging-identity-bootstrap "$@"
