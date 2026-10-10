-- ===========================================================================
-- Phase 16 — Global Network: Country, Region, City, Centre, CentreContact,
-- the Centres a City is served by, and centre-scoped News
-- ===========================================================================
--
-- FLEXIBLE PARENTAGE (DOMAIN_MODEL.md 17.1). A Region belongs to a Country. A
-- City belongs to a Country and, only where one is meaningful, to a Region OF
-- THAT COUNTRY. A Centre belongs to a Country and, where it has one, to a
-- physical City — or, with no City, directly to a Region. A Country may have
-- no Region at all; a virtual Centre has no physical locality.
--
-- THE SAME-COUNTRY RULE IS RELATIONAL, NOT VALIDATED. Every parent reference
-- below Country is a COMPOSITE foreign key on (id, countryId) against a unique
-- key on the parent, so a City cannot name another Country's Region, a Centre
-- another Country's City, and a served City another Country than its Centre's
-- — whoever writes, and without a read-then-check race.
--
-- ONE LOCALITY FACT. A Centre with a City stores no Region of its own: the
-- Region is the City's. A Centre stores a Region only when it has no City. So
-- the two can never disagree, and moving a City between Regions of its Country
-- moves every Centre in it consistently.
--
-- A REGION OR CITY NEVER LEAVES ITS COUNTRY. Their slug reservations are keyed
-- by Country and reference (id, countryId), so the database refuses changing
-- the Country of any Region or City (each has at least its first slug). Nested
-- canonical addresses therefore never move between Countries; an operator who
-- recorded the wrong Country archives the record and creates the right one.
--
-- VIRTUAL IS AN EXPLICIT FACT, never inferred from missing data, and a virtual
-- Centre has no physical City, Region or coordinates.
--
-- COORDINATES are exact decimals, both or neither, inside the valid ranges.
--
-- CENTRE-SCOPED NEWS IS THE EXISTING EDITORIAL NEWS MODEL. A NewsArticle
-- REVISION may name one Centre; every existing revision names none. Being on
-- the immutable revision, a Centre assignment goes through the ordinary review
-- workflow, and nothing about a Centre's lifecycle cascades into News. No other
-- News family gains a Centre, and no per-centre content table exists.
--
-- NOTHING ELSE. No Event, schedule, map, geocoder, import, search kind or
-- real directory record. OPEN_DECISIONS.md 6.2 keeps the authoritative data
-- with the organisation.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Country] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(2) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Country_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Country_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Country_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Country_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Country_code_key] UNIQUE NONCLUSTERED ([code]),
    CONSTRAINT [Country_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[CountryLabel] (
    [countryId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    CONSTRAINT [CountryLabel_pkey] PRIMARY KEY CLUSTERED ([countryId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[CountrySlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [countryId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CountrySlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[Region] (
    [id] NVARCHAR(36) NOT NULL,
    [countryId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Region_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Region_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Region_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Region_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Region_countryId_slug_key] UNIQUE NONCLUSTERED ([countryId],[slug]),
    CONSTRAINT [Region_id_countryId_key] UNIQUE NONCLUSTERED ([id],[countryId])
);

-- CreateTable
CREATE TABLE [dbo].[RegionLabel] (
    [regionId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    CONSTRAINT [RegionLabel_pkey] PRIMARY KEY CLUSTERED ([regionId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[RegionSlugHistory] (
    [countryId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [regionId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [RegionSlugHistory_pkey] PRIMARY KEY CLUSTERED ([countryId],[slug])
);

-- CreateTable
CREATE TABLE [dbo].[City] (
    [id] NVARCHAR(36) NOT NULL,
    [countryId] NVARCHAR(36) NOT NULL,
    [regionId] NVARCHAR(36),
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [City_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [City_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [City_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [City_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [City_countryId_slug_key] UNIQUE NONCLUSTERED ([countryId],[slug]),
    CONSTRAINT [City_id_countryId_key] UNIQUE NONCLUSTERED ([id],[countryId])
);

-- CreateTable
CREATE TABLE [dbo].[CityLabel] (
    [cityId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(160) NOT NULL,
    CONSTRAINT [CityLabel_pkey] PRIMARY KEY CLUSTERED ([cityId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[CitySlugHistory] (
    [countryId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [cityId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CitySlugHistory_pkey] PRIMARY KEY CLUSTERED ([countryId],[slug])
);

-- CreateTable
CREATE TABLE [dbo].[Centre] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [countryId] NVARCHAR(36) NOT NULL,
    [regionId] NVARCHAR(36),
    [cityId] NVARCHAR(36),
    [isVirtual] BIT NOT NULL CONSTRAINT [Centre_isVirtual_df] DEFAULT 0,
    [latitude] DECIMAL(9,6),
    [longitude] DECIMAL(9,6),
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Centre_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Centre_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Centre_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Centre_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Centre_slug_key] UNIQUE NONCLUSTERED ([slug]),
    CONSTRAINT [Centre_id_countryId_key] UNIQUE NONCLUSTERED ([id],[countryId])
);

-- CreateTable
CREATE TABLE [dbo].[CentreLabel] (
    [centreId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [address] NVARCHAR(500),
    CONSTRAINT [CentreLabel_pkey] PRIMARY KEY CLUSTERED ([centreId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[CentreSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [centreId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CentreSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[CentreServiceCity] (
    [centreId] NVARCHAR(36) NOT NULL,
    [cityId] NVARCHAR(36) NOT NULL,
    [countryId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CentreServiceCity_pkey] PRIMARY KEY CLUSTERED ([centreId],[cityId])
);

-- CreateTable
CREATE TABLE [dbo].[CentreContact] (
    [centreId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [channel] NVARCHAR(16) NOT NULL,
    [value] NVARCHAR(320) NOT NULL,
    CONSTRAINT [CentreContact_pkey] PRIMARY KEY CLUSTERED ([centreId],[position]),
    CONSTRAINT [CentreContact_centreId_channel_value_key] UNIQUE NONCLUSTERED ([centreId],[channel],[value])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Country_state_slug_id_idx] ON [dbo].[Country]([state], [slug], [id]);
CREATE NONCLUSTERED INDEX [CountrySlugHistory_countryId_idx] ON [dbo].[CountrySlugHistory]([countryId]);
CREATE NONCLUSTERED INDEX [Region_countryId_state_slug_id_idx] ON [dbo].[Region]([countryId], [state], [slug], [id]);
CREATE NONCLUSTERED INDEX [RegionSlugHistory_regionId_idx] ON [dbo].[RegionSlugHistory]([regionId]);
CREATE NONCLUSTERED INDEX [City_countryId_state_slug_id_idx] ON [dbo].[City]([countryId], [state], [slug], [id]);
CREATE NONCLUSTERED INDEX [City_regionId_state_slug_id_idx] ON [dbo].[City]([regionId], [state], [slug], [id]);
CREATE NONCLUSTERED INDEX [CitySlugHistory_cityId_idx] ON [dbo].[CitySlugHistory]([cityId]);
CREATE NONCLUSTERED INDEX [Centre_countryId_state_slug_id_idx] ON [dbo].[Centre]([countryId], [state], [slug], [id]);
CREATE NONCLUSTERED INDEX [Centre_cityId_state_idx] ON [dbo].[Centre]([cityId], [state]);
CREATE NONCLUSTERED INDEX [Centre_regionId_state_idx] ON [dbo].[Centre]([regionId], [state]);
CREATE NONCLUSTERED INDEX [Centre_state_slug_id_idx] ON [dbo].[Centre]([state], [slug], [id]);
CREATE NONCLUSTERED INDEX [CentreSlugHistory_centreId_idx] ON [dbo].[CentreSlugHistory]([centreId]);
CREATE NONCLUSTERED INDEX [CentreServiceCity_cityId_centreId_idx] ON [dbo].[CentreServiceCity]([cityId], [centreId]);

-- AddForeignKey — every one NO ACTION: nothing in Global cascades, and no
-- removal of a parent can take a child, a slug, a contact or News with it.
ALTER TABLE [dbo].[CountryLabel] ADD CONSTRAINT [CountryLabel_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CountrySlugHistory] ADD CONSTRAINT [CountrySlugHistory_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Region] ADD CONSTRAINT [Region_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RegionLabel] ADD CONSTRAINT [RegionLabel_regionId_fkey] FOREIGN KEY ([regionId]) REFERENCES [dbo].[Region]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RegionSlugHistory] ADD CONSTRAINT [RegionSlugHistory_regionId_countryId_fkey] FOREIGN KEY ([regionId], [countryId]) REFERENCES [dbo].[Region]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[City] ADD CONSTRAINT [City_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[City] ADD CONSTRAINT [City_regionId_countryId_fkey] FOREIGN KEY ([regionId], [countryId]) REFERENCES [dbo].[Region]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CityLabel] ADD CONSTRAINT [CityLabel_cityId_fkey] FOREIGN KEY ([cityId]) REFERENCES [dbo].[City]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CitySlugHistory] ADD CONSTRAINT [CitySlugHistory_cityId_countryId_fkey] FOREIGN KEY ([cityId], [countryId]) REFERENCES [dbo].[City]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_regionId_countryId_fkey] FOREIGN KEY ([regionId], [countryId]) REFERENCES [dbo].[Region]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_cityId_countryId_fkey] FOREIGN KEY ([cityId], [countryId]) REFERENCES [dbo].[City]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CentreLabel] ADD CONSTRAINT [CentreLabel_centreId_fkey] FOREIGN KEY ([centreId]) REFERENCES [dbo].[Centre]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CentreSlugHistory] ADD CONSTRAINT [CentreSlugHistory_centreId_fkey] FOREIGN KEY ([centreId]) REFERENCES [dbo].[Centre]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CentreServiceCity] ADD CONSTRAINT [CentreServiceCity_centreId_countryId_fkey] FOREIGN KEY ([centreId], [countryId]) REFERENCES [dbo].[Centre]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CentreServiceCity] ADD CONSTRAINT [CentreServiceCity_cityId_countryId_fkey] FOREIGN KEY ([cityId], [countryId]) REFERENCES [dbo].[City]([id], [countryId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CentreContact] ADD CONSTRAINT [CentreContact_centreId_fkey] FOREIGN KEY ([centreId]) REFERENCES [dbo].[Centre]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Integrity refused by the database, whoever writes:
--
--   * lifecycle, locale, version and slug grammar for all four aggregates;
--   * a Country's code is two upper-case Latin letters (ISO 3166-1 alpha-2);
--   * a Centre holds at most ONE locality fact — a City, or with no City a
--     Region — and a virtual Centre holds none, and no coordinates;
--   * coordinates are both present or both absent, inside -90..90 and
--     -180..180;
--   * a label says something; a Centre's optional words are absent or real;
--   * a contact is a phone, an email or an HTTPS website, in one of twelve
--     ordered places.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Country] ADD CONSTRAINT [Country_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Country] ADD CONSTRAINT [Country_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Country] ADD CONSTRAINT [Country_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Country] ADD CONSTRAINT [Country_code_ck] CHECK ([code] COLLATE Latin1_General_BIN2 LIKE N'[A-Z][A-Z]');
ALTER TABLE [dbo].[Country] ADD CONSTRAINT [Country_slug_ck] CHECK (LEN([slug]) >= 2 AND [slug] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^a-z0-9-]%');
ALTER TABLE [dbo].[CountryLabel] ADD CONSTRAINT [CountryLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[CountryLabel] ADD CONSTRAINT [CountryLabel_name_ck] CHECK (LEN([name]) > 0);
ALTER TABLE [dbo].[Region] ADD CONSTRAINT [Region_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Region] ADD CONSTRAINT [Region_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Region] ADD CONSTRAINT [Region_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Region] ADD CONSTRAINT [Region_slug_ck] CHECK (LEN([slug]) >= 2 AND [slug] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^a-z0-9-]%');
ALTER TABLE [dbo].[RegionLabel] ADD CONSTRAINT [RegionLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[RegionLabel] ADD CONSTRAINT [RegionLabel_name_ck] CHECK (LEN([name]) > 0);
ALTER TABLE [dbo].[City] ADD CONSTRAINT [City_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[City] ADD CONSTRAINT [City_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[City] ADD CONSTRAINT [City_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[City] ADD CONSTRAINT [City_slug_ck] CHECK (LEN([slug]) >= 2 AND [slug] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^a-z0-9-]%');
ALTER TABLE [dbo].[CityLabel] ADD CONSTRAINT [CityLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[CityLabel] ADD CONSTRAINT [CityLabel_name_ck] CHECK (LEN([name]) > 0);
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_slug_ck] CHECK (LEN([slug]) >= 2 AND [slug] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^a-z0-9-]%');
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_locality_ck] CHECK ([cityId] IS NULL OR [regionId] IS NULL);
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_virtual_ck] CHECK ([isVirtual] = 0 OR ([cityId] IS NULL AND [regionId] IS NULL AND [latitude] IS NULL AND [longitude] IS NULL));
-- Both-or-neither is stated with explicit IS NOT NULL tests: a CHECK passes on
-- UNKNOWN, and `NULL BETWEEN …` is UNKNOWN, so a range test alone would let
-- half a coordinate pair through.
ALTER TABLE [dbo].[Centre] ADD CONSTRAINT [Centre_coordinates_ck] CHECK (
    ([latitude] IS NULL AND [longitude] IS NULL)
    OR ([latitude] IS NOT NULL AND [longitude] IS NOT NULL
        AND [latitude] BETWEEN -90 AND 90 AND [longitude] BETWEEN -180 AND 180));
ALTER TABLE [dbo].[CentreLabel] ADD CONSTRAINT [CentreLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[CentreLabel] ADD CONSTRAINT [CentreLabel_text_ck] CHECK (
    LEN([name]) > 0
    AND ([description] IS NULL OR LEN([description]) > 0)
    AND ([address] IS NULL OR LEN([address]) > 0));
ALTER TABLE [dbo].[CentreContact] ADD CONSTRAINT [CentreContact_position_ck] CHECK ([position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[CentreContact] ADD CONSTRAINT [CentreContact_value_ck] CHECK (
    LEN([value]) > 0 AND ([channel] = N'phone' OR [value] NOT LIKE N'% %'));
ALTER TABLE [dbo].[CentreContact] ADD CONSTRAINT [CentreContact_channel_ck] CHECK (
    ([channel] = N'phone' AND LEN([value]) > 0 AND [value] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9 +().-]%')
    OR ([channel] = N'email' AND [value] LIKE N'_%@_%._%')
    OR ([channel] = N'website' AND [value] COLLATE Latin1_General_BIN2 LIKE N'https://_%'));

-- ---------------------------------------------------------------------------
-- Permanent slug reservation (DOMAIN_MODEL.md 19.7), made by the DATABASE for
-- the reasons the Library, Media and Editorial triggers give: no writer can
-- skip it, and the check and the write cannot race. A slug returning to the
-- SAME record is not reuse; the same spelling on ANOTHER record of the same
-- scope is refused by the history's primary key. Region and City slugs are
-- scoped by their Country, exactly as their canonical addresses are.
-- ---------------------------------------------------------------------------
EXEC(N'CREATE TRIGGER [dbo].[GlobalReserveCountrySlug] ON [dbo].[Country] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[CountrySlugHistory] ([slug],[countryId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[CountrySlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[countryId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[GlobalReserveRegionSlug] ON [dbo].[Region] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[RegionSlugHistory] ([countryId],[slug],[regionId])
 SELECT i.[countryId],i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[RegionSlugHistory] h
     WHERE h.[countryId] = i.[countryId] AND h.[slug] = i.[slug] AND h.[regionId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[GlobalReserveCitySlug] ON [dbo].[City] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[CitySlugHistory] ([countryId],[slug],[cityId])
 SELECT i.[countryId],i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[CitySlugHistory] h
     WHERE h.[countryId] = i.[countryId] AND h.[slug] = i.[slug] AND h.[cityId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[GlobalReserveCentreSlug] ON [dbo].[Centre] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[CentreSlugHistory] ([slug],[centreId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[CentreSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[centreId] = i.[id]
   );
END');

-- ---------------------------------------------------------------------------
-- CENTRE-SCOPED NEWS (DOMAIN_MODEL.md 17.1, 18). One nullable, non-cascading
-- Centre reference on the NewsArticle REVISION — the record the Phase-13
-- immutability, append and sequence triggers already govern, so a Centre is
-- assigned only by saving a new revision, which clears approval and schedule.
-- Adding a NULL column rewrites no history row: every existing revision is
-- general News, and no default Centre is invented.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[NewsArticleRevision] ADD [centreId] NVARCHAR(36) NULL;
ALTER TABLE [dbo].[NewsArticleRevision] ADD CONSTRAINT [NewsArticleRevision_centreId_fkey] FOREIGN KEY ([centreId]) REFERENCES [dbo].[Centre]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE NONCLUSTERED INDEX [NewsArticleRevision_centreId_ownerId_number_idx] ON [dbo].[NewsArticleRevision]([centreId], [ownerId], [number]);

-- ---------------------------------------------------------------------------
-- The Global vocabulary: two keys, read and administer (DELIVERY_PLAN.md
-- Phase 16). No key per level, no `global.publish` — Global has no review step
-- — and no contact or import key.
-- ---------------------------------------------------------------------------
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'global.read', N'View Global Network countries, regions, cities and centres, including drafts and archived records.'),
    (N'global.administer', N'Create, edit, localise, publish and archive Global Network countries, regions, cities and centres, and manage centre contacts and the cities a centre serves.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending permissions widens
-- what a live administrator may do. The holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1), by the mechanism every earlier phase used. On a
-- fresh database every count below is zero and nothing is revoked.

DECLARE @globalAdminRoleId NVARCHAR(36);
DECLARE @globalAddedKeys NVARCHAR(200);

SELECT @globalAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @globalAdminRoleId IS NOT NULL
BEGIN
    SELECT @globalAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'global.read', N'global.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @globalAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @globalAddedKeys IS NOT NULL AND LEN(@globalAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @globalAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'global.read', N'global.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @globalAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @globalAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @globalAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'global.permissions.provisioned', N'role',
             @globalAdminRoleId,
             N'{"added":"' + @globalAddedKeys + N'"}',
             N'20260929000000_phase16_global_network');
    END;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
