import 'server-only';

import { hashPassword, verifyPassword } from 'better-auth/crypto';

import { assertMigrationProofDatabase } from './migration-proof-operator.ts';
import type { SqlSession } from './sql-connection.ts';
import { assertDeclaredStagingPosture, liveStepUpSessionIds } from './staging-step-up.ts';

/**
 * THE OWNER SIDE of the staging demonstration data (Rebaseline R2; owner
 * decision 2026-11-06, OPEN_DECISIONS.md §4.2).
 *
 * ## What it is
 *
 * ENVIRONMENT DATA, run by an operator on the pre-adoption staging database
 * only — never an application mode, flag or branch. The application has no
 * idea demo data exists: the personas are ordinary accounts, their classes,
 * messages, memberships and donations ordinary records made through the
 * ordinary services (`scripts/demo/demo-runtime.ts`).
 *
 * ## What this module writes, as the OWNER, and why only this
 *
 *   - The three SYNTHETIC PERSONAS, in Identity's own row shape (the Phase-29
 *     migration-proof precedent): an active account on the reserved
 *     `@demo.minhaj.invalid` domain with its address already proved — no
 *     mail is ever sent to prove it, and the transport refuses `.invalid`
 *     recipients outright — and a password credential hashed by the
 *     authentication library's own `hashPassword`, so the ordinary sign-in
 *     verifies it. Passwords arrive from the operator's root-only file on
 *     standard input; they are never printed, logged or returned.
 *   - The ACTIVATIONS the owner alone may write, with authority `fixture`:
 *     live learning, Messaging's `support` and `teacher-student` capabilities
 *     (never `student-student`), and Donations' fixture environment for the
 *     demo account key. Each is written only when absent and is immutable by
 *     trigger: a staging database that holds them keeps them until it is reset.
 *
 * Nothing else. Privilege (the demo teaching role and its grant) goes through
 * Identity's audited administration under an operator's live step-up, in the
 * runtime child.
 *
 * ## Where it may run
 *
 * On `MinhajStaging` or a disposable `MinhajPhase1Test_<32 hex>` database,
 * proven from the CONNECTED database's own name, after the caller's staging
 * guard AND `assertDemoPosture` — a deployment that declares itself anything
 * but staging, or indexable, is refused before a connection opens.
 *
 * Everything this module returns is identifiers, states and counts.
 */

/** The owner decision every activation and persona names. */
export const DEMO_DECISION = 'OWNER-DECISION-2026-11-06-R2-STAGING-DEMO';

/**
 * The demo teaching role's key and the demo courses' slugs — what status reads
 * by. The runtime's content (`scripts/demo/content.ts`) names the same; a
 * test holds the two equal.
 */
export const DEMO_ROLE_KEY = 'staging-demo-teacher';
export const DEMO_COURSE_SLUGS = Object.freeze([
  'staging-demo-quranic-arabic',
  'staging-demo-study-skills',
] as const);

/** The reserved address domain every persona sits on (RFC 2606 `.invalid`). */
export const DEMO_EMAIL_DOMAIN = 'demo.minhaj.invalid';

/** The non-secret merchant label the demo's fixture payments are scoped by. */
export const DEMO_PAYMENT_ACCOUNT = 'acct_staging_demo_fixture';

export const DEMO_PERSONA_KEYS = Object.freeze(['student', 'teacher', 'member'] as const);
export type DemoPersonaKey = (typeof DEMO_PERSONA_KEYS)[number];

export interface DemoPersona {
  readonly key: DemoPersonaKey;
  /** The account id stem; a generation number follows it (`-1`, `-2`, …). */
  readonly idStem: string;
  /** A fictional name, its demo role stated in it. Never a real person's. */
  readonly name: string;
  /** The surname-free form checked against the People directory. */
  readonly plainName: string;
  readonly email: string;
}

export const DEMO_PERSONAS: Readonly<Record<DemoPersonaKey, DemoPersona>> = Object.freeze(
  {
    student: {
      key: 'student',
      idStem: 'staging-demo-student',
      name: 'Amina Example (demo student)',
      plainName: 'Amina Example',
      email: `amina.student@${DEMO_EMAIL_DOMAIN}`,
    },
    teacher: {
      key: 'teacher',
      idStem: 'staging-demo-teacher',
      name: 'Yusuf Example (demo teacher)',
      plainName: 'Yusuf Example',
      email: `yusuf.teacher@${DEMO_EMAIL_DOMAIN}`,
    },
    member: {
      key: 'member',
      idStem: 'staging-demo-member',
      name: 'Bilal Example (demo member)',
      plainName: 'Bilal Example',
      email: `bilal.member@${DEMO_EMAIL_DOMAIN}`,
    },
  },
);

/** A persona password as the host script generates it: CSPRNG output, URL-safe. */
const PASSWORD = /^[A-Za-z0-9_-]{24,128}$/u;
const ACCOUNT = /^[A-Za-z0-9_-]{8,36}$/u;

/** A SQL Server Unicode literal. Values are this module's constants or checked identifiers. */
const n = (value: string) => `N'${value.replaceAll("'", "''")}'`;

/** A refusal whose message names no value — safe to print as the command's error. */
export class DemoRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoRefusal';
  }
}

/* ===========================================================================
 * The deployment posture
 * ========================================================================= */

/**
 * Refuses unless the process declares EXACTLY the staging deployment and an
 * explicitly non-indexable build. Absence is a refusal, never a default: a
 * production or indexable deployment can never run the demo, whatever its
 * database is called.
 */
export function assertDemoPosture(values: Record<string, string | undefined>): void {
  assertDeclaredStagingPosture(
    values,
    'Demo data',
    (message) => new DemoRefusal(message),
  );
}

async function assertConnectedDatabase(sql: SqlSession): Promise<void> {
  const rows = await sql.query<{ name: string | null }>('SELECT DB_NAME() AS [name];');
  const name = rows.length === 1 ? rows[0]?.name : null;
  if (typeof name !== 'string')
    throw new DemoRefusal('The connected database could not be identified; refusing.');
  assertMigrationProofDatabase(name);
}

/* ===========================================================================
 * Credentials — from standard input, never echoed
 * ========================================================================= */

export type DemoPasswords = Readonly<Record<DemoPersonaKey, string>>;

/**
 * Reads `<persona><TAB or space><email><TAB or space><password>` lines (the
 * root-only file the host script keeps); `#` lines and blank lines are
 * ignored. EXACTLY one line per persona, the persona's own address, and a
 * password of the generated shape — anything else is refused without the
 * offending value in the message.
 */
export function parseDemoCredentials(text: string): DemoPasswords {
  const found = new Map<DemoPersonaKey, string>();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [key, email, password, ...rest] = line.split(/\s+/u);
    const persona = DEMO_PERSONA_KEYS.find((candidate) => candidate === key);
    if (persona === undefined || rest.length > 0)
      throw new DemoRefusal('The demo credentials hold an unrecognised line.');
    if (email !== DEMO_PERSONAS[persona].email)
      throw new DemoRefusal(
        `The demo credentials name the wrong address for ${persona}.`,
      );
    if (password === undefined || !PASSWORD.test(password))
      throw new DemoRefusal(`The ${persona} password is not of the generated shape.`);
    if (found.has(persona))
      throw new DemoRefusal(`The demo credentials name ${persona} twice.`);
    found.set(persona, password);
  }
  const missing = DEMO_PERSONA_KEYS.filter((key) => !found.has(key));
  if (missing.length > 0)
    throw new DemoRefusal(`The demo credentials lack ${missing.join(', ')}.`);
  return Object.freeze(Object.fromEntries(found) as Record<DemoPersonaKey, string>);
}

/* ===========================================================================
 * Personas
 * ========================================================================= */

export type DemoAccounts = Readonly<Record<DemoPersonaKey, string>>;

interface UserRow {
  readonly id: string;
  readonly status: string;
}

/** The LIVE (not closed) persona accounts, or `null` for a persona with none. */
export async function livePersonas(
  sql: SqlSession,
): Promise<Readonly<Record<DemoPersonaKey, string | null>>> {
  await assertConnectedDatabase(sql);
  const out: Partial<Record<DemoPersonaKey, string | null>> = {};
  for (const key of DEMO_PERSONA_KEYS) {
    const persona = DEMO_PERSONAS[key];
    const rows = await sql.query<UserRow>(
      `SELECT [id], [status] FROM [dbo].[User] WHERE [email] = ${n(persona.email)} AND [status] <> N'closed';`,
    );
    const [row] = rows;
    if (
      rows.length > 1 ||
      (row !== undefined && !row.id.startsWith(`${persona.idStem}-`))
    )
      throw new DemoRefusal(
        `The ${key} demo address is held by an account this tooling did not create; refusing.`,
      );
    out[key] = row?.id ?? null;
  }
  return out as Record<DemoPersonaKey, string | null>;
}

/**
 * Refuses when a persona's plain name is a name in the People directory: a
 * demo account must never be mistaken for, or attributed as, a real person.
 * The demo teacher's own Person (`staging-demo-…`) is the one exception.
 */
export async function assertNoNameCollision(sql: SqlSession): Promise<void> {
  const names = DEMO_PERSONA_KEYS.map((key) =>
    n(DEMO_PERSONAS[key].plainName.toLowerCase()),
  );
  const rows = await sql.query<{ total: number | string }>(`
    SELECT COUNT_BIG(*) AS [total]
    FROM [dbo].[PersonTranslation] t
    JOIN [dbo].[Person] p ON p.[id] = t.[personId]
    WHERE p.[slug] NOT LIKE N'staging-demo-%'
      AND (LOWER(LTRIM(RTRIM(t.[name]))) IN (${names.join(', ')})
        OR ${DEMO_PERSONA_KEYS.map((key) => `LOWER(t.[name]) LIKE ${n(`%${DEMO_PERSONAS[key].plainName.toLowerCase()}%`)}`).join(' OR ')});
  `);
  if (Number(rows[0]?.total ?? 0) > 0)
    throw new DemoRefusal(
      'A persona name matches a name in the People directory; refusing to create a look-alike.',
    );
}

/** The next unused generation for a persona's id: closed generations are never reopened. */
async function nextGeneration(sql: SqlSession, persona: DemoPersona): Promise<number> {
  const rows = await sql.query<{ id: string }>(
    `SELECT [id] FROM [dbo].[User] WHERE [id] LIKE ${n(`${persona.idStem}-%`)};`,
  );
  let highest = 0;
  for (const { id } of rows) {
    const suffix = Number(id.slice(persona.idStem.length + 1));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return highest + 1;
}

export interface PersonaOutcome {
  readonly accountId: string;
  /** `created` now; `kept` as it was; `credential-replaced` from a rotated file. */
  readonly state: 'created' | 'kept' | 'credential-replaced';
}

/**
 * Creates each persona that has no live account, or keeps the live one —
 * replacing its credential only when the operator's file no longer verifies
 * against it. Idempotent: a second run with the same file changes nothing.
 */
export async function ensurePersonas(
  sql: SqlSession,
  passwords: DemoPasswords,
): Promise<Readonly<Record<DemoPersonaKey, PersonaOutcome>>> {
  await assertConnectedDatabase(sql);
  await assertNoNameCollision(sql);
  const live = await livePersonas(sql);
  const out: Partial<Record<DemoPersonaKey, PersonaOutcome>> = {};

  for (const key of DEMO_PERSONA_KEYS) {
    const persona = DEMO_PERSONAS[key];
    const password = passwords[key];
    const existing = live[key];

    if (existing !== null) {
      const [credential] = await sql.query<{ password: string | null }>(
        `SELECT [password] FROM [dbo].[Account] WHERE [userId] = ${n(existing)} AND [providerId] = N'credential';`,
      );
      const current =
        typeof credential?.password === 'string' &&
        (await verifyPassword({ hash: credential.password, password }));
      if (current) {
        out[key] = { accountId: existing, state: 'kept' };
        continue;
      }
      const hash = await hashPassword(password);
      await sql.query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DELETE FROM [dbo].[Account] WHERE [userId] = ${n(existing)} AND [providerId] = N'credential';
        INSERT INTO [dbo].[Account] ([id],[accountId],[providerId],[userId],[password],[createdAt],[updatedAt])
          VALUES (${n(`${existing}-credential`)}, ${n(existing)}, N'credential', ${n(existing)}, ${n(hash)}, SYSUTCDATETIME(), SYSUTCDATETIME());
        DELETE FROM [dbo].[Session] WHERE [userId] = ${n(existing)};
        COMMIT TRANSACTION;
      `);
      out[key] = { accountId: existing, state: 'credential-replaced' };
      continue;
    }

    const accountId = `${persona.idStem}-${String(await nextGeneration(sql, persona))}`;
    if (!ACCOUNT.test(accountId))
      throw new DemoRefusal('A persona id outgrew its shape.');
    const hash = await hashPassword(password);
    await sql.query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      INSERT INTO [dbo].[User]
        ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[timezone],[status],[accountSetupCompletedAt],[twoFactorEnabled])
      VALUES
        (${n(accountId)}, ${n(persona.name)}, ${n(persona.email)}, 1, SYSUTCDATETIME(), SYSUTCDATETIME(),
         N'en', N'UTC', N'active', SYSUTCDATETIME(), 0);
      INSERT INTO [dbo].[Account] ([id],[accountId],[providerId],[userId],[password],[createdAt],[updatedAt])
        VALUES (${n(`${accountId}-credential`)}, ${n(accountId)}, N'credential', ${n(accountId)}, ${n(hash)}, SYSUTCDATETIME(), SYSUTCDATETIME());
      COMMIT TRANSACTION;
    `);
    out[key] = { accountId, state: 'created' };
  }
  return out as Record<DemoPersonaKey, PersonaOutcome>;
}

/* ===========================================================================
 * Activations — owner-written, `fixture`, immutable
 * ========================================================================= */

export type ActivationOutcome = 'written' | 'present' | 'other-scope';

export interface DemoActivations {
  readonly liveLearning: ActivationOutcome;
  readonly support: ActivationOutcome;
  readonly teacherStudent: ActivationOutcome;
  /** `other-scope`: another payment activation is in force; the demo makes no donations. */
  readonly donations: ActivationOutcome;
}

/**
 * Writes each activation the demo needs that is ABSENT, with authority
 * `fixture` and the decision and operator named. One already present — of
 * either authority — is kept: it is immutable, and an approved one is
 * stronger than the demo needs. Never `student-student`.
 */
export async function ensureActivations(
  sql: SqlSession,
  operator: string,
): Promise<DemoActivations> {
  await assertConnectedDatabase(sql);
  if (!ACCOUNT.test(operator))
    throw new DemoRefusal('The operator must be an account identifier.');
  const by = n(`${DEMO_DECISION}; operator ${operator}`);
  const [row] = await sql.query<{
    live: number | string;
    support: number | string;
    teaching: number | string;
    donation: number | string;
    donationMatches: number | string;
  }>(`
    SELECT
      (SELECT COUNT_BIG(*) FROM [dbo].[LiveLearningActivation]) AS [live],
      (SELECT COUNT_BIG(*) FROM [dbo].[MessagingActivation] WHERE [capability] = N'support') AS [support],
      (SELECT COUNT_BIG(*) FROM [dbo].[MessagingActivation] WHERE [capability] = N'teacher-student') AS [teaching],
      (SELECT COUNT_BIG(*) FROM [dbo].[DonationActivation]) AS [donation],
      (SELECT COUNT_BIG(*) FROM [dbo].[DonationActivation]
        WHERE [provider] = N'stripe' AND [environment] = N'fixture'
          AND [accountKey] = ${n(DEMO_PAYMENT_ACCOUNT)} AND [authority] = N'fixture') AS [donationMatches];
  `);
  if (row === undefined) throw new DemoRefusal('The activations could not be read.');

  const liveLearning: ActivationOutcome = Number(row.live) > 0 ? 'present' : 'written';
  if (liveLearning === 'written')
    await sql.query(
      `INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference]) VALUES (1, N'fixture', ${by}, NULL);`,
    );
  const support: ActivationOutcome = Number(row.support) > 0 ? 'present' : 'written';
  if (support === 'written')
    await sql.query(
      `INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference]) VALUES (N'support', N'fixture', ${by}, NULL);`,
    );
  const teacherStudent: ActivationOutcome =
    Number(row.teaching) > 0 ? 'present' : 'written';
  if (teacherStudent === 'written')
    await sql.query(
      `INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference]) VALUES (N'teacher-student', N'fixture', ${by}, NULL);`,
    );
  const donations: ActivationOutcome =
    Number(row.donationMatches) > 0
      ? 'present'
      : Number(row.donation) > 0
        ? 'other-scope'
        : 'written';
  if (donations === 'written')
    await sql.query(`
      INSERT INTO [dbo].[DonationActivation] ([id],[provider],[environment],[accountKey],[authority],[authorisedBy])
      VALUES (1, N'stripe', N'fixture', ${n(DEMO_PAYMENT_ACCOUNT)}, N'fixture', ${by});
    `);
  return { liveLearning, support, teacherStudent, donations };
}

/* ===========================================================================
 * The operator's live step-up — read, never created
 * ========================================================================= */

/**
 * The ONE live session of `operator` holding an unexpired step-up grant for
 * `purpose` — the grant the operator just earned on the admin screen — or a
 * refusal. A READ: the runtime child re-verifies permission, posture and
 * grant through Identity before anything privileged happens.
 */
export async function liveStepUpSession(
  sql: SqlSession,
  operator: string,
  purpose: 'privilege-administration',
): Promise<string> {
  if (!ACCOUNT.test(operator))
    throw new DemoRefusal('The operator must be an account identifier.');
  const sessions = await liveStepUpSessionIds(sql, operator, purpose);
  const [only] = sessions;
  if (only === undefined || sessions.length !== 1)
    throw new DemoRefusal(
      sessions.length === 0
        ? `The operator holds no live ${purpose} step-up; confirm it on the admin roles screen first.`
        : `The operator holds live ${purpose} step-ups on several sessions; name one with --session.`,
    );
  return only;
}

/* ===========================================================================
 * Status
 * ========================================================================= */

export interface DemoStatus {
  readonly personas: Readonly<Record<DemoPersonaKey, string | null>>;
  readonly retiredPersonas: number;
  readonly teachingRole: 'absent' | 'present';
  readonly teachingGrant: 'absent' | 'live';
  readonly activations: Readonly<Record<string, string | null>>;
  readonly courses: Readonly<Record<string, string>>;
  readonly records: Readonly<Record<string, number>>;
}

/** The demo's footprint, read-only: identifiers, states and counts. */
export async function inspectDemo(
  sql: SqlSession,
  input: { readonly roleKey: string; readonly courseSlugs: readonly string[] },
): Promise<DemoStatus> {
  await assertConnectedDatabase(sql);
  const personas = await livePersonas(sql);
  const live = DEMO_PERSONA_KEYS.map((key) => personas[key]).filter(
    (id): id is string => id !== null,
  );
  const ids = live.length === 0 ? `N''` : live.map(n).join(', ');
  const count = async (statement: string): Promise<number> =>
    Number((await sql.query<{ total: number | string }>(statement))[0]?.total ?? 0);

  const retiredPersonas = await count(
    `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[User] WHERE [status] = N'closed' AND (${DEMO_PERSONA_KEYS.map((key) => `[id] LIKE ${n(`${DEMO_PERSONAS[key].idStem}-%`)}`).join(' OR ')});`,
  );
  const teachingRole =
    (await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[Role] WHERE [key] = ${n(input.roleKey)} AND [deactivatedAt] IS NULL;`,
    )) > 0
      ? 'present'
      : 'absent';
  const teachingGrant =
    personas.teacher !== null &&
    (await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[RoleAssignment] a JOIN [dbo].[Role] r ON r.[id] = a.[roleId]
       WHERE r.[key] = ${n(input.roleKey)} AND a.[userId] = ${n(personas.teacher)} AND a.[revokedAt] IS NULL;`,
    )) > 0
      ? 'live'
      : 'absent';

  const [activation] = await sql.query<Record<string, string | null>>(`
    SELECT
      (SELECT [authority] FROM [dbo].[LiveLearningActivation] WHERE [id] = 1) AS [liveLearning],
      (SELECT [authority] FROM [dbo].[MessagingActivation] WHERE [capability] = N'support') AS [support],
      (SELECT [authority] FROM [dbo].[MessagingActivation] WHERE [capability] = N'teacher-student') AS [teacherStudent],
      (SELECT [authority] FROM [dbo].[MessagingActivation] WHERE [capability] = N'student-student') AS [studentStudent],
      (SELECT [environment] FROM [dbo].[DonationActivation] WHERE [id] = 1) AS [donations];
  `);

  const courses: Record<string, string> = {};
  for (const slug of input.courseSlugs) {
    const [course] = await sql.query<{ state: string }>(
      `SELECT [state] FROM [dbo].[Course] WHERE [slug] = ${n(slug)};`,
    );
    courses[slug] = course?.state ?? 'absent';
  }

  const records: Record<string, number> = {
    enrolments: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[Enrolment] WHERE [userId] IN (${ids});`,
    ),
    lessonsCompleted: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[LessonProgress] WHERE [userId] IN (${ids});`,
    ),
    attendance: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[Attendance] WHERE [userId] IN (${ids});`,
    ),
    conversations: await count(
      `SELECT COUNT_BIG(DISTINCT [conversationId]) AS [total] FROM [dbo].[ConversationParticipant] WHERE [userId] IN (${ids});`,
    ),
    membershipApplications: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[MembershipApplication] WHERE [applicantUserId] IN (${ids});`,
    ),
    donations: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[Donation] WHERE [donorUserId] IN (${ids});`,
    ),
    savedItems: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[SavedItem] WHERE [userId] IN (${ids});`,
    ),
    privateCollections: await count(
      `SELECT COUNT_BIG(*) AS [total] FROM [dbo].[PrivateCollection] WHERE [userId] IN (${ids});`,
    ),
  };

  return {
    personas,
    retiredPersonas,
    teachingRole,
    teachingGrant,
    activations: activation ?? {},
    courses,
    records,
  };
}
