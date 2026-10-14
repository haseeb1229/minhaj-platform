-- ===========================================================================
-- Phase 22 — Learning: courses & paths
-- ===========================================================================
--
-- THE LEARNING CONTEXT'S FIRST SLICE (DOMAIN_MODEL.md 13): a public catalogue of
-- Courses — their modules and lessons — and LearningPaths; a signed-in person's
-- own Enrolments and lesson Progress; and the REQUEST side of a trial class.
--
-- NOTHING THAT SCHEDULES. There is no ClassSession, Availability, Attendance or
-- Booking table and no column that could hold a meeting provider or address.
-- A TrialClassRequest records who asked about which live Course and when; it
-- reserves no teacher, names no time and books nothing. Confirmation is Phase
-- 23's, as its own aggregate.
--
-- NOTHING IS SEEDED. Not a Course, a path, an enrolment or a request. A database
-- migrated by this file holds no catalogue and nobody's learning.
--
-- TYPED REFERENCES, NEVER COPIES. A Course's topics are Taxonomy's Topic, its
-- content language Taxonomy's Language, its teachers People's Person — real
-- foreign keys, none of their words copied. Naming a teacher is public
-- attribution and grants nothing: teaching is Phase 23's teaching.perform,
-- which this file does not catalogue. No Video, Work, Asset or Centre relation
-- exists.
--
-- OWNERSHIP IS IN THE KEYS. A Lesson's key to its module carries the Course, so
-- a lesson can only sit in a module of its own Course; a LessonProgress row's
-- keys carry the Course to BOTH the Enrolment and the Lesson, so progress can
-- only name a lesson of the Course the person is enrolled on.
--
-- NOTHING CASCADES. Every foreign key is NO ACTION; the adapter removes a
-- parent's children explicitly. A Course is archived, never deleted, so the
-- Enrolments and Progress on it outlive its withdrawal.
--
-- THE DATABASE KEEPS THE PUBLIC CATALOGUE WHOLE (refusals 51270-51277, within the
-- 51270-51279 range reserved for this phase):
--
--   51270  a published Course with an incomplete syllabus
--   51271  a syllabus change while its Course is published (the outline is
--          frozen while public, so nobody ever reads a half-built one)
--   51272  a published path holding a Course that is not published
--   51273  a Course leaving publication while a published path holds it
--   51274  a published path with no Course
--   51275  an Enrolment on a Course that is not published
--   51276  a trial request on a Course that is not a published live Course
--   51277  Progress on a Course that is not published
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--
--   CATALOGUE  Course and LearningPath: SELECT, INSERT, UPDATE, never DELETE.
--              Their labels, topics and teachers: SELECT, INSERT, DELETE — a set
--              is replaced, never updated. Modules, lessons and path places:
--              SELECT, INSERT, DELETE, and UPDATE of their position alone.
--              Slug history: SELECT and INSERT, as every earlier slug history —
--              never UPDATE or DELETE, so a reserved slug is never freed.
--   LEARNER    Enrolment, LessonProgress, TrialClassRequest: SELECT, INSERT,
--              DELETE, never UPDATE. The person may leave, withdraw and close.
--
-- TWO ADMINISTRATIVE KEYS, learning.read and learning.administer, join the
-- protected Platform Administrator bundle by the convention every earlier phase
-- used. Neither is teaching authority and neither reaches a learner.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Course] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [level] NVARCHAR(16),
    [format] NVARCHAR(16) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [publishedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [Course_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Course_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Course_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Course_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[CourseLabel] (
    [courseId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    CONSTRAINT [CourseLabel_pkey] PRIMARY KEY CLUSTERED ([courseId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[CourseSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CourseSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[CourseTopic] (
    [courseId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CourseTopic_pkey] PRIMARY KEY CLUSTERED ([courseId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[CourseTeacher] (
    [courseId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [CourseTeacher_pkey] PRIMARY KEY CLUSTERED ([courseId],[personId]),
    CONSTRAINT [CourseTeacher_courseId_position_key] UNIQUE NONCLUSTERED ([courseId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[CourseModule] (
    [id] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [CourseModule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CourseModule_courseId_position_key] UNIQUE NONCLUSTERED ([courseId],[position]),
    CONSTRAINT [CourseModule_owner_key] UNIQUE NONCLUSTERED ([id],[courseId])
);

-- CreateTable
CREATE TABLE [dbo].[CourseModuleLabel] (
    [moduleId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [CourseModuleLabel_pkey] PRIMARY KEY CLUSTERED ([moduleId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[Lesson] (
    [id] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [moduleId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [Lesson_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Lesson_moduleId_position_key] UNIQUE NONCLUSTERED ([moduleId],[position]),
    CONSTRAINT [Lesson_owner_key] UNIQUE NONCLUSTERED ([id],[courseId])
);

-- CreateTable
CREATE TABLE [dbo].[LessonLabel] (
    [lessonId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    CONSTRAINT [LessonLabel_pkey] PRIMARY KEY CLUSTERED ([lessonId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[LearningPath] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [publishedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [LearningPath_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [LearningPath_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [LearningPath_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LearningPath_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[LearningPathLabel] (
    [pathId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max) NOT NULL,
    CONSTRAINT [LearningPathLabel_pkey] PRIMARY KEY CLUSTERED ([pathId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[LearningPathSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [pathId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [LearningPathSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[LearningPathCourse] (
    [pathId] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [LearningPathCourse_pkey] PRIMARY KEY CLUSTERED ([pathId],[courseId]),
    CONSTRAINT [LearningPathCourse_pathId_position_key] UNIQUE NONCLUSTERED ([pathId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[Enrolment] (
    [userId] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [enrolledAt] DATETIME2 NOT NULL,
    CONSTRAINT [Enrolment_pkey] PRIMARY KEY CLUSTERED ([userId],[courseId])
);

-- CreateTable
CREATE TABLE [dbo].[LessonProgress] (
    [userId] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [lessonId] NVARCHAR(36) NOT NULL,
    [completedAt] DATETIME2 NOT NULL,
    CONSTRAINT [LessonProgress_pkey] PRIMARY KEY CLUSTERED ([userId],[lessonId])
);

-- CreateTable
CREATE TABLE [dbo].[TrialClassRequest] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TrialClassRequest_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TrialClassRequest_userId_courseId_key] UNIQUE NONCLUSTERED ([userId],[courseId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Course_state_publishedAt_slug_idx] ON [dbo].[Course]([state], [publishedAt], [slug]);
CREATE NONCLUSTERED INDEX [Course_state_format_level_idx] ON [dbo].[Course]([state], [format], [level]);
CREATE NONCLUSTERED INDEX [Course_languageCode_state_idx] ON [dbo].[Course]([languageCode], [state]);
CREATE NONCLUSTERED INDEX [CourseSlugHistory_courseId_idx] ON [dbo].[CourseSlugHistory]([courseId]);
CREATE NONCLUSTERED INDEX [CourseTopic_topicId_courseId_idx] ON [dbo].[CourseTopic]([topicId], [courseId]);
CREATE NONCLUSTERED INDEX [CourseTeacher_personId_courseId_idx] ON [dbo].[CourseTeacher]([personId], [courseId]);
CREATE NONCLUSTERED INDEX [Lesson_courseId_idx] ON [dbo].[Lesson]([courseId]);
CREATE NONCLUSTERED INDEX [LearningPath_state_publishedAt_slug_idx] ON [dbo].[LearningPath]([state], [publishedAt], [slug]);
CREATE NONCLUSTERED INDEX [LearningPathSlugHistory_pathId_idx] ON [dbo].[LearningPathSlugHistory]([pathId]);
CREATE NONCLUSTERED INDEX [LearningPathCourse_courseId_pathId_idx] ON [dbo].[LearningPathCourse]([courseId], [pathId]);
CREATE NONCLUSTERED INDEX [Enrolment_courseId_userId_idx] ON [dbo].[Enrolment]([courseId], [userId]);
CREATE NONCLUSTERED INDEX [LessonProgress_userId_courseId_idx] ON [dbo].[LessonProgress]([userId], [courseId]);
CREATE NONCLUSTERED INDEX [LessonProgress_lessonId_courseId_idx] ON [dbo].[LessonProgress]([lessonId], [courseId]);
CREATE NONCLUSTERED INDEX [TrialClassRequest_courseId_requestedAt_idx] ON [dbo].[TrialClassRequest]([courseId], [requestedAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Course] ADD CONSTRAINT [Course_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseLabel] ADD CONSTRAINT [CourseLabel_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseSlugHistory] ADD CONSTRAINT [CourseSlugHistory_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseTopic] ADD CONSTRAINT [CourseTopic_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseTopic] ADD CONSTRAINT [CourseTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseTeacher] ADD CONSTRAINT [CourseTeacher_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseTeacher] ADD CONSTRAINT [CourseTeacher_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseModule] ADD CONSTRAINT [CourseModule_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseModuleLabel] ADD CONSTRAINT [CourseModuleLabel_moduleId_fkey] FOREIGN KEY ([moduleId]) REFERENCES [dbo].[CourseModule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Lesson] ADD CONSTRAINT [Lesson_module_fkey] FOREIGN KEY ([moduleId], [courseId]) REFERENCES [dbo].[CourseModule]([id],[courseId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LessonLabel] ADD CONSTRAINT [LessonLabel_lessonId_fkey] FOREIGN KEY ([lessonId]) REFERENCES [dbo].[Lesson]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LearningPathLabel] ADD CONSTRAINT [LearningPathLabel_pathId_fkey] FOREIGN KEY ([pathId]) REFERENCES [dbo].[LearningPath]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LearningPathSlugHistory] ADD CONSTRAINT [LearningPathSlugHistory_pathId_fkey] FOREIGN KEY ([pathId]) REFERENCES [dbo].[LearningPath]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LearningPathCourse] ADD CONSTRAINT [LearningPathCourse_pathId_fkey] FOREIGN KEY ([pathId]) REFERENCES [dbo].[LearningPath]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LearningPathCourse] ADD CONSTRAINT [LearningPathCourse_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Enrolment] ADD CONSTRAINT [Enrolment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Enrolment] ADD CONSTRAINT [Enrolment_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LessonProgress] ADD CONSTRAINT [LessonProgress_enrolment_fkey] FOREIGN KEY ([userId], [courseId]) REFERENCES [dbo].[Enrolment]([userId],[courseId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[LessonProgress] ADD CONSTRAINT [LessonProgress_lesson_fkey] FOREIGN KEY ([lessonId], [courseId]) REFERENCES [dbo].[Lesson]([id],[courseId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[TrialClassRequest] ADD CONSTRAINT [TrialClassRequest_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[TrialClassRequest] ADD CONSTRAINT [TrialClassRequest_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Value constraints
-- ===========================================================================

ALTER TABLE [dbo].[Course] ADD CONSTRAINT [Course_ck] CHECK (
    [state] IN (N'draft',N'published',N'archived')
    AND [primaryLocale] IN (N'en',N'ur',N'ar')
    AND ([level] IS NULL OR [level] IN (N'beginner',N'intermediate',N'advanced'))
    AND [format] IN (N'self-paced',N'live')
    AND [version] > 0
    AND ([state] <> N'published' OR [publishedAt] IS NOT NULL)
);
-- The words Learn's own routes use beside a slug can never be one.
ALTER TABLE [dbo].[Course] ADD CONSTRAINT [Course_slug_ck] CHECK (LEN([slug]) >= 2 AND [slug] NOT IN (N'courses',N'paths',N'live',N'trial',N'training',N'resources',N'teachers'));
ALTER TABLE [dbo].[CourseSlugHistory] ADD CONSTRAINT [CourseSlugHistory_slug_ck] CHECK ([slug] NOT IN (N'courses',N'paths',N'live',N'trial',N'training',N'resources',N'teachers'));
ALTER TABLE [dbo].[CourseLabel] ADD CONSTRAINT [CourseLabel_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([title]) > 0 AND LEN([description]) <= 8000);
ALTER TABLE [dbo].[CourseTeacher] ADD CONSTRAINT [CourseTeacher_ck] CHECK ([position] BETWEEN 0 AND 5);
ALTER TABLE [dbo].[CourseModule] ADD CONSTRAINT [CourseModule_ck] CHECK ([position] BETWEEN 0 AND 19);
ALTER TABLE [dbo].[CourseModuleLabel] ADD CONSTRAINT [CourseModuleLabel_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([title]) > 0);
ALTER TABLE [dbo].[Lesson] ADD CONSTRAINT [Lesson_ck] CHECK ([position] BETWEEN 0 AND 29);
ALTER TABLE [dbo].[LessonLabel] ADD CONSTRAINT [LessonLabel_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([title]) > 0 AND LEN([body]) <= 20000);
ALTER TABLE [dbo].[LearningPath] ADD CONSTRAINT [LearningPath_ck] CHECK (
    [state] IN (N'draft',N'published',N'archived')
    AND [primaryLocale] IN (N'en',N'ur',N'ar')
    AND [version] > 0
    AND ([state] <> N'published' OR [publishedAt] IS NOT NULL)
);
ALTER TABLE [dbo].[LearningPath] ADD CONSTRAINT [LearningPath_slug_ck] CHECK (LEN([slug]) >= 2 AND [slug] NOT IN (N'courses',N'paths',N'live',N'trial',N'training',N'resources',N'teachers'));
ALTER TABLE [dbo].[LearningPathSlugHistory] ADD CONSTRAINT [LearningPathSlugHistory_slug_ck] CHECK ([slug] NOT IN (N'courses',N'paths',N'live',N'trial',N'training',N'resources',N'teachers'));
ALTER TABLE [dbo].[LearningPathLabel] ADD CONSTRAINT [LearningPathLabel_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([title]) > 0 AND LEN([description]) <= 8000);
ALTER TABLE [dbo].[LearningPathCourse] ADD CONSTRAINT [LearningPathCourse_ck] CHECK ([position] BETWEEN 0 AND 29);

-- ===========================================================================
-- Permanent slug reservation (DOMAIN_MODEL.md 19.7), made by the DATABASE for
-- the reasons the Library and Media triggers give: no writer can skip it, and
-- the check and the write cannot race. A slug returning to the SAME record is
-- not reuse; the same spelling on ANOTHER record is refused by the key.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningReserveCourseSlug] ON [dbo].[Course] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[CourseSlugHistory] ([slug],[courseId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[CourseSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[courseId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningReservePathSlug] ON [dbo].[LearningPath] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[LearningPathSlugHistory] ([slug],[pathId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[LearningPathSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[pathId] = i.[id]
   );
END');

-- ===========================================================================
-- The public catalogue is whole — enforced where no writer can skip it. The
-- adapter checks each rule first, under the lock the rule needs, so an operator
-- is told what to do; these triggers are the floor beneath it.
-- ===========================================================================

-- A published Course has a complete syllabus in its primary locale (51270),
-- and leaves publication only once no published path holds it (51273).
EXEC(N'CREATE TRIGGER [dbo].[LearningCourseIntegrity] ON [dbo].[Course] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted c
   WHERE c.[state] = N''published''
     AND (
       NOT EXISTS (SELECT 1 FROM [dbo].[CourseLabel] l WHERE l.[courseId] = c.[id] AND l.[locale] = c.[primaryLocale])
       OR NOT EXISTS (SELECT 1 FROM [dbo].[CourseModule] m WHERE m.[courseId] = c.[id])
       OR EXISTS (
         SELECT 1 FROM [dbo].[CourseModule] m
         WHERE m.[courseId] = c.[id]
           AND (
             NOT EXISTS (SELECT 1 FROM [dbo].[Lesson] s WHERE s.[moduleId] = m.[id])
             OR NOT EXISTS (SELECT 1 FROM [dbo].[CourseModuleLabel] ml WHERE ml.[moduleId] = m.[id] AND ml.[locale] = c.[primaryLocale])
           )
       )
       OR EXISTS (
         SELECT 1 FROM [dbo].[Lesson] s
         WHERE s.[courseId] = c.[id]
           AND NOT EXISTS (SELECT 1 FROM [dbo].[LessonLabel] sl WHERE sl.[lessonId] = s.[id] AND sl.[locale] = c.[primaryLocale])
       )
     )
 )
   THROW 51270, ''A published Course needs a complete syllabus in its primary locale.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted c
   JOIN deleted d ON d.[id] = c.[id]
   WHERE d.[state] = N''published'' AND c.[state] <> N''published''
     AND EXISTS (
       SELECT 1 FROM [dbo].[LearningPathCourse] pc
       JOIN [dbo].[LearningPath] p ON p.[id] = pc.[pathId]
       WHERE pc.[courseId] = c.[id] AND p.[state] = N''published''
     )
 )
   THROW 51273, ''A Course in a published LearningPath cannot leave publication.'', 1;
END');

-- A published Course's syllabus is frozen (51271): modules, lessons and their
-- words change only while the Course is a draft or archived.
EXEC(N'CREATE TRIGGER [dbo].[LearningModuleFrozen] ON [dbo].[CourseModule] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM (SELECT [courseId] FROM inserted UNION SELECT [courseId] FROM deleted) x
   JOIN [dbo].[Course] c ON c.[id] = x.[courseId]
   WHERE c.[state] = N''published''
 )
   THROW 51271, ''A published Course''''s syllabus cannot change.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningModuleLabelFrozen] ON [dbo].[CourseModuleLabel] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM (SELECT [moduleId] FROM inserted UNION SELECT [moduleId] FROM deleted) x
   JOIN [dbo].[CourseModule] m ON m.[id] = x.[moduleId]
   JOIN [dbo].[Course] c ON c.[id] = m.[courseId]
   WHERE c.[state] = N''published''
 )
   THROW 51271, ''A published Course''''s syllabus cannot change.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningLessonFrozen] ON [dbo].[Lesson] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM (SELECT [courseId] FROM inserted UNION SELECT [courseId] FROM deleted) x
   JOIN [dbo].[Course] c ON c.[id] = x.[courseId]
   WHERE c.[state] = N''published''
 )
   THROW 51271, ''A published Course''''s syllabus cannot change.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningLessonLabelFrozen] ON [dbo].[LessonLabel] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM (SELECT [lessonId] FROM inserted UNION SELECT [lessonId] FROM deleted) x
   JOIN [dbo].[Lesson] s ON s.[id] = x.[lessonId]
   JOIN [dbo].[Course] c ON c.[id] = s.[courseId]
   WHERE c.[state] = N''published''
 )
   THROW 51271, ''A published Course''''s syllabus cannot change.'', 1;
END');

-- A published path holds at least one Course (51274), and only published
-- Courses (51272) — checked when the path changes and when its places do.
EXEC(N'CREATE TRIGGER [dbo].[LearningPathIntegrity] ON [dbo].[LearningPath] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted p
   WHERE p.[state] = N''published''
     AND NOT EXISTS (SELECT 1 FROM [dbo].[LearningPathCourse] pc WHERE pc.[pathId] = p.[id])
 )
   THROW 51274, ''A published LearningPath needs at least one Course.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted p
   JOIN [dbo].[LearningPathCourse] pc ON pc.[pathId] = p.[id]
   JOIN [dbo].[Course] c ON c.[id] = pc.[courseId]
   WHERE p.[state] = N''published'' AND c.[state] <> N''published''
 )
   THROW 51272, ''A published LearningPath holds only published Courses.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningPathPlaces] ON [dbo].[LearningPathCourse] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted pc
   JOIN [dbo].[LearningPath] p ON p.[id] = pc.[pathId]
   JOIN [dbo].[Course] c ON c.[id] = pc.[courseId]
   WHERE p.[state] = N''published'' AND c.[state] <> N''published''
 )
   THROW 51272, ''A published LearningPath holds only published Courses.'', 1;
 IF EXISTS (
   SELECT 1 FROM deleted d
   JOIN [dbo].[LearningPath] p ON p.[id] = d.[pathId]
   WHERE p.[state] = N''published''
     AND NOT EXISTS (SELECT 1 FROM [dbo].[LearningPathCourse] pc WHERE pc.[pathId] = p.[id])
 )
   THROW 51274, ''A published LearningPath needs at least one Course.'', 1;
END');

-- A person's study begins only on a published Course (51275, 51277), and a
-- trial request only on a published live one (51276). Leaving, withdrawing and
-- disposition — deletes — are never refused by a Course's state.
EXEC(N'CREATE TRIGGER [dbo].[LearningEnrolmentOpen] ON [dbo].[Enrolment] AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted e JOIN [dbo].[Course] c ON c.[id] = e.[courseId]
   WHERE c.[state] <> N''published''
 )
   THROW 51275, ''Only a published Course takes an enrolment.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningProgressOpen] ON [dbo].[LessonProgress] AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted p JOIN [dbo].[Course] c ON c.[id] = p.[courseId]
   WHERE c.[state] <> N''published''
 )
   THROW 51277, ''Progress is recorded only on a published Course.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[LearningTrialOpen] ON [dbo].[TrialClassRequest] AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted t JOIN [dbo].[Course] c ON c.[id] = t.[courseId]
   WHERE c.[state] <> N''published'' OR c.[format] <> N''live''
 )
   THROW 51276, ''Only a published live Course takes a trial-class request.'', 1;
END');

-- ===========================================================================
-- Search (Phase 17) — `course` and `learning-path`, each its own kind and its
-- own scope. A module and a lesson have no public address and are not kinds.
-- ===========================================================================
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa',N'course',N'learning-path'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa',N'course',N'learning-path'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa',N'course',N'learning-path'));

-- ===========================================================================
-- Permissions
-- ===========================================================================

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'learning.read', N'View Courses, their modules and lessons, and LearningPaths, including drafts, with counts of enrolments and trial-class requests. Never a learner, their progress or teaching authority.'),
    (N'learning.administer', N'Create, edit, publish and archive Courses, their modules and lessons, and LearningPaths, and order them. Never confirms a trial class, edits a learner progress or grants teaching authority.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the whole catalogue less the externally gated keys,
-- so appending permissions widens what a live administrator may do. The
-- holders' sessions and step-up grants are revoked in the SAME transaction
-- that changes the bundle (SECURITY_BASELINE.md 8.1), by the mechanism every
-- earlier phase used. On a fresh database every count below is zero and
-- nothing is revoked.

DECLARE @learningAdminRoleId NVARCHAR(36);
DECLARE @learningAddedKeys NVARCHAR(200);

SELECT @learningAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @learningAdminRoleId IS NOT NULL
BEGIN
    SELECT @learningAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'learning.read', N'learning.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @learningAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @learningAddedKeys IS NOT NULL AND LEN(@learningAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @learningAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'learning.read', N'learning.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @learningAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @learningAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @learningAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'learning.permissions.provisioned', N'role',
             @learningAdminRoleId,
             N'{"added":"' + @learningAddedKeys + N'"}',
             N'20261006000000_phase22_learning');
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
