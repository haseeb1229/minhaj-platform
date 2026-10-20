#!/usr/bin/env bash
# =============================================================================
# seed.sh [--remove] — the synthetic staging fixture (explicit, idempotent)
# =============================================================================
#
# Exactly one stored asset whose bytes say what they are: a SYNTHETIC recovery
# fixture, not content. It exists so backup and restore can be proven over a
# real Asset row and its real bytes. No religious text, no person, no member,
# donor or student, nothing fetched from a legacy source.
#
# `--remove` deletes exactly that fixture (row and bytes) and nothing else.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
case "${1:-}" in
  '') ops staging-seed ;;
  --remove) ops staging-seed --remove ;;
  *) die "usage: seed.sh [--remove]" ;;
esac
