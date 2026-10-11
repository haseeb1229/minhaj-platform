import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-15 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That a
 * Collection came back with its WORKFLOW, its HISTORY and its ORDERED, TYPED
 * MEMBERSHIP into other owners' records:
 *
 *   - one published Collection, renamed once, so two immutable revisions and
 *     two permanent slug reservations must return, with the approval of the
 *     exact current revision by someone other than its author;
 *   - English, Urdu and Arabic translations, a typed Topic and a typed Person on
 *     the current revision;
 *   - a current revision whose members are ALL SEVEN member types — an Article,
 *     a NewsArticle, a PressRelease, a Statement, a MediaCoverage record, a Work
 *     and a Video — in ONE deliberate mixed order, and a first revision whose
 *     smaller, differently ordered set must come back unchanged beside it;
 *   - a second Collection SCHEDULED for later, its pending schedule bound to its
 *     approved revision, with members of two types;
 *   - the audit trail of both workflows, recording member COUNTS only.
 *
 * The members are NOT this fixture's: they are the synthetic records the
 * Phase-6, Phase-8, Phase-10 and Phase-13 fixtures (or a permission proof)
 * already wrote, passed in as references — exactly as a Collection names other
 * owners' rows rather than creating them.
 *
 * EVERYTHING IS SYNTHETIC: no real organisation, collection, publication or
 * person is named.
 */

/** The seven member types, each with its own typed column and owner table. */
export const PHASE15_MEMBERS = [
  { kind: 'article', column: 'articleId', table: 'Article' },
  { kind: 'news-article', column: 'newsArticleId', table: 'NewsArticle' },
  { kind: 'press-release', column: 'pressReleaseId', table: 'PressRelease' },
  { kind: 'statement', column: 'statementId', table: 'Statement' },
  { kind: 'media-coverage', column: 'mediaCoverageId', table: 'MediaCoverage' },
  { kind: 'work', column: 'workId', table: 'Work' },
  { kind: 'video', column: 'videoId', table: 'Video' },
] as const;

export type Phase15MemberKind = (typeof PHASE15_MEMBERS)[number]['kind'];

export interface Phase15Fixture {
  readonly runId: string;
  /** The published, renamed Collection. */
  readonly collectionId: string;
  readonly originalSlug: string;
  readonly currentSlug: string;
  /** The approved Collection scheduled for later. */
  readonly scheduledId: string;
  readonly scheduledSlug: string;
  readonly auditIds: readonly string[];
}

export interface Phase15References {
  readonly authorId: string;
  readonly reviewerId: string;
  readonly personId: string;
  readonly topicId: string;
  /** One existing synthetic record of each member type. */
  readonly members: Readonly<Record<Phase15MemberKind, string>>;
}

/** The current revision's ONE mixed order: every type, deliberately interleaved. */
export const PHASE15_ORDER: readonly Phase15MemberKind[] = [
  'video',
  'article',
  'news-article',
  'work',
  'press-release',
  'statement',
  'media-coverage',
];

/** The first revision's members, in an order the current revision reverses. */
const FIRST_ORDER: readonly Phase15MemberKind[] = ['work', 'article'];

/** The scheduled Collection's members. */
const SCHEDULED_ORDER: readonly Phase15MemberKind[] = ['statement', 'video'];

/** The instant the scheduled Collection is due, far beyond any rehearsal. */
const SCHEDULED_AT = '2099-03-01T06:00:00';

const TEXT = {
  firstTitle: 'Synthetic recovery collection, first draft',
  titleEn: 'Synthetic recovery collection',
  titleUr: 'بحالی کے ثبوت کا آزمائشی مجموعہ',
  titleAr: 'مجموعة تجريبية لإثبات الاستعادة',
  scheduledTitle: 'Synthetic scheduled collection',
} as const;

const PUBLISHED_AUDIT = [
  ['created', 'content.author', 2],
  ['revised', 'content.author', null],
  ['slug-changed', 'content.author', null],
  ['members-changed', 'content.author', PHASE15_ORDER.length],
  ['approve', 'content.review', null],
  ['publish', 'content.publish', null],
] as const;

const SCHEDULED_AUDIT = [
  ['created', 'content.author', SCHEDULED_ORDER.length],
  ['submit', 'content.author', null],
  ['approve', 'content.review', null],
  ['schedule', 'content.publish', null],
] as const;

export function newPhase15Fixture(): Phase15Fixture {
  const runId = randomUUID().replaceAll('-', '');
  const stem = runId.slice(0, 16);
  return {
    runId,
    collectionId: randomUUID(),
    originalSlug: `synthetic-recovery-collection-original-${stem}`,
    currentSlug: `synthetic-recovery-collection-current-${stem}`,
    scheduledId: randomUUID(),
    scheduledSlug: `synthetic-recovery-collection-scheduled-${stem}`,
    auditIds: [...PUBLISHED_AUDIT, ...SCHEDULED_AUDIT].map(() => randomUUID()),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase15Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-15 fixture runId does not match the expected pattern.');
  for (const id of [fixture.collectionId, fixture.scheduledId, ...fixture.auditIds])
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new Error('Invalid synthetic Phase-15 fixture identifier.');
  if (fixture.auditIds.length !== PUBLISHED_AUDIT.length + SCHEDULED_AUDIT.length)
    throw new Error('Phase-15 fixture audit identifiers are incomplete.');
  for (const slug of [fixture.originalSlug, fixture.currentSlug, fixture.scheduledSlug])
    if (!/^synthetic-recovery-collection-[a-z]+-[0-9a-f]{16}$/.test(slug))
      throw new Error('Phase-15 fixture slug is not a synthetic generated slug.');
}

function assertReferences(references: Phase15References): void {
  const { members, ...people } = references;
  for (const value of [...Object.values(people), ...Object.values(members)])
    if (typeof value !== 'string' || !/^[a-z0-9-]{1,36}$/i.test(value))
      throw new Error('Invalid synthetic Phase-15 fixture reference.');
  if (
    Object.keys(members).sort().join(',') !==
    PHASE15_MEMBERS.map((m) => m.kind)
      .sort()
      .join(',')
  )
    throw new Error('Phase-15 fixture needs exactly one record of each member type.');
}

function memberOf(kind: Phase15MemberKind): (typeof PHASE15_MEMBERS)[number] {
  const member = PHASE15_MEMBERS.find((entry) => entry.kind === kind);
  if (member === undefined) throw new Error(`Unknown Phase-15 member type ${kind}.`);
  return member;
}

/** `position=kind:id`, in order — the shape a restored order is compared in. */
function describeOrder(
  order: readonly Phase15MemberKind[],
  members: Readonly<Record<Phase15MemberKind, string>>,
): string {
  return order
    .map((kind, position) => `${String(position)}=${kind}:${members[kind]}`)
    .join(',');
}

const document = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/**
 * One revision: its slug reservation (when new), its row, its translations, its
 * typed references and its ordered members — then the record moved onto it.
 * Written in the order the append, sequence and integrity triggers require
 * (nothing may be added to a revision once it is current, and a current
 * revision must have a member), so the database's own invariants are exercised
 * rather than bypassed.
 */
async function writeRevision(
  sql: SqlSession,
  id: string,
  revision: {
    readonly number: number;
    readonly slug: string;
    readonly reserve: boolean;
    readonly editorId: string;
    readonly translations: readonly {
      readonly language: 'en' | 'ur' | 'ar';
      readonly title: string;
    }[];
    readonly references: { readonly personId: string; readonly topicId: string } | null;
    readonly order: readonly Phase15MemberKind[];
    readonly members: Readonly<Record<Phase15MemberKind, string>>;
  },
): Promise<void> {
  const n = revision.number;
  await sql.query(
    `${revision.reserve ? `INSERT INTO [dbo].[CollectionSlugHistory] ([ownerId],[slug]) VALUES (N'${id}',N'${revision.slug}');` : ''}
     INSERT INTO [dbo].[CollectionRevision] ([ownerId],[number],[editorId],[slug],[primaryLanguage])
       VALUES (N'${id}',${n},N'${revision.editorId}',N'${revision.slug}',N'en');`,
  );
  for (const translation of revision.translations)
    await sql.query(
      `INSERT INTO [dbo].[CollectionRevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html])
       VALUES (N'${id}',${n},N'${translation.language}',N'${translation.title}',N'Synthetic fixture',N'',N'',N'${document(`${translation.title} — synthetic recovery introduction.`)}',N'<p>${translation.title}</p>');`,
    );
  if (revision.references !== null)
    await sql.query(
      `INSERT INTO [dbo].[CollectionTopic] ([ownerId],[revisionNumber],[topicId]) VALUES (N'${id}',${n},N'${revision.references.topicId}');
       INSERT INTO [dbo].[CollectionContributor] ([ownerId],[revisionNumber],[personId],[role],[position]) VALUES (N'${id}',${n},N'${revision.references.personId}',N'compiler',0);`,
    );
  for (const [position, kind] of revision.order.entries())
    await sql.query(
      `INSERT INTO [dbo].[CollectionItem] ([ownerId],[revisionNumber],[position],[${memberOf(kind).column}]) VALUES (N'${id}',${n},${position},N'${revision.members[kind]}');`,
    );
  await sql.query(
    `UPDATE [dbo].[Collection] SET [slug]=N'${revision.slug}',[currentRevision]=${n},[version]=${n},[updatedAt]=SYSUTCDATETIME() WHERE [id]=N'${id}';`,
  );
}

/**
 * Writes the populated Phase-15 state. In the recovery rehearsal it is written
 * into the SOURCE database before backup with the migration principal; in the
 * permission proof, through the RUNTIME login, so the grants the application
 * relies on are proven sufficient. Either way every constraint and trigger is
 * exercised.
 */
export async function writePhase15Fixture(
  sql: SqlSession,
  fixture: Phase15Fixture,
  references: Phase15References,
): Promise<void> {
  assertSafe(fixture);
  assertReferences(references);
  const { authorId, reviewerId, members } = references;
  const id = fixture.collectionId;

  // The published Collection: a two-member first draft, then a renamed,
  // translated revision that gathers all seven types in one mixed order.
  await sql.query(
    `INSERT INTO [dbo].[Collection] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${id}',N'${fixture.originalSlug}',N'draft',1,N'${authorId}',SYSUTCDATETIME());`,
  );
  await writeRevision(sql, id, {
    number: 1,
    slug: fixture.originalSlug,
    reserve: true,
    editorId: authorId,
    translations: [{ language: 'en', title: TEXT.firstTitle }],
    references: null,
    order: FIRST_ORDER,
    members,
  });
  await writeRevision(sql, id, {
    number: 2,
    slug: fixture.currentSlug,
    reserve: true,
    editorId: authorId,
    translations: [
      { language: 'en', title: TEXT.titleEn },
      { language: 'ur', title: TEXT.titleUr },
      { language: 'ar', title: TEXT.titleAr },
    ],
    references,
    order: PHASE15_ORDER,
    members,
  });
  await sql.query(
    `UPDATE [dbo].[Collection] SET [approvedRevision]=2,[approvedById]=N'${reviewerId}',[state]=N'published',[publishedAt]='2033-08-20T08:00:00',[version]=3 WHERE [id]=N'${id}';`,
  );

  // The scheduled Collection: approved independently and due far in the future.
  const scheduled = fixture.scheduledId;
  await sql.query(
    `INSERT INTO [dbo].[Collection] ([id],[slug],[state],[version],[creatorId],[updatedAt]) VALUES (N'${scheduled}',N'${fixture.scheduledSlug}',N'draft',1,N'${authorId}',SYSUTCDATETIME());`,
  );
  await writeRevision(sql, scheduled, {
    number: 1,
    slug: fixture.scheduledSlug,
    reserve: true,
    editorId: authorId,
    translations: [{ language: 'en', title: TEXT.scheduledTitle }],
    references: null,
    order: SCHEDULED_ORDER,
    members,
  });
  await sql.query(
    `UPDATE [dbo].[Collection] SET [state]=N'in-review',[version]=2 WHERE [id]=N'${scheduled}';
     UPDATE [dbo].[Collection] SET [approvedRevision]=1,[approvedById]=N'${reviewerId}',[state]=N'scheduled',[scheduledRevision]=1,[scheduledAt]='${SCHEDULED_AT}',[scheduledTimezone]=N'Asia/Karachi',[scheduledById]=N'${reviewerId}',[scheduleStatus]=N'pending',[version]=3 WHERE [id]=N'${scheduled}';`,
  );

  // The workflows' audit trail: which facts changed and how many members a
  // revision holds — never a title, a body or a member's title.
  const trail = [
    ...PUBLISHED_AUDIT.map((entry) => [id, ...entry] as const),
    ...SCHEDULED_AUDIT.map((entry) => [scheduled, ...entry] as const),
  ];
  for (const [index, [target, action, source, count]] of trail.entries()) {
    const actor = source === 'content.author' ? authorId : reviewerId;
    const after =
      count === null
        ? `{"version":"${String(index + 1)}"}`
        : `{"version":"${String(index + 1)}","members":"${String(count)}"}`;
    await sql.query(
      `INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
       VALUES (N'${fixture.auditIds[index] ?? ''}',N'user',N'${actor}',N'editorial.collection.${action}',N'collection',N'${target}',N'${after}',N'${source}');`,
    );
  }
}

/** Every authoritative Phase-15 row this fixture wrote, in a stable order. */
export async function capturePhase15Fixture(
  sql: SqlSession,
  fixture: Phase15Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const ids = `N'${fixture.collectionId}',N'${fixture.scheduledId}'`;
  const items = FIRST_ORDER.length + PHASE15_ORDER.length + SCHEDULED_ORDER.length;
  const rows: Record<string, string> = {};
  for (const [name, statement, expected] of [
    [
      'Collection',
      `SELECT * FROM [dbo].[Collection] WHERE [id] IN (${ids}) ORDER BY [id]`,
      2,
    ],
    [
      'CollectionRevision',
      `SELECT * FROM [dbo].[CollectionRevision] WHERE [ownerId] IN (${ids}) ORDER BY [ownerId],[number]`,
      3,
    ],
    [
      'CollectionRevisionTranslation',
      `SELECT * FROM [dbo].[CollectionRevisionTranslation] WHERE [ownerId] IN (${ids}) ORDER BY [ownerId],[revisionNumber],[languageCode]`,
      5,
    ],
    [
      'CollectionTopic',
      `SELECT * FROM [dbo].[CollectionTopic] WHERE [ownerId] IN (${ids}) ORDER BY [ownerId],[revisionNumber],[topicId]`,
      1,
    ],
    [
      'CollectionContributor',
      `SELECT * FROM [dbo].[CollectionContributor] WHERE [ownerId] IN (${ids}) ORDER BY [ownerId],[revisionNumber],[personId],[role]`,
      1,
    ],
    [
      'CollectionItem',
      `SELECT * FROM [dbo].[CollectionItem] WHERE [ownerId] IN (${ids}) ORDER BY [ownerId],[revisionNumber],[position]`,
      items,
    ],
    [
      'CollectionSlugHistory',
      `SELECT * FROM [dbo].[CollectionSlugHistory] WHERE [ownerId] IN (${ids}) ORDER BY [slug]`,
      3,
    ],
    // Every member RESOLVES: each place joined to the one owner row it names.
    [
      'CollectionMemberTargets',
      `SELECT m.[ownerId],m.[revisionNumber],m.[position],${PHASE15_MEMBERS.map(
        (member, index) => `t${String(index)}.[id] AS [${member.column}]`,
      ).join(',')}
       FROM [dbo].[CollectionItem] m
       ${PHASE15_MEMBERS.map(
         (member, index) =>
           `LEFT JOIN [dbo].[${member.table}] t${String(index)} ON t${String(index)}.[id]=m.[${member.column}]`,
       ).join('\n       ')}
       WHERE m.[ownerId] IN (${ids})
         AND (${PHASE15_MEMBERS.map((_, index) => `CASE WHEN t${String(index)}.[id] IS NULL THEN 0 ELSE 1 END`).join(' + ')})=1
       ORDER BY m.[ownerId],m.[revisionNumber],m.[position]`,
      items,
    ],
    [
      'CollectionAudit',
      `SELECT [id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource] FROM [dbo].[AuditLog] WHERE [targetType]=N'collection' AND [targetId] IN (${ids}) ORDER BY [targetId],[action]`,
      PUBLISHED_AUDIT.length + SCHEDULED_AUDIT.length,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected)
      throw new Error(
        `Phase-15 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    rows[name] = JSON.stringify(data);
  }
  return rows;
}

/** The Phase-15 tables whose constraints and triggers must return intact. */
const PHASE15_TABLES = [
  'Collection',
  'CollectionRevision',
  'CollectionRevisionTranslation',
  'CollectionTopic',
  'CollectionContributor',
  'CollectionItem',
  'CollectionSlugHistory',
] as const;

/** The two editorial descriptions exactly as the Phase-15 migration stores them. */
const PHASE15_DESCRIPTIONS = [
  [
    'content.author',
    'Create and revise Article, Page, news, press release, statement, media coverage, event and collection drafts and submit them for review.',
  ],
  [
    'content.read',
    'Read private Article, Page, news, press release, statement, media coverage, event and collection drafts and revisions.',
  ],
] as const;

/**
 * Verifies the restored Collection state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: the canonical row is the published, approved current
 * revision under the current slug, and the old slug is still reserved to it;
 * both revisions' orders are exactly the written ones, position by position,
 * each place naming THE record passed in and that record still existing; the
 * scheduled Collection is still pending at its exact instant, bound to its
 * approved revision; the Urdu and Arabic titles are byte-exact; the editorial
 * descriptions name collections and no `collection.*` key exists; all thirteen
 * invariant triggers are enabled; and every Phase-15 CHECK, foreign key and
 * filtered member index — twelve, twenty-three and seven — is present,
 * enabled, trusted and non-cascading.
 */
export async function verifyRestoredPhase15(
  sql: SqlSession,
  fixture: Phase15Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase15References,
): Promise<string> {
  assertReferences(references);
  deepStrictEqual(
    await capturePhase15Fixture(sql, fixture),
    expected,
    'Phase-15 Collection authoritative values changed during recovery.',
  );
  const id = fixture.collectionId;
  const { members } = references;

  const orderOf = async (owner: string, number: number): Promise<string> => {
    const rows = await sql.query<{ position: number; member: string }>(
      `SELECT [position], ${PHASE15_MEMBERS.map(
        (member) =>
          `CASE WHEN [${member.column}] IS NOT NULL THEN N'${member.kind}:' + [${member.column}] ELSE N'' END`,
      ).join(' + ')} AS [member]
       FROM [dbo].[CollectionItem] WHERE [ownerId]=N'${owner}' AND [revisionNumber]=${number}
       ORDER BY [position];`,
    );
    return rows.map((row) => `${String(row.position)}=${row.member}`).join(',');
  };
  for (const [owner, number, order] of [
    [id, 2, PHASE15_ORDER],
    [id, 1, FIRST_ORDER],
    [fixture.scheduledId, 1, SCHEDULED_ORDER],
  ] as const) {
    const restored = await orderOf(owner, number);
    if (restored !== describeOrder(order, members))
      throw new Error(
        `Restored Phase-15 member order is not exactly as written: ${restored}.`,
      );
  }

  const [record] = await sql.query<{
    slug: string;
    state: string;
    currentRevision: number;
    approvedRevision: number;
    approvedById: string;
  }>(
    `SELECT [slug],[state],[currentRevision],[approvedRevision],[approvedById] FROM [dbo].[Collection] WHERE [id]=N'${id}';`,
  );
  if (
    record?.slug !== fixture.currentSlug ||
    record.state !== 'published' ||
    Number(record.currentRevision) !== 2 ||
    Number(record.approvedRevision) !== 2 ||
    record.approvedById !== references.reviewerId
  )
    throw new Error(
      `Restored Phase-15 Collection is not the published revision: ${JSON.stringify(record ?? null)}.`,
    );
  const slugs = await sql.query<{ slug: string }>(
    `SELECT [slug] FROM [dbo].[CollectionSlugHistory] WHERE [ownerId]=N'${id}' ORDER BY [slug];`,
  );
  if (
    slugs.map((row) => row.slug).join(',') !==
    [fixture.currentSlug, fixture.originalSlug].sort().join(',')
  )
    throw new Error('Restored Phase-15 slug history does not match.');

  const [scheduled] = await sql.query<{
    state: string;
    scheduledRevision: number;
    approvedRevision: number;
    scheduleStatus: string;
    scheduledAt: string;
    scheduledTimezone: string;
  }>(
    `SELECT [state],[scheduledRevision],[approvedRevision],[scheduleStatus],
            CONVERT(CHAR(19),[scheduledAt],126) AS [scheduledAt],[scheduledTimezone]
     FROM [dbo].[Collection] WHERE [id]=N'${fixture.scheduledId}';`,
  );
  if (
    scheduled?.state !== 'scheduled' ||
    Number(scheduled.scheduledRevision) !== 1 ||
    Number(scheduled.approvedRevision) !== 1 ||
    scheduled.scheduleStatus !== 'pending' ||
    scheduled.scheduledAt !== SCHEDULED_AT ||
    scheduled.scheduledTimezone !== 'Asia/Karachi'
  )
    throw new Error(
      `Restored Phase-15 scheduled Collection lost its schedule: ${JSON.stringify(scheduled ?? null)}.`,
    );

  const titles = await sql.query<{ languageCode: string; title: string }>(
    `SELECT [languageCode],[title] FROM [dbo].[CollectionRevisionTranslation]
     WHERE [ownerId]=N'${id}' AND [revisionNumber]=2 ORDER BY [languageCode];`,
  );
  deepStrictEqual(
    titles.map((row) => [row.languageCode, row.title]),
    [
      ['ar', TEXT.titleAr],
      ['en', TEXT.titleEn],
      ['ur', TEXT.titleUr],
    ],
    'Restored Phase-15 translated titles do not match.',
  );

  const descriptions = await sql.query<{ key: string; description: string }>(
    `SELECT [key],[description] FROM [dbo].[Permission]
     WHERE [key] IN (N'content.read',N'content.author') OR [key] LIKE N'collection%'
     ORDER BY [key];`,
  );
  deepStrictEqual(
    descriptions.map((row) => [row.key, row.description]),
    PHASE15_DESCRIPTIONS.map(([key, description]) => [key, description]),
    'Restored Phase-15 editorial descriptions or permission vocabulary changed.',
  );

  const tables = PHASE15_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const [counts] = await sql.query<{
    triggers: number;
    checks: number;
    keys: number;
    indexes: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.triggers WHERE [parent_id] IN (${tables}) AND [is_disabled]=0) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [object_id]=OBJECT_ID(N'CollectionItem') AND is_unique=1 AND has_filter=1
           AND is_disabled=0) AS [indexes];`,
  );
  // 13 triggers, 12 CHECKs, 23 foreign keys and 7 filtered member indexes,
  // exactly as the migration creates them: a restore that silently lost one
  // would otherwise read as "none untrusted".
  if (
    Number(counts?.triggers ?? 0) !== 13 ||
    Number(counts?.checks ?? 0) !== 12 ||
    Number(counts?.keys ?? 0) !== 23 ||
    Number(counts?.indexes ?? 0) !== 7
  )
    throw new Error(
      `Restored Phase-15 invariant set is incomplete: ${String(counts?.triggers ?? 0)} enabled triggers, ` +
        `${String(counts?.checks ?? 0)} CHECKs, ${String(counts?.keys ?? 0)} foreign keys, ` +
        `${String(counts?.indexes ?? 0)} filtered member indexes.`,
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
      `Restored Phase-15 constraints are not trusted: ${broken.map((row) => row.name).join(', ')}`,
    );

  return 'renamed slugs, immutable revisions, approval, en/ur/ar text, seven member types in their exact mixed order, a pending schedule, the descriptions and audit intact';
}
