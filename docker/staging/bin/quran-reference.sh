#!/usr/bin/env bash
# =============================================================================
# quran-reference.sh — the Quran reference preview on staging (Rebaseline R2)
# =============================================================================
#
#   quran-reference.sh import --sha256 <hex> --operator <accountId> [--session <sessionId>]
#   quran-reference.sh translations --operator <accountId>
#   quran-reference.sh names --sha256 <metadata hex> --operator <accountId>
#
# Owner decision 2026-11-06 (OPEN_DECISIONS.md §1.1): staging may show the
# Tanzil Uthmani 1.1 text, verbatim (CC BY 3.0), with Minhaj-ul-Quran's own
# Irfan-ul-Quran translation from the staged migration revisions — labelled as
# not reviewed for this platform, never indexed, and shown only because the
# staging web service sets RELIGIOUS_REFERENCE_PREVIEW=enabled. Production never
# runs this.
#
# `import` reads the two files the operator downloaded once from tanzil.net
# and placed, readable by uid 1000, in
#   /srv/minhaj/imports/quran-reference/uthmani.xml
#   /srv/minhaj/imports/quran-reference/quran-data.xml
# mounted READ-ONLY into the exact-SHA operations image. The operator first
# confirms a `quran-canonical-edit` step-up on the admin Quran screen (it lasts
# five minutes) with an account holding quran.editCanonical; the command then
# registers the source as the owner, has the corpus accepted as the runtime
# principal under that live grant, and activates it. It resumes an interrupted
# import and refuses once the corpus is active.
#
# `translations` needs an account holding migration.read, quran.read and
# quran.administer.
#
# `names` (Quran Part 2) reads the same quran-data.xml, checks its SHA-256
# against --sha256 AND against the digest the registered reference source
# recorded, and saves each Surah's English display name and meaning (Tanzil's
# tname and ename, verbatim) through the Quran admin service. It needs an
# account holding quran.read and quran.administer, keeps any name an operator
# recorded, and changes nothing on a re-run.
#
# The last output line is the command's JSON summary: identifiers and counts.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

readonly IMPORT_DIR="$MINHAJ_SRV/imports/quran-reference"
readonly MOUNTED=/var/lib/minhaj/quran-reference

staging_preflight
host_lock
case "${1:-}" in
  import)
    case " $* " in
      *' --text '* | *' --meta '*) die "the files are read from $IMPORT_DIR, not named on the command line" ;;
    esac
    [ -r "$IMPORT_DIR/uthmani.xml" ] && [ -r "$IMPORT_DIR/quran-data.xml" ] \
      || die "place uthmani.xml and quran-data.xml in $IMPORT_DIR first"
    release_compose "$(current_release_dir)" --profile ops run --rm --no-deps -T \
      -v "$IMPORT_DIR:$MOUNTED:ro" ops \
      packages/database/scripts/staging-quran-reference.ts "$@" \
      --text "$MOUNTED/uthmani.xml" --meta "$MOUNTED/quran-data.xml" \
      | tail -n 1 | jq -c . || die "staging-quran-reference did not end with a JSON summary"
    ;;
  translations)
    ops_json staging-quran-reference "$@"
    ;;
  names)
    case " $* " in
      *' --meta '*) die "the metadata is read from $IMPORT_DIR, not named on the command line" ;;
    esac
    [ -r "$IMPORT_DIR/quran-data.xml" ] || die "place quran-data.xml in $IMPORT_DIR first"
    release_compose "$(current_release_dir)" --profile ops run --rm --no-deps -T \
      -v "$IMPORT_DIR:$MOUNTED:ro" ops \
      packages/database/scripts/staging-quran-reference.ts "$@" \
      --meta "$MOUNTED/quran-data.xml" \
      | tail -n 1 | jq -c . || die "staging-quran-reference did not end with a JSON summary"
    ;;
  *) die "usage: quran-reference.sh import --sha256 <hex> --operator <accountId> [--session <sessionId>] | translations --operator <accountId> | names --sha256 <metadata hex> --operator <accountId>" ;;
esac
