import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-14 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That an Event
 * came back with its WORKFLOW, its HISTORY, its TIME and its two typed
 * references into other owners:
 *
 *   - one published Event, renamed once, so two immutable revisions and two
 *     permanent slug reservations must return, with the approval of the exact
 *     current revision by someone other than its author;
 *   - English and Urdu translations, a typed Topic and a typed Person on the
 *     current revision;
 *   - occurrences stored as BOTH the intended local wall-clock time in the
 *     revision's IANA zone and the UTC instant derived from it, in a zone with
 *     daylight saving: a summer evening whose end crosses UTC midnight, and an
 *     occurrence in the REPEATED fall-back hour whose LATER instant was chosen
 *     — the one value a restore that re-derived instants, or lost the zone,
 *     would silently change;
 *   - the current revision held at a Global Network Centre and associated with
 *     a Media Gallery, by real non-cascading foreign keys;
 *   - the audit trail of its workflow.
 *
 * The Centre and the Gallery are NOT this fixture's: they are the synthetic
 * records the Phase-16 and Phase-12 fixtures (or a permission proof) already
 * wrote, passed in as references — exactly as an Event names another owner's
 * row rather than creating it.
 *
 * EVERYTHING IS SYNTHETIC: no real organisation, event, place or person is
 * named, and nothing here is a real date of anything.
 */

export interface Phase14Fixture {
  readonly runId: string;
  readonly eventId: string;
  readonly originalSlug: string;
  readonly currentSlug: string;
  readonly auditIds: readonly string[];
}

export interface Phase14References {
  readonly authorId: string;
  readonly reviewerId: string;
  readonly personId: string;
  readonly topicId: string;
  /** A synthetic Global Network Centre the current revision is held at. */
  readonly centreId: string;
  /** A synthetic Media Gallery the current revision is associated with. */
  readonly galleryId: string;
}

/** The zone every revision of the fixture Event is scheduled in. */
export const PHASE14_TIMEZONE = 'America/New_York';

interface Occurrence {
  readonly position: number;
  readonly startsLocal: string;
  readonly startsAt: string;
  readonly endsLocal: string | null;
  readonly endsAt: string | null;
}

/** The first revision's one occurrence: a start with no end. */
const FIRST_OCCURRENCES: readonly Occurrence[] = [
  {
    position: 0,
    startsLocal: '2033-07-03T18:00:00',
    startsAt: '2033-07-03T22:00:00',
    endsLocal: null,
    endsAt: null,
  },
];

/**
 * The current revision's two occurrences.
 *
 * 0 — 18:00 to 20:00 EDT (UTC-4): its end, 00:00 UTC, falls on the NEXT UTC day.
 * 1 — 01:30 to 02:15 on the 2033 fall-back night. 01:30 happens twice in New
 *     York that night, at 05:30Z (EDT) and 06:30Z (EST); the LATER instant was
 *     chosen. `assertZoneFacts` proves both readings against the runtime's own
 *     IANA data before anything is written.
 */
export const PHASE14_OCCURRENCES: readonly Occurrence[] = [
  {
    position: 0,
    startsLocal: '2033-07-10T18:00:00',
    startsAt: '2033-07-10T22:00:00',
    endsLocal: '2033-07-10T20:00:00',
    endsAt: '2033-07-11T00:00:00',
  },
  {
    position: 1,
    startsLocal: '2033-11-06T01:30:00',
    startsAt: '2033-11-06T06:30:00',
    endsLocal: '2033-11-06T02:15:00',
    endsAt: '2033-11-06T07:15:00',
  },
];

const TEXT = {
  titleEn: 'Synthetic recovery event',
  titleUr: 'بحالی کے ثبوت کی آزمائشی تقریب',
  firstTitle: 'Synthetic recovery event, first draft',
} as const;

const AUDIT_ACTIONS = [
  ['created', 'content.author'],
  ['revised', 'content.author'],
  ['slug-changed', 'content.author'],
  ['approve', 'content.review'],
  ['publish', 'content.publish'],
] as const;

export function newPhase14Fixture(): Phase14Fixture {
  const runId = randomUUID().replaceAll('-', '');
  const stem = runId.slice(0, 16);
  return {
    runId,
    eventId: randomUUID(),
    originalSlug: `synthetic-recovery-event-original-${stem}`,
    currentSlug: `synthetic-recovery-event-current-${stem}`,
    auditIds: AUDIT_ACTIONS.map(() => randomUUID()),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase14Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-14 fixture runId does not match the expected pattern.');
  for (const id of [fixture.eventId, ...fixture.auditIds])
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new Error('Invalid synthetic Phase-14 fixture identifier.');
  if (fixture.auditIds.length !== AUDIT_ACTIONS.length)
    throw new Error('Phase-14 fixture audit identifiers are incomplete.');
  for (const slug of [fixture.originalSlug, fixture.currentSlug])
    if (!/^synthetic-recovery-event-[a-z]+-[0-9a-f]{16}$/.test(slug))
      throw new Error('Phase-14 fixture slug is not a synthetic generated slug.');
}

function assertReferences(references: Partial<Phase14References>): void {
  for (const value of Object.values(references))
    if (typeof value !== 'string' || !/^[a-z0-9-]{1,36}$/i.test(value))
      throw new Error('Invalid synthetic Phase-14 fixture reference.');
}

/** `YYYY-MM-DDTHH:mm:00` of a UTC instant, read in a zone by the runtime's IANA data. */
function wallClock(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(`${instant}Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:00`;
}

/**
 * The fixture's time facts are TRUE, not merely typed: every stored instant
 * reads back as its stored local time in the zone, and the fall-back start is
 * genuinely ambiguous — the instant one hour EARLIER reads as the same wall
 * clock — so "the later instant was chosen" is a fact about these values.
 */
function assertZoneFacts(): void {
  for (const occurrence of [...FIRST_OCCURRENCES, ...PHASE14_OCCURRENCES]) {
    if (wallClock(occurrence.startsAt, PHASE14_TIMEZONE) !== occurrence.startsLocal)
      throw new Error(
        `Phase-14 fixture start ${occurrence.startsAt} is not its local time.`,
      );
    if (
      occurrence.endsAt !== null &&
      wallClock(occurrence.endsAt, PHASE14_TIMEZONE) !== occurrence.endsLocal
    )
      throw new Error(`Phase-14 fixture end ${occurrence.endsAt} is not its local time.`);
  }
  const repeated = PHASE14_OCCURRENCES[1];
  if (repeated === undefined)
    throw new Error('Phase-14 fixture lost its fall-back occurrence.');
  const earlier = new Date(Date.parse(`${repeated.startsAt}Z`) - 3_600_000)
    .toISOString()
    .slice(0, 19);
  if (wallClock(earlier, PHASE14_TIMEZONE) !== repeated.startsLocal)
    throw new Error('Phase-14 fixture fall-back start is not in a repeated hour.');
}

const document = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const sqlTime = (value: string | null) => (value === null ? 'NULL' : `'${value}'`);

/**
 * One revision: its slug reservation, its row, its translations, its typed
 * references, its occurrences and its Galleries — then the record moved onto
 * it. Written in the order the append, sequence and integrity triggers require
 * (nothing may be added to a revision once it is current, and a current
 * revision must have an occurrence), so the database's own invariants are
 * exercised rather than bypassed.
 */
async function writeRevision(
  sql: SqlSession,
  fixture: Phase14Fixture,
  revision: {
    readonly number: number;
    readonly slug: string;
    readonly editorId: string;
    readonly centreId: string | null;
    readonly translations: readonly {
      readonly language: 'en' | 'ur';
      readonly title: string;
    }[];
    readonly occurrences: readonly Occurrence[];
    readonly references: { readonly personId: string; readonly topicId: string } | null;
    readonly galleryIds: readonly string[];
  },
): Promise<void> {
  const id = fixture.eventId;
  const n = revision.number;
  const centre = revision.centreId === null ? 'NULL' : `N'${revision.centreId}'`;
  await sql.query(
    `INSERT INTO [dbo].[EventSlugHistory] ([ownerId],[slug]) VALUES (N'${id}',N'${revision.slug}');
     INSERT INTO [dbo].[EventRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage],[timezone],[centreId])
       VALUES (N'${id}',${n},N'${revision.editorId}',N'${revision.slug}',N'en',N'${PHASE14_TIMEZONE}',${centre});`,
  );
  for (const translation of revision.translations)
    await sql.query(
      `INSERT INTO [dbo].[EventRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html])
       VALUES (N'${id}',${n},N'${translation.language}',N'${translation.title}',N'Synthetic fixture',N'',N'',N'${document(`${translation.title} — synthetic recovery body.`)}',N'<p>${translation.title}</p>');`,
    );
  if (revision.references !== null)
    await sql.query(
      `INSERT INTO [dbo].[EventTopic] ([ownerId],[revisionNumber],[topicId]) VALUES (N'${id}',${n},N'${revision.references.topicId}');
       INSERT INTO [dbo].[EventContributor] ([ownerId],[revisionNumber],[personId],[role],[position]) VALUES (N'${id}',${n},N'${revision.references.personId}',N'speaker',0);`,
    );
  for (const o of revision.occurrences)
    await sql.query(
      `INSERT INTO [dbo].[EventSchedule] ([ownerId],[revisionNumber],[position],[startsLocal],[startsAt],[endsLocal],[endsAt])
       VALUES (N'${id}',${n},${o.position},'${o.startsLocal}','${o.startsAt}',${sqlTime(o.endsLocal)},${sqlTime(o.endsAt)});`,
    );
  for (const [position, galleryId] of revision.galleryIds.entries())
    await sql.query(
      `INSERT INTO [dbo].[EventGallery] ([ownerId],[revisionNumber],[position],[galleryId]) VALUES (N'${id}',${n},${position},N'${galleryId}');`,
    );
  await sql.query(
    `UPDATE [dbo].[Event] SET [slug]=N'${revision.slug}',[currentRevision]=${n},[version]=${n},[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id}';`,
  );
}

/**
 * Writes the populated Phase-14 state. In the recovery rehearsal it is written
 * into the SOURCE database before backup with the migration principal; in the
 * permission proof, through the RUNTIME login, so the grants the application
 * relies on are proven sufficient. Either way every constraint and trigger is
 * exercised.
 */
export async function writePhase14Fixture(
  sql: SqlSession,
  fixture: Phase14Fixture,
  references: Phase14References,
): Promise<void> {
  assertSafe(fixture);
  assertReferences(references);
  assertZoneFacts();
  const { authorId, reviewerId } = references;
  const id = fixture.eventId;

  await sql.query(
    `INSERT INTO [dbo].[Event] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${id}',N'${fixture.originalSlug}',N'draft',1,N'${authorId}',SYSUTCDATETIME());`,
  );
  await writeRevision(sql, fixture, {
    number: 1,
    slug: fixture.originalSlug,
    editorId: authorId,
    centreId: null,
    translations: [{ language: 'en', title: TEXT.firstTitle }],
    occurrences: FIRST_OCCURRENCES,
    references: null,
    galleryIds: [],
  });
  await writeRevision(sql, fixture, {
    number: 2,
    slug: fixture.currentSlug,
    editorId: authorId,
    centreId: references.centreId,
    translations: [
      { language: 'en', title: TEXT.titleEn },
      { language: 'ur', title: TEXT.titleUr },
    ],
    occurrences: PHASE14_OCCURRENCES,
    references,
    galleryIds: [references.galleryId],
  });
  await sql.query(
    `UPDATE [dbo].[Event] SET [approvedRevision]=2,[approvedById]=N'${reviewerId}',[state]=N'published',[publishedAt]='2033-06-20T08:00:00',[version]=3 WHERE [id]=N'${id}';`,
  );

  // The workflow's audit trail: which facts changed, never the text.
  for (const [index, [action, source]] of AUDIT_ACTIONS.entries()) {
    const actor = source === 'content.author' ? authorId : reviewerId;
    await sql.query(
      `INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
       VALUES (N'${fixture.auditIds[index] ?? ''}',N'user',N'${actor}',N'editorial.event.${action}',N'event',N'${id}',N'{"version":"${String(index + 1)}"}',N'${source}');`,
    );
  }
}

/** Every authoritative Phase-14 row this fixture wrote, in a stable order. */
export async function capturePhase14Fixture(
  sql: SqlSession,
  fixture: Phase14Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const id = `N'${fixture.eventId}'`;
  const rows: Record<string, string> = {};
  for (const [name, statement, expected] of [
    ['Event', `SELECT * FROM [dbo].[Event] WHERE [id]=${id}`, 1],
    [
      'EventRevision',
      `SELECT * FROM [dbo].[EventRevision] WHERE [ownerId]=${id} ORDER BY [number]`,
      2,
    ],
    [
      'EventRevisionTranslation',
      `SELECT * FROM [dbo].[EventRevisionTranslation] WHERE [ownerId]=${id} ORDER BY [revisionNumber],[languageCode]`,
      3,
    ],
    [
      'EventTopic',
      `SELECT * FROM [dbo].[EventTopic] WHERE [ownerId]=${id} ORDER BY [revisionNumber],[topicId]`,
      1,
    ],
    [
      'EventContributor',
      `SELECT * FROM [dbo].[EventContributor] WHERE [ownerId]=${id} ORDER BY [revisionNumber],[personId],[role]`,
      1,
    ],
    [
      'EventSchedule',
      `SELECT * FROM [dbo].[EventSchedule] WHERE [ownerId]=${id} ORDER BY [revisionNumber],[position]`,
      FIRST_OCCURRENCES.length + PHASE14_OCCURRENCES.length,
    ],
    [
      'EventGallery',
      `SELECT * FROM [dbo].[EventGallery] WHERE [ownerId]=${id} ORDER BY [revisionNumber],[position]`,
      1,
    ],
    [
      'EventSlugHistory',
      `SELECT * FROM [dbo].[EventSlugHistory] WHERE [ownerId]=${id} ORDER BY [slug]`,
      2,
    ],
    // The two references RESOLVE: each joined to the other owner's row it names.
    [
      'EventCentre',
      `SELECT r.[number],c.[id],c.[slug] FROM [dbo].[EventRevision] r JOIN [dbo].[Centre] c ON c.[id]=r.[centreId] WHERE r.[ownerId]=${id}`,
      1,
    ],
    [
      'EventGalleryTarget',
      `SELECT e.[revisionNumber],e.[position],g.[id],g.[slug] FROM [dbo].[EventGallery] e JOIN [dbo].[Gallery] g ON g.[id]=e.[galleryId] WHERE e.[ownerId]=${id}`,
      1,
    ],
    [
      'EventAudit',
      `SELECT [id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource] FROM [dbo].[AuditLog] WHERE [targetType]=N'event' AND [targetId]=${id} ORDER BY [action]`,
      AUDIT_ACTIONS.length,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected)
      throw new Error(
        `Phase-14 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    rows[name] = JSON.stringify(data);
  }
  return rows;
}

/** The Phase-14 tables whose constraints and triggers must return intact. */
const PHASE14_TABLES = [
  'Event',
  'EventRevision',
  'EventRevisionTranslation',
  'EventTopic',
  'EventContributor',
  'EventSchedule',
  'EventGallery',
  'EventSlugHistory',
] as const;

/**
 * Verifies the restored Event state and returns one line of what was proved.
 *
 * BEYOND ROW EQUALITY: every stored local time and UTC instant exactly as
 * written, read back as text so no driver conversion can hide a shift; the IANA
 * zone on both revisions; the current revision still naming THE Centre and THE
 * Gallery passed in; the two former and current slugs; the published state on
 * the approved current revision; all fifteen invariant triggers enabled; and
 * every Phase-14 CHECK and foreign key — sixteen and nineteen — present,
 * enabled, trusted and non-cascading.
 */
export async function verifyRestoredPhase14(
  sql: SqlSession,
  fixture: Phase14Fixture,
  expected: Readonly<Record<string, string>>,
  references: Pick<Phase14References, 'centreId' | 'galleryId'>,
): Promise<string> {
  assertReferences(references);
  deepStrictEqual(
    await capturePhase14Fixture(sql, fixture),
    expected,
    'Phase-14 Event authoritative values changed during recovery.',
  );
  const id = fixture.eventId;

  const occurrences = await sql.query<{
    position: number;
    startsLocal: string;
    startsAt: string;
    endsLocal: string | null;
    endsAt: string | null;
  }>(
    `SELECT [position],
            CONVERT(CHAR(19),[startsLocal],126) AS [startsLocal],
            CONVERT(CHAR(19),[startsAt],126) AS [startsAt],
            CONVERT(CHAR(19),[endsLocal],126) AS [endsLocal],
            CONVERT(CHAR(19),[endsAt],126) AS [endsAt]
     FROM [dbo].[EventSchedule] WHERE [ownerId]=N'${id}' AND [revisionNumber]=2 ORDER BY [position];`,
  );
  deepStrictEqual(
    occurrences.map((row) => ({ ...row, position: Number(row.position) })),
    PHASE14_OCCURRENCES,
    'Restored Phase-14 local times or UTC instants are not exactly as written.',
  );

  const revisions = await sql.query<{
    number: number;
    timezone: string;
    centreId: string | null;
  }>(
    `SELECT [number],[timezone],[centreId] FROM [dbo].[EventRevision] WHERE [ownerId]=N'${id}' ORDER BY [number];`,
  );
  if (
    revisions.length !== 2 ||
    !revisions.every((row) => row.timezone === PHASE14_TIMEZONE) ||
    revisions[0]?.centreId !== null ||
    revisions[1]?.centreId !== references.centreId
  )
    throw new Error(
      `Restored Phase-14 revisions lost their zone or Centre: ${JSON.stringify(revisions)}.`,
    );

  const [gallery] = await sql.query<{ galleryId: string; exists: number }>(
    `SELECT e.[galleryId],(SELECT COUNT_BIG(*) FROM [dbo].[Gallery] g WHERE g.[id]=e.[galleryId]) AS [exists]
     FROM [dbo].[EventGallery] e WHERE e.[ownerId]=N'${id}' AND e.[revisionNumber]=2 AND e.[position]=0;`,
  );
  if (gallery?.galleryId !== references.galleryId || Number(gallery.exists) !== 1)
    throw new Error('Restored Phase-14 Event no longer names its Gallery.');

  const [record] = await sql.query<{
    slug: string;
    state: string;
    currentRevision: number;
    approvedRevision: number;
  }>(
    `SELECT [slug],[state],[currentRevision],[approvedRevision] FROM [dbo].[Event] WHERE [id]=N'${id}';`,
  );
  if (
    record?.slug !== fixture.currentSlug ||
    record.state !== 'published' ||
    Number(record.currentRevision) !== 2 ||
    Number(record.approvedRevision) !== 2
  )
    throw new Error(
      `Restored Phase-14 Event is not the published revision: ${JSON.stringify(record ?? null)}.`,
    );
  const slugs = await sql.query<{ slug: string }>(
    `SELECT [slug] FROM [dbo].[EventSlugHistory] WHERE [ownerId]=N'${id}' ORDER BY [slug];`,
  );
  if (
    slugs.map((row) => row.slug).join(',') !==
    [fixture.currentSlug, fixture.originalSlug].sort().join(',')
  )
    throw new Error('Restored Phase-14 slug history does not match.');

  const [title] = await sql.query<{ title: string }>(
    `SELECT [title] FROM [dbo].[EventRevisionTranslation] WHERE [ownerId]=N'${id}' AND [revisionNumber]=2 AND [languageCode]=N'ur';`,
  );
  if (title?.title !== TEXT.titleUr)
    throw new Error('Restored Urdu Phase-14 title does not match.');

  const tables = PHASE14_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const [counts] = await sql.query<{ triggers: number; checks: number; keys: number }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.triggers WHERE [parent_id] IN (${tables}) AND [is_disabled]=0) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys];`,
  );
  // 15 triggers, 16 CHECKs and 19 foreign keys, exactly as the migration
  // creates them: a restore that silently lost one would otherwise read as
  // "none untrusted".
  if (
    Number(counts?.triggers ?? 0) !== 15 ||
    Number(counts?.checks ?? 0) !== 16 ||
    Number(counts?.keys ?? 0) !== 19
  )
    throw new Error(
      `Restored Phase-14 invariant set is incomplete: ${String(counts?.triggers ?? 0)} enabled triggers, ` +
        `${String(counts?.checks ?? 0)} CHECKs, ${String(counts?.keys ?? 0)} foreign keys.`,
    );
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1
            OR delete_referential_action<>0 OR update_referential_action<>0);`,
  );
  if (broken.length > 0)
    throw new Error(
      `Restored Phase-14 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );

  return 'renamed slugs, immutable revisions, approval, IANA zone, exact local and UTC occurrence times across a DST fall-back, Centre and Gallery references and audit intact';
}
