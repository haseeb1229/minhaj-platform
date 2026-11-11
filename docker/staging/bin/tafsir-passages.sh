#!/usr/bin/env bash
# =============================================================================
# tafsir-passages.sh — Quran passages proposed from titles on staging (Quran Part 8)
# =============================================================================
#
#   tafsir-passages.sh propose --operator <accountId>
#   tafsir-passages.sh apply   --operator <accountId>
#                              --confirm-count <n> --confirm-fingerprint <hex>
#
# Owner decision (OPEN_DECISIONS.md §1.2 item 2): the Tafsir hub links
# Shaykh-ul-Islam's tafsir books and Minhaj TV lectures to the ayat they
# explain. A book (Library Work) or a lecture (Media Video) carries its OWN
# Quran passages; this command PROPOSES them for the published records whose
# TITLE names a Surah — and, where the title states one, an ayah range — by the
# strict, conservative rule in scripts/quran/title-passages.ts: a Surah only
# after "Surah/Sura/Surat/Soorah", one of the Quran reader's canonical names
# (folded) or a documented spelling, ayat only after "verse(s)/ayat/ayah" with
# exactly one Surah named, "Ayat al-Kursi" as 2:255, and nothing at all for an
# ambiguous title. A record that already carries a passage is never touched.
#
# Two steps, like migration-review.sh: `propose` prints the plan's counts, its
# size and fingerprint and changes nothing; `apply` rebuilds the plan, refuses
# unless it is EXACTLY the confirmed one, and sets each record's passages
# through its owner's service (library.administer / media.administer, re-read
# live) under the version it read — each audited with this command as the
# origin. An editor corrects any passage afterwards in /admin/library/works/<id>
# or /admin/media/videos/<id>. Production never runs this.
#
# BEFORE ANYTHING: root and the staging host proof (lib.sh); the host lock, so
# it never runs beside an ingest, a backup or a deploy; the exact-SHA
# operations image of the deployed release (the release must carry the
# 20261110150000_r2_quran_passages migration — deploy first).
#
# The last output line is the command's JSON summary: counts, the plan's size
# and fingerprint. Never a title, a payload, a token or a password.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
case "${1:-}" in
  propose | apply) ;;
  *) die "usage: tafsir-passages.sh propose|apply --operator <accountId> [--confirm-count <n> --confirm-fingerprint <hex>]" ;;
esac
host_lock
ops_json staging-tafsir-passages "$@"
