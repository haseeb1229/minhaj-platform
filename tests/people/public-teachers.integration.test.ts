import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, databaseConfigured } from '../identity/harness.ts';
import type { DisposableDatabase } from '../identity/harness.ts';
import {
  PROOF_ACTOR,
  createPeopleHarness,
  createProofAccount,
  freshSlug,
  type PeopleHarness,
} from './harness.ts';

/**
 * Phase 23 — People's public answer about teachers, keyed by account.
 *
 * `publicTeachers` is what Learning's Layer-4 directory asks: of these
 * accounts, which are linked to a PUBLISHED Person holding an ACTIVE
 * TeacherProfile, and what are that profile's public words. It is
 * presentation and admission only — the proofs below show it returns nothing
 * for a draft Person, an archived profile or an unlinked account, never
 * leaks a linked account the caller did not name, and resolves the name and
 * subjects in the asked locale with the primary-locale fallback.
 *
 * Learn Part 2 adds the Person's public portrait — the reference every public
 * card carries, or null — so the directory can show a face People publishes.
 */

const describeLive = databaseConfigured ? describe : describe.skip;

describeLive('Phase 23 — People public teacher facts over a live database', () => {
  let database: DisposableDatabase;
  let admin: SqlSession;
  let harness: PeopleHarness;

  beforeAll(async () => {
    database = await createProofDatabase();
    admin = database.admin;
    harness = await createPeopleHarness();
  }, 240_000);

  afterAll(async () => {
    await database?.close();
  });

  async function person(status: 'published' | 'draft', name: string) {
    const slug = freshSlug('proof-teacher');
    const created = await harness.people.createPerson(PROOF_ACTOR, {
      slug,
      primaryLocale: 'ur',
      name,
      biography: null,
    });
    if (!created.ok) throw new Error(`createPerson failed: ${created.failure}`);
    if (status === 'published') {
      const published = await harness.people.setStatus(PROOF_ACTOR, {
        personId: created.person.id,
        status: 'published',
      });
      if (!published.ok) throw new Error(`setStatus failed: ${published.failure}`);
    }
    return { id: created.person.id, slug };
  }

  async function teacherProfile(
    personId: string,
    status: 'active' | 'archived',
    subjects: string | null,
  ) {
    await harness.people.createProfile(PROOF_ACTOR, { personId, kind: 'teacher' });
    if (subjects !== null)
      await harness.people.setProfileTranslation(PROOF_ACTOR, {
        personId,
        kind: 'teacher',
        locale: 'ur',
        qualifications: null,
        expertise: null,
        biography: null,
        subjects,
      });
    await harness.people.setProfileLanguages(PROOF_ACTOR, {
      personId,
      kind: 'teacher',
      languages: ['ur'],
    });
    const set = await harness.people.setProfileStatus(PROOF_ACTOR, {
      personId,
      kind: 'teacher',
      status,
    });
    if (!set.ok) throw new Error(`setProfileStatus failed: ${set.failure}`);
  }

  it('answers only published People with an active TeacherProfile, by the accounts named', async () => {
    const listed = await createProofAccount(admin);
    const draftLinked = await createProofAccount(admin);
    const archivedLinked = await createProofAccount(admin);
    const authorOnly = await createProofAccount(admin);
    const unlinked = await createProofAccount(admin);
    const notAsked = await createProofAccount(admin);

    const teacher = await person('published', 'استاد');
    await harness.people.linkAccount(PROOF_ACTOR, {
      personId: teacher.id,
      accountId: listed,
    });
    await teacherProfile(teacher.id, 'active', 'تجوید');

    const draft = await person('draft', 'مسودہ');
    await harness.people.linkAccount(PROOF_ACTOR, {
      personId: draft.id,
      accountId: draftLinked,
    });
    await teacherProfile(draft.id, 'active', null);

    const archived = await person('published', 'سابق');
    await harness.people.linkAccount(PROOF_ACTOR, {
      personId: archived.id,
      accountId: archivedLinked,
    });
    await teacherProfile(archived.id, 'archived', null);

    const author = await person('published', 'مصنف');
    await harness.people.linkAccount(PROOF_ACTOR, {
      personId: author.id,
      accountId: authorOnly,
    });
    await harness.people.createProfile(PROOF_ACTOR, {
      personId: author.id,
      kind: 'author',
    });
    await harness.people.setProfileStatus(PROOF_ACTOR, {
      personId: author.id,
      kind: 'author',
      status: 'active',
    });

    const other = await person('published', 'دوسرا استاد');
    await harness.people.linkAccount(PROOF_ACTOR, {
      personId: other.id,
      accountId: notAsked,
    });
    await teacherProfile(other.id, 'active', null);

    const answer = await harness.people.publicTeachers(
      [listed, draftLinked, archivedLinked, authorOnly, unlinked],
      'en',
    );
    expect(answer.map((entry) => entry.accountId)).toEqual([listed]);
    const [entry] = answer;
    expect(entry).toMatchObject({
      accountId: listed,
      personId: teacher.id,
      slug: teacher.slug,
      name: 'استاد',
      nameLocale: 'ur',
      subjects: 'تجوید',
      languages: ['ur'],
      portrait: null,
    });
    // The other published teacher exists but was not asked about.
    expect(answer.some((row) => row.accountId === notAsked)).toBe(false);
    expect(await harness.people.publicTeachers([], 'en')).toEqual([]);
  });

  it('resolves the asked locale first and falls back to the primary locale', async () => {
    const accountId = await createProofAccount(admin);
    const teacher = await person('published', 'نام');
    await harness.people.linkAccount(PROOF_ACTOR, { personId: teacher.id, accountId });
    await teacherProfile(teacher.id, 'active', 'فقہ');
    await harness.people.setTranslation(PROOF_ACTOR, {
      personId: teacher.id,
      locale: 'en',
      name: 'Proof Teacher',
      biography: null,
    });
    const [english] = await harness.people.publicTeachers([accountId], 'en');
    expect(english?.name).toBe('Proof Teacher');
    expect(english?.nameLocale).toBe('en');
    expect(english?.subjects).toBe('فقہ');
    const [arabic] = await harness.people.publicTeachers([accountId], 'ar');
    expect(arabic?.name).toBe('نام');
    expect(arabic?.nameLocale).toBe('ur');
  });

  it('carries the Person’s public portrait — its asset, measured box and credit — and nothing else of the asset', async () => {
    const accountId = await createProofAccount(admin);
    const teacher = await person('published', 'تصویر');
    await harness.people.linkAccount(PROOF_ACTOR, { personId: teacher.id, accountId });
    await teacherProfile(teacher.id, 'active', null);
    const assetId = randomUUID();
    await admin.query(`
      INSERT INTO [dbo].[Asset] ([id],[storageKey],[mediaType],[byteSize],[checksum],[state],[updatedAt])
      VALUES (N'${assetId}', N'proof-portrait-${assetId}', N'image/jpeg', 10, N'${'a'.repeat(64)}', N'clean', SYSUTCDATETIME());
      UPDATE [dbo].[Person]
        SET [portraitAssetId] = N'${assetId}', [portraitWidth] = 600, [portraitHeight] = 800,
            [portraitCredit] = N'Proof credit'
        WHERE [id] = N'${teacher.id}';`);
    const [entry] = await harness.people.publicTeachers([accountId], 'en');
    expect(entry?.portrait).toEqual({
      assetId,
      width: 600,
      height: 800,
      credit: 'Proof credit',
    });
    expect(JSON.stringify(entry)).not.toContain('proof-portrait-');
  });
});
