#!/usr/bin/env bash
# =============================================================================
# restore-proof.sh [set-id|latest] — prove a backup set restores, in isolation
# =============================================================================
#
# "A backup that has never been restored is not a backup." This takes a set
# FROM BLOB (not from the local copy, so the off-host copy is what is proven):
#
#   1. downloads the manifest, the SQL backup and the Storage archive, checks
#      the manifest belongs to THIS environment and every SHA-256 matches;
#   2. extracts Storage into the ISOLATED restore root (/srv/minhaj/restore/
#      storage, mounted into ops as MINHAJ_RESTORE_STORAGE_ROOT) — never the
#      live root;
#   3. runs `staging-restore-proof`, which restores SQL into a NEW
#      `MinhajStagingRestore_<hex>` database (never over MinhajStaging) and
#      verifies migration history, schema, least privilege, the synthetic
#      fixture, and that every durable Asset row's bytes and checksum are in
#      the restored Storage root — the COMBINED recovery;
#   4. removes the restored database, the restored bytes and the downloaded
#      files, whatever the outcome.
#
# Nothing is replayed: the restored database is never connected to web,
# realtime, e-mail or a payment provider.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
requested="${1:-latest}"

if [ "$requested" = latest ]; then
  set_id="$(blob_list "$MINHAJ_STAGING_ENVIRONMENT_ID/" | grep '/manifest.json$' | sort | tail -n 1 | cut -d/ -f2)"
  [ -n "$set_id" ] || die "no backup set exists for this environment"
else
  [[ "$requested" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "not a backup set id"
  set_id="$requested"
fi

work="$MINHAJ_SRV/restore/sets/$set_id"
restore_root="$MINHAJ_SRV/restore/storage"
sql_dir="$MINHAJ_SRV/sqlserver/backup"

[ "$(readlink -f "$restore_root")" != "$(readlink -f "$MINHAJ_SRV/storage")" ] || die "the restore root is the live root"
[ -z "$(ls -A "$restore_root")" ] || die "the isolated restore root is not empty (a previous proof did not clean up)"

cleanup() {
  find "$restore_root" -mindepth 1 -delete 2> /dev/null || true
  # Remove the server-side copy only if this proof placed it there; the newest
  # backup.sh copy is reset's evidence and stays.
  [ "${placed_sql:-no}" = yes ] && rm -f -- "$sql_dir/$sql_file"
  rm -rf -- "$work"
}
trap cleanup EXIT

install -d -m 0700 "$work"
prefix="$MINHAJ_STAGING_ENVIRONMENT_ID/$set_id"

# --- 1. download and verify ------------------------------------------------------
blob_get "$prefix/manifest.json" "$work/manifest.json"
[ "$(jq -r '.kind' "$work/manifest.json")" = one-minhaj-staging-backup-set ] || die "not a staging backup manifest"
[ "$(jq -r '.environmentId' "$work/manifest.json")" = "$MINHAJ_STAGING_ENVIRONMENT_ID" ] \
  || die "the backup set belongs to a different environment"
sql_file="$(jq -r '.sql.file' "$work/manifest.json")"
[[ "$sql_file" =~ ^minhaj-staging-[0-9a-f]{32}\.bak$ ]] || die "the manifest names an unexpected SQL file"

blob_get "$prefix/$sql_file" "$work/$sql_file"
blob_get "$prefix/storage.tar.gz" "$work/storage.tar.gz"
[ "$(sha256sum "$work/$sql_file" | cut -d' ' -f1)" = "$(jq -r '.sql.sha256' "$work/manifest.json")" ] \
  || die "the SQL backup's checksum does not match its manifest"
[ "$(sha256sum "$work/storage.tar.gz" | cut -d' ' -f1)" = "$(jq -r '.storage.sha256' "$work/manifest.json")" ] \
  || die "the Storage archive's checksum does not match its manifest"
log "set $set_id downloaded from Blob and verified against its manifest"

# --- 2. isolated Storage restore -------------------------------------------------
tar --numeric-owner -C "$restore_root" -xzpf "$work/storage.tar.gz"
restored_files="$(find "$restore_root" -type f | wc -l)"
[ "$restored_files" = "$(jq -r '.storage.files' "$work/manifest.json")" ] \
  || die "restored $restored_files files; the manifest recorded $(jq -r '.storage.files' "$work/manifest.json")"

# --- 3. isolated SQL restore + combined verification -----------------------------
# Proven with the operations image of the release that TOOK the set, whose
# migrations are the ones the backed-up schema carries. A later release with
# newer migrations would report the older set as "pending" — true, and not a
# fault of the backup.
set_release="$(jq -r '.releaseSha' "$work/manifest.json")"
assert_sha "$set_release"
[ -f "$RELEASES_DIR/$set_release/release.env" ] \
  || die "release $set_release, which took this set, is no longer on the host; fetch it again or prove a newer set"
export MINHAJ_OPS_RELEASE="$set_release"

# A rebuilt host has no backup directory until SQL Server writes one.
install -d -o 10001 -g 0 -m 0770 "$sql_dir"
if [ ! -e "$sql_dir/$sql_file" ]; then
  install -o 10001 -g 0 -m 0640 "$work/$sql_file" "$sql_dir/$sql_file"
  placed_sql=yes
else
  # The newest set's server copy is kept as reset evidence. It may stand in for
  # the download only if it is byte-identical to what came back from Blob.
  [ "$(sha256sum "$sql_dir/$sql_file" | cut -d' ' -f1)" = "$(jq -r '.sql.sha256' "$work/manifest.json")" ] \
    || die "the server-side $sql_file differs from the Blob copy"
fi
result="$(ops_json staging-restore-proof --backup "$sql_file")"

log "RESTORE PROOF PASSED for set $set_id"
jq -c --arg setId "$set_id" --argjson storageFiles "$restored_files" \
  '. + {setId: $setId, restoredStorageFiles: $storageFiles}' <<< "$result"
