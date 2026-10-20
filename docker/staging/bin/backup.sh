#!/usr/bin/env bash
# =============================================================================
# backup.sh — one complete staging backup set: SQL + authoritative Storage
# =============================================================================
#
# ARCHITECTURE.md §10.4: a SQL backup without the stored bytes is not a
# product backup, so every set carries BOTH, taken in one run:
#
#   1. SQL — `staging-backup` (in the exact-SHA ops image) takes a verified
#      `BACKUP DATABASE ... WITH CHECKSUM` of MinhajStaging;
#   2. Storage — a tar of the authoritative storage root;
#   3. a manifest binding both to this environment, the schema they were taken
#      from, and SHA-256 for each file;
#   4. all three uploaded to the private Blob container, OFF the VM's disks,
#      under `<environment-id>/<set-id>/`, and their stored sizes re-read.
#
# The newest `.bak` is also LEFT on the SQL Server's own backup path: it is
# the evidence `staging-reset` requires (a recent, checksummed full backup of
# the current database whose file still exists). Older server-side copies are
# removed; the Blob copy is the backup.
#
# Interim staging policy (OPEN_DECISIONS.md §4.4): daily (systemd timer),
# RPO 24 h, RTO 4 h, 14-day retention (the storage account's lifecycle rule
# deletes older blobs; this host keeps only its three newest local sets).
#
# Storage objects are written once and never modified in place (`wx`), so a
# tar taken while web runs captures complete objects; an upload still in
# flight belongs to an `uploading` row that reconciliation discards. The file
# count is read from the archive itself, so it always describes what was
# actually captured.
#
# A backup is accepted only once restored: see restore-proof.sh.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

staging_preflight
host_lock
dir="$(current_release_dir)"
load_release_env "$dir"

set_id="$(date -u +%Y%m%dT%H%M%SZ)"
work="$MINHAJ_SRV/backups/$set_id"
sql_dir="$MINHAJ_SRV/sqlserver/backup"
install -d -m 0700 "$work"

# The schema this set captures — recorded so a restore proof uses the release
# whose migrations match it, not whatever is deployed later.
schema="$(ops_json staging-inspect)"
[ "$(jq -r '.databaseExists' <<< "$schema")" = true ] || die "MinhajStaging does not exist; there is nothing to back up"

# --- 1. SQL ----------------------------------------------------------------------
summary="$(ops_json staging-backup)"
sql_file="$(jq -r '.fileName' <<< "$summary")"
[[ "$sql_file" =~ ^minhaj-staging-[0-9a-f]{32}\.bak$ ]] || die "staging-backup returned an unexpected file name"
cp --preserve=mode,ownership "$sql_dir/$sql_file" "$work/$sql_file"
find "$sql_dir" -maxdepth 1 -type f -name 'minhaj-staging-*.bak' ! -name "$sql_file" -delete

# --- 2. Storage ------------------------------------------------------------------
tar_status=0
tar --numeric-owner -C "$MINHAJ_SRV/storage" -czpf "$work/storage.tar.gz" . || tar_status=$?
# GNU tar exits 1 only for "file changed as we read it" — an object written
# during the archive. The archive is still valid; anything worse is fatal.
[ "$tar_status" -le 1 ] || die "archiving the storage root failed (tar exit $tar_status)"
[ "$tar_status" -eq 0 ] || log "note: an object changed while archiving; it is captured as read"
storage_files="$(tar -tzf "$work/storage.tar.gz" | grep -vc '/$' || true)"

# --- 3. manifest ---------------------------------------------------------------
sql_sha="$(sha256sum "$work/$sql_file" | cut -d' ' -f1)"
storage_sha="$(sha256sum "$work/storage.tar.gz" | cut -d' ' -f1)"
jq -n \
  --arg setId "$set_id" \
  --arg environmentId "$MINHAJ_STAGING_ENVIRONMENT_ID" \
  --arg releaseSha "$MINHAJ_RELEASE_SHA" \
  --argjson schema "$(jq -c '.migrations' <<< "$schema")" \
  --arg sqlFile "$sql_file" --arg sqlSha "$sql_sha" --argjson sqlBytes "$(stat -c %s "$work/$sql_file")" \
  --arg storageSha "$storage_sha" --argjson storageBytes "$(stat -c %s "$work/storage.tar.gz")" \
  --argjson storageFiles "$storage_files" \
  --argjson sqlBackup "$summary" \
  '{
     kind: "one-minhaj-staging-backup-set", setId: $setId, environmentId: $environmentId,
     releaseSha: $releaseSha, schema: $schema,
     sql: { file: $sqlFile, sha256: $sqlSha, bytes: $sqlBytes, backup: $sqlBackup },
     storage: { file: "storage.tar.gz", sha256: $storageSha, bytes: $storageBytes, files: $storageFiles }
   }' > "$work/manifest.json"

# --- 4. off-host copy ------------------------------------------------------------
prefix="$MINHAJ_STAGING_ENVIRONMENT_ID/$set_id"
for file in "$sql_file" storage.tar.gz manifest.json; do
  blob_put "$work/$file" "$prefix/$file"
  [ "$(blob_size "$prefix/$file")" = "$(stat -c %s "$work/$file")" ] \
    || die "the uploaded $file does not match its local size"
done

# Local copies are a convenience; the Blob copy is the backup.
find "$MINHAJ_SRV/backups" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -rn | cut -d' ' -f2 \
  | grep -E '^[0-9]{8}T[0-9]{6}Z$' | tail -n +4 | while read -r old; do
  rm -rf -- "${MINHAJ_SRV:?}/backups/$old"
done

log "BACKUP SET $set_id uploaded: sql $sql_file ($sql_sha), storage $storage_files files ($storage_sha)"
jq -c '{setId, environmentId, releaseSha, schema, sql: {file: .sql.file, sha256: .sql.sha256, bytes: .sql.bytes}, storage: {sha256: .storage.sha256, bytes: .storage.bytes, files: .storage.files}}' "$work/manifest.json"
