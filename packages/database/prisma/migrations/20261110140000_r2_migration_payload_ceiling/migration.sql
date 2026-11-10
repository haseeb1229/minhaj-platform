BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Migration & Provenance: the staged-payload ceiling
-- ===========================================================================
--
-- A STAGED REVISION'S PAYLOAD MAY HOLD 400,000 CHARACTERS (was 200,000;
-- `MIGRATION_LIMITS.payload`, `@minhaj/contracts/migration`). A Quran
-- translation's surah is ONE indivisible source item, and QuranEnc's Urdu
-- Al-Baqarah with its translator's footnotes stages about 265,200 characters
-- (OWNER-DECISION-2026-11-10-EXTERNAL-REFERENCE-TRANSLATIONS,
-- OPEN_DECISIONS.md 1.2 item 5; MIGRATION_STRATEGY.md 19). Splitting a surah
-- into partial records would complicate every import, so the ceiling is
-- raised once, with about half again as much room left above the longest
-- surah known.
--
-- ONE CHECK RESTATED, NOTHING ELSE. `MigrationStagedRecord_ck` is exactly
-- Phase 30-RD's statement with its payload bound raised; no table, column,
-- key, trigger, grant or row changes. A payload over the ceiling is still
-- staged as a stub naming its kind (`body-too-long`), the evidence kept.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];

EXEC(N'ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_ck] CHECK (
    [revision] >= 1
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''editorial.collection'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
    AND LEN([title]) BETWEEN 1 AND 240
    AND ISJSON([payload]) = 1
    AND LEN([payload]) <= 400000
    AND [payloadChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [validation] IN (N''valid'', N''invalid'')
    AND ([issues] IS NULL OR ISJSON([issues]) = 1)
    AND [personalData] IN (N''none'', N''flagged'', N''cleared'')
    AND (CASE WHEN [personalData] = N''cleared'' THEN 1 ELSE 0 END) = (CASE WHEN [clearanceOfStagedRecordId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([clearanceOfStagedRecordId] IS NULL OR [clearanceOfStagedRecordId] <> [id])
    AND [review] IN (N''pending'', N''approved'', N''rejected'', N''superseded'')
    AND ([review] <> N''approved'' OR ([validation] = N''valid'' AND [personalData] IN (N''none'', N''cleared'')))
    AND ([review] NOT IN (N''approved'', N''rejected'') OR ([reviewedByUserId] IS NOT NULL AND [reviewedAt] IS NOT NULL))
    AND [version] >= 1
);');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
