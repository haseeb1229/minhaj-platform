-- SYNTHETIC EXECUTABLE LEGACY EXPORT (SQLite dialect) — engineering fixture only.
--
-- Stands in for the kind of `.sql` dump MIGRATION_STRATEGY.md §1.3 anticipates:
-- another engine, another schema, read as a migration SOURCE. It is executed
-- only into an in-memory node:sqlite database by export-source.ts; it is never
-- restored into SQL Server and its schema is deliberately not the target's.
-- Every row is synthetic and marked FIXTURE. No credential, account or
-- personal datum appears here.

CREATE TABLE legacy_video (
  id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_ur TEXT,
  provider TEXT,
  ref TEXT,
  cat_key TEXT,
  cat_label TEXT,
  body_html TEXT,
  published TEXT,
  duration_s INTEGER
);

INSERT INTO legacy_video VALUES (1, 'ur', 'FIXTURE Export lecture 1', 'FIXTURE برآمد خطاب ۱ (فکسچر)', 'youtube', 'FIXTUREe001', 'fixture-lectures', 'FIXTURE Lectures', '<p>FIXTURE export body 1 with <a href="/videos/v001.html">a legacy link</a>.</p>', '2012-01-05', 1200);
INSERT INTO legacy_video VALUES (2, 'en', 'FIXTURE Export lecture 2', 'FIXTURE برآمد خطاب ۲ (فکسچر)', 'youtube', 'FIXTUREe002', 'fixture-lectures', 'FIXTURE Lectures', '<p>FIXTURE export body 2.</p>', '2012-02-06', 1500);
INSERT INTO legacy_video VALUES (3, 'en', 'FIXTURE Export lecture 3', NULL, 'vimeo', '910000003', 'fixture-spirituality', 'FIXTURE Spirituality', '<p>FIXTURE export body 3 with <a href="https://external.example.invalid/e3">an external link</a>.</p>', '2012-03-07', 1800);
INSERT INTO legacy_video VALUES (4, 'ur', 'FIXTURE Export lecture 4', 'FIXTURE برآمد خطاب ۴ (فکسچر)', 'youtube', 'FIXTUREe004', NULL, NULL, '<p>FIXTURE export body 4.</p>', '2012-04-08', NULL);
INSERT INTO legacy_video VALUES (5, 'en', 'FIXTURE Export lecture 5', NULL, 'youtube', 'FIXTUREe005', 'fixture-youth', 'FIXTURE Youth', '<p>FIXTURE export body 5.</p><script>window.__fixtureHostile = 5;</script>', '2012-05-09', 2100);
INSERT INTO legacy_video VALUES (6, 'ur', 'FIXTURE Export lecture 6', 'FIXTURE برآمد خطاب ۶ (فکسچر)', 'vimeo', '910000006', 'fixture-lectures', 'FIXTURE Lectures', '<p>FIXTURE export body 6.</p>', NULL, 2400);
INSERT INTO legacy_video VALUES (7, 'en', 'FIXTURE Export lecture 7', NULL, 'youtube', 'FIXTUREe007', 'fixture-spirituality', 'FIXTURE Spirituality', '<p>FIXTURE export body 7.</p>', '2012-07-11', 2700);
INSERT INTO legacy_video VALUES (8, 'ur', 'FIXTURE Export lecture 8', 'FIXTURE برآمد خطاب ۸ (فکسچر)', 'youtube', 'FIXTUREe008', 'fixture-youth', 'FIXTURE Youth', '<p>FIXTURE export body 8.</p>', '2012-08-12', 3000);
INSERT INTO legacy_video VALUES (9, 'en', 'FIXTURE Export lecture 9', NULL, NULL, NULL, NULL, NULL, '<p>FIXTURE export body 9 without a provider.</p>', '2012-09-13', 3300);
INSERT INTO legacy_video VALUES (10, 'en', 'FIXTURE Export lecture 10', 'FIXTURE برآمد خطاب ۱۰ (فکسچر)', 'youtube', 'FIXTUREe010', 'fixture-lectures', 'FIXTURE Lectures', '<p>FIXTURE export body 10.</p>', '2012-10-14', 3600);
