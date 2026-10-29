import 'server-only';
import { randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import type { SqlSession } from './sql-connection.ts';

export interface Phase6Fixture {
  readonly articleId: string;
  readonly pageId: string;
  readonly contactId: string;
  readonly feedbackId: string;
}
export function newPhase6Fixture(): Phase6Fixture {
  return {
    articleId: randomUUID(),
    pageId: randomUUID(),
    contactId: randomUUID(),
    feedbackId: randomUUID(),
  };
}
function safe(f: Phase6Fixture) {
  for (const id of Object.values(f))
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new Error('Invalid synthetic Phase 6 fixture identifier.');
}
const text = {
  en: 'Synthetic recovery proof. Non-authoritative.',
  ur: 'بحالی کا غیر مستند آزمائشی متن',
  ar: 'نص اختباري غير معتمد للاستعادة',
};
export async function writePhase6Fixture(
  sql: SqlSession,
  f: Phase6Fixture,
  references: { authorId: string; reviewerId: string; personId: string; topicId: string },
): Promise<void> {
  safe(f);
  for (const value of Object.values(references))
    if (!/^[a-z0-9-]{1,36}$/i.test(value))
      throw new Error('Invalid synthetic fixture reference.');
  const { authorId, reviewerId, personId, topicId } = references;
  for (const [table, id] of [
    ['Article', f.articleId],
    ['Page', f.pageId],
  ] as const) {
    await sql.query(
      `INSERT INTO [${table}] ([id],[slug],[state],[version],[creatorId],[updatedAt]${table === 'Page' ? ', [routeBinding]' : ''}) VALUES (N'${id}',N'recovery-${id}-1',N'draft',1,N'${authorId}',SYSUTCDATETIME()${table === 'Page' ? ", N'help-article'" : ''});`,
    );
    for (const revision of [1, 2]) {
      await sql.query(`INSERT INTO [${table}SlugHistory] ([ownerId],[slug]${table === 'Page' ? ', [routeBinding]' : ''}) VALUES (N'${id}',N'recovery-${id}-${revision}'${table === 'Page' ? ", N'help-article'" : ''});
        INSERT INTO [${table}Revision] ([ownerId],[number],[editorId],[slug],[primaryLanguage]) VALUES (N'${id}',${revision},N'${authorId}',N'recovery-${id}-${revision}',N'ur');`);
      for (const language of ['en', 'ur', 'ar'] as const) {
        const body = text[language] + ' ' + revision;
        const document = JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
        });
        await sql.query(
          `INSERT INTO [${table}RevisionTranslation] ([ownerId],[revisionNumber],[languageCode],[title],[excerpt],[seoTitle],[seoDescription],[document],[html]) VALUES (N'${id}',${revision},N'${language}',N'${body}',N'Synthetic fixture',N'',N'',N'${document}',N'<p>${body}</p>');`,
        );
      }
      await sql.query(`INSERT INTO [${table}Topic] ([ownerId],[revisionNumber],[topicId]) VALUES (N'${id}',${revision},N'${topicId}');
        INSERT INTO [${table}Contributor] ([ownerId],[revisionNumber],[personId],[role],[position]) VALUES (N'${id}',${revision},N'${personId}',N'author',0);
        UPDATE [${table}] SET [slug]=N'recovery-${id}-${revision}',[currentRevision]=${revision},[version]=${revision} WHERE [id]=N'${id}';`);
    }
    await sql.query(
      `UPDATE [${table}] SET [state]=N'${table === 'Article' ? 'published' : 'scheduled'}',[approvedRevision]=2,[approvedById]=N'${reviewerId}',[scheduledRevision]=2,[scheduledById]=N'${reviewerId}',[scheduledAt]='2099-01-01T00:00:00',[scheduledTimezone]=N'Asia/Karachi',[scheduleStatus]=N'${table === 'Article' ? 'completed' : 'pending'}',[publishedAt]=${table === 'Article' ? 'SYSUTCDATETIME()' : 'NULL'}${table === 'Article' ? ',[chronologyAt]=SYSUTCDATETIME()' : ''} WHERE [id]=N'${id}';`,
    );
  }
  await sql.query(`INSERT INTO [ContactInquiry] ([id],[name],[email],[subject],[body],[state],[version],[note],[updatedAt],[retainUntil]) VALUES (N'${f.contactId}',N'Synthetic correspondence',N'recovery@proof.invalid',N'Synthetic contact',N'Private synthetic recovery body',N'triaged',2,N'Private synthetic operator note',SYSUTCDATETIME(),'2099-01-01');
    INSERT INTO [Feedback] ([id],[category],[body],[state],[version],[note],[updatedAt],[retainUntil]) VALUES (N'${f.feedbackId}',N'accessibility',N'Private synthetic feedback',N'spam',2,N'Private synthetic triage note',SYSUTCDATETIME(),'2099-01-01');`);
}
export async function capturePhase6Fixture(
  sql: SqlSession,
  f: Phase6Fixture,
): Promise<Readonly<Record<string, string>>> {
  safe(f);
  const rows: Record<string, string> = {};
  for (const [table, id] of [
    ['Article', f.articleId],
    ['Page', f.pageId],
  ] as const) {
    for (const [suffix, key, order, expected] of [
      ['', 'id', 'id', 1],
      ['Revision', 'ownerId', 'number', 2],
      ['RevisionTranslation', 'ownerId', 'revisionNumber,languageCode', 6],
      ['Topic', 'ownerId', 'revisionNumber,topicId', 2],
      ['Contributor', 'ownerId', 'revisionNumber,personId,role', 2],
      ['SlugHistory', 'ownerId', 'slug', 2],
    ] as const) {
      const data = await sql.query(
        `SELECT * FROM [${table}${suffix}] WHERE [${key}]=N'${id}' ORDER BY ${order};`,
      );
      if (data.length !== expected)
        throw new Error('Missing Phase 6 recovery rows in ' + table + suffix);
      rows[table + suffix] = JSON.stringify(data);
    }
  }
  for (const [table, id] of [
    ['ContactInquiry', f.contactId],
    ['Feedback', f.feedbackId],
  ] as const) {
    const data = await sql.query(`SELECT * FROM [${table}] WHERE [id]=N'${id}';`);
    if (data.length !== 1)
      throw new Error('Missing private correspondence recovery row.');
    rows[table] = JSON.stringify(data);
  }
  return rows;
}
export async function verifyRestoredPhase6(
  sql: SqlSession,
  f: Phase6Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase6Fixture(sql, f),
    expected,
    'Editorial authoritative values changed during recovery.',
  );
  const constraints = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints WHERE parent_object_id IN (OBJECT_ID(N'Article'),OBJECT_ID(N'Page')) AND (is_disabled=1 OR is_not_trusted=1);`,
  );
  if (constraints.length)
    throw new Error('Restored Editorial constraints are not trusted and enabled.');
  for (const table of ['Article', 'Page']) {
    const [trigger] = await sql.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM sys.triggers WHERE [name]=N'${table}RevisionTranslationImmutable' AND is_disabled=0;`,
    );
    if (trigger?.total !== 1)
      throw new Error('Restored revision immutability is missing.');
  }
  return '14 tables: exact multilingual revisions, typed references, approval, schedule, slug history and private retention/triage values intact';
}
