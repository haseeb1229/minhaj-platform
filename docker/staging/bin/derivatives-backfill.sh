#!/usr/bin/env bash
# =============================================================================
# derivatives-backfill.sh — Storage's WebP image derivatives on staging (R2)
# =============================================================================
#
#   derivatives-backfill.sh [--limit <n>]
#
# Runs `staging-storage-derivatives` in the exact-SHA operations image of the
# deployed release, in the `ops` service (the staging storage root mounted, the
# scanner on the internal network). It proves the staging target in full, then
# runs the backfill as the RUNTIME principal: every picture a published record
# shows now is put to its owning context's public policy and its missing
# widths (320, 640, 960, 1440; never wider than the picture) are stored through
# Storage's own custody. Nothing restricted, drafted or withdrawn is decoded.
#
# Idempotent and resumable: run it again after a migration publish, or when
# `complete` is false. The last output line is the command's JSON summary:
# counts only.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
ops_json staging-storage-derivatives "$@"
