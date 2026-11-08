import { createHash } from 'node:crypto';

import { localTimeAt } from '@minhaj/contracts/platform';
import type { ResolvedSession } from '@minhaj/contracts/identity';

import {
  composeStagingDemoRunner,
  fixturePayments,
  type StagingDemoRunner,
} from '../../apps/web/src/composition/staging-demo-runner.ts';
import {
  approvedTarget,
  argument,
  CommandError,
  required,
  runCommand,
} from '../migration/cli.ts';
import {
  DEMO_CAMPAIGN,
  DEMO_CLASSES,
  DEMO_COLLECTION,
  DEMO_COURSES,
  DEMO_DONATIONS,
  DEMO_MEMBERSHIP_TYPE,
  DEMO_NOTE,
  DEMO_NOTICE,
  DEMO_PERSON,
  DEMO_PROGRESS,
  DEMO_ROLE,
  DEMO_SUPPORT_MESSAGE,
  DEMO_TEACHING_MESSAGES,
  LIVE_DEMO_COURSE,
  type DemoCourse,
} from './content.ts';

/**
 * THE RUNTIME HALF of the staging demonstration (Rebaseline R2; owner decision
 * 2026-11-06) — run ONLY as a child of the owner-side command
 * (`packages/database/scripts/staging-demo.ts`), as the RUNTIME principal,
 * whose `DATABASE_URL` is the only database setting it holds.
 *
 *   seed   --operator <id> --student <id> --teacher <id> --member <id>
 *          --base-url <origin> --donations yes|no [--session <id>]
 *   reset  --operator <id> --student <id> --teacher <id> --member <id>
 *
 * EVERYTHING GOES THROUGH THE SERVICES, under live authority:
 *
 *   - the operator (`--operator`, a staging administrator) acts with the keys
 *     they hold — courses, classes, People, membership and campaigns — and,
 *     only when the demo teaching role or its grant is missing, through
 *     Identity's privileged gate with their live `privilege-administration`
 *     step-up on `--session`: the role is created and granted by THEM, audited,
 *     never self-granted and never seeded;
 *   - each persona acts as itself: the teacher holds and marks classes and
 *     writes to the student, the student enrols, studies, saves and asks for
 *     support, the member applies and gives.
 *
 * IDEMPOTENT: what exists is found (by the reserved slugs and titles in
 * `./content.ts`) and kept; messages replay by fixed operation ids; a second
 * run changes nothing.
 *
 * RESET retires the demo through the platform's OWN erasure path: each
 * persona is closed as Identity closes an account, then every context's
 * closed-account disposition runs — the same reconcilers the web process's
 * sweep runs — and the demo catalogue is archived. Nothing else is named, so
 * nothing else can be touched.
 *
 * The final stdout line is one JSON object of identifiers, states and counts —
 * never a password, a message body or a URL with a credential.
 */

const USAGE =
  'demo-runtime seed --operator <id> --student <id> --teacher <id> --member <id> --base-url <origin> --donations yes|no [--session <id>] | ' +
  'reset --operator <id> --student <id> --teacher <id> --member <id>';

const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/u;
const DAY = 86_400_000;

function account(flag: string): string {
  const value = required(flag, USAGE);
  if (!ACCOUNT_ID.test(value))
    throw new CommandError(`${flag} is not an account identifier`);
  return value;
}

/** A refusal from any context, as its category — never content. */
async function step<T>(label: string, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason;
    if (typeof reason === 'string') throw new CommandError(`${label}: ${reason}`);
    throw error;
  }
}

/** A refusal reason, or `null` when the work was accepted. */
async function reasonOf(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason;
    if (typeof reason === 'string') return reason;
    throw error;
  }
}

function expectOk<T extends { readonly ok: boolean }>(
  label: string,
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok)
    throw new CommandError(
      `${label}: ${String((result as { failure?: unknown }).failure ?? 'refused')}`,
    );
  return result as Extract<T, { ok: true }>;
}

interface Personas {
  readonly operator: string;
  readonly student: string;
  readonly teacher: string;
  readonly member: string;
}

/* ===========================================================================
 * Identity — the demo teaching role, by the operator, audited
 * ========================================================================= */

async function teachingGrant(
  runner: StagingDemoRunner,
  who: Personas,
  sessionId: string | undefined,
): Promise<'kept' | 'granted'> {
  const existing = await runner.identity.findRole(DEMO_ROLE.key);
  if (
    existing !== null &&
    (existing.deactivatedAt !== null ||
      existing.system ||
      [...existing.permissions].sort().join(',') !== [...DEMO_ROLE.permissions].join(','))
  )
    throw new CommandError(
      `the role '${DEMO_ROLE.key}' exists but is not the demo teaching role; nothing was changed`,
    );
  if (existing !== null) {
    const held = await runner.identity.listAssignments({
      roleId: existing.id,
      accountId: who.teacher,
      includeRevoked: false,
      limit: 1,
      offset: 0,
    });
    if (held.items.length > 0) return 'kept';
  }

  if (sessionId === undefined || !ACCOUNT_ID.test(sessionId))
    throw new CommandError(
      'the demo teaching role must be created or granted: confirm a privilege-administration step-up and pass its session',
    );
  // The gate re-reads every authority fact LIVE — the permission, the second
  // factor and a step-up grant bound to THIS session — so nothing below is
  // trusted from this object.
  const now = new Date();
  const session: ResolvedSession = {
    sessionId,
    sessionCreatedAt: now,
    sessionExpiresAt: now,
    account: {
      id: who.operator,
      email: '',
      emailVerified: true,
      name: '',
      locale: 'en',
      timezone: null,
      status: 'active',
      accountSetupCompletedAt: null,
      createdAt: now,
    },
  };
  let role = existing;
  if (role === null) {
    const actor = await runner.requireAdministrationActor(session, 'roles.administer');
    if (actor === null)
      throw new CommandError(
        'the operator does not hold roles.administer with a live privilege-administration step-up on that session',
      );
    role = expectOk(
      'demo role',
      await runner.identity.createCustomRole(actor, {
        key: DEMO_ROLE.key,
        name: DEMO_ROLE.name,
        description: DEMO_ROLE.description,
        permissions: [...DEMO_ROLE.permissions],
      }),
    ).role;
  }
  const granter = await runner.requireAdministrationActor(session, 'permissions.grant');
  if (granter === null)
    throw new CommandError(
      'the operator does not hold permissions.grant with a live privilege-administration step-up on that session',
    );
  expectOk(
    'demo role grant',
    await runner.identity.grantRole(granter, {
      accountId: who.teacher,
      roleId: role.id,
      reason: 'Staging demonstration teacher (owner decision 2026-11-06)',
    }),
  );
  return 'granted';
}

/* ===========================================================================
 * People — the demo teacher's public profile
 * ========================================================================= */

async function demoPerson(runner: StagingDemoRunner, who: Personas): Promise<string> {
  const actor = { accountId: who.operator, permission: 'people.administer' as const };
  const page = await runner.people.listPeople({
    query: DEMO_PERSON.slug,
    status: null,
    profileKind: null,
    locale: 'en',
    offset: 0,
  });
  const person = page.items.find((item) => item.slug === DEMO_PERSON.slug) ?? null;
  let personId = person?.id ?? null;
  if (personId === null) {
    personId = expectOk(
      'demo person',
      await runner.people.createPerson(actor, {
        slug: DEMO_PERSON.slug,
        primaryLocale: 'en',
        name: DEMO_PERSON.name,
        biography: DEMO_PERSON.biography,
      }),
    ).person.id;
  }
  let detail = await runner.people.findPerson({ personId, locale: 'en' });
  if (detail === null) throw new CommandError('the demo person could not be read back');
  if (detail.status !== 'published')
    detail = expectOk(
      'demo person publication',
      await runner.people.setStatus(actor, { personId, status: 'published' }),
    ).person;
  if (detail.linkedAccountId !== who.teacher)
    detail = expectOk(
      'demo person account link',
      await runner.people.linkAccount(actor, { personId, accountId: who.teacher }),
    ).person;
  // Every kind is listed; one the Person does not hold carries no id.
  const profile = detail.profiles.find((entry) => entry.kind === 'teacher');
  if (profile?.id == null)
    detail = expectOk(
      'demo teacher profile',
      await runner.people.createProfile(actor, { personId, kind: 'teacher' }),
    ).person;
  if (detail.profiles.find((entry) => entry.kind === 'teacher')?.status !== 'active')
    expectOk(
      'demo teacher profile activation',
      await runner.people.setProfileStatus(actor, {
        personId,
        kind: 'teacher',
        status: 'active',
      }),
    );
  return personId;
}

/* ===========================================================================
 * Learning — courses with a genuine short syllabus, classes, progress
 * ========================================================================= */

async function demoCourse(
  runner: StagingDemoRunner,
  who: Personas,
  course: DemoCourse,
  teacherPersonId: string,
): Promise<{ readonly id: string; readonly lessons: readonly string[] }> {
  const actor = { accountId: who.operator };
  const listed = await step(
    'course lookup',
    runner.learning.courses(actor, { text: course.slug }),
  );
  const found = listed.items.find((item) => item.slug === course.slug) ?? null;
  let detail = found === null ? null : await runner.learning.course(actor, found.id);

  if (detail === null) {
    detail = await step(
      'demo course',
      runner.learning.saveCourse(actor, null, null, {
        slug: course.slug,
        primaryLocale: 'en',
        level: course.level,
        format: course.format,
        languageCode: 'en',
        labels: [
          {
            locale: 'en',
            title: course.title,
            summary: course.summary,
            description: DEMO_NOTICE,
          },
        ],
        topicIds: [],
        teacherIds: course.format === 'live' ? [teacherPersonId] : [],
      }),
    );
    for (const module of course.modules) {
      detail = await step(
        'demo module',
        runner.learning.changeModule(actor, detail.id, detail.version, {
          op: 'add',
          labels: [{ locale: 'en', title: module.title, summary: module.summary }],
        }),
      );
      const added = detail.outline.at(-1);
      if (added === undefined) throw new CommandError('the demo module was not added');
      for (const lesson of module.lessons)
        detail = await step(
          'demo lesson',
          runner.learning.changeLesson(actor, detail.id, detail.version, {
            op: 'add',
            moduleId: added.id,
            labels: [
              { locale: 'en', title: lesson.title, summary: '', body: lesson.body },
            ],
          }),
        );
    }
  }
  if (detail.state !== 'published')
    detail = await step(
      'demo course publication',
      runner.learning.transitionCourse(actor, detail.id, detail.version, 'published'),
    );
  return {
    id: detail.id,
    lessons: detail.outline.flatMap((module) =>
      module.lessons.map((lesson) => lesson.id),
    ),
  };
}

/** A whole-hour UTC instant `dayOffset` days from today. */
function classStart(dayOffset: number, hour: number): Date {
  const instant = new Date(Date.now() + dayOffset * DAY);
  instant.setUTCHours(hour, 0, 0, 0);
  return instant;
}

async function demoClasses(
  runner: StagingDemoRunner,
  who: Personas,
  courseId: string,
): Promise<{
  readonly held: number;
  readonly upcoming: number;
  readonly created: number;
}> {
  const operator = { accountId: who.operator };
  const teacher = { accountId: who.teacher };

  const scopes = await step(
    'scope lookup',
    runner.classes.scopes(operator, { courseId, accountId: who.teacher, current: true }),
  );
  const scope =
    scopes.items[0] ??
    (await step('demo scope', runner.classes.grantScope(operator, courseId, who.teacher)))
      .scope;
  const scopeId =
    'scope' in scope ? (scope as { scope: { id: string } }).scope.id : scope.id;

  const existing = await step(
    'class lookup',
    runner.classes.sessions(operator, { courseId }),
  );
  // Only THIS teaching scope's classes: an earlier, reset generation's stay
  // where its disposition left them.
  const own = (items: typeof existing.items) =>
    items.filter(({ session }) => session.teachingScopeId === scopeId);
  let created = 0;
  if (own(existing.items).length === 0) {
    for (const plan of DEMO_CLASSES) {
      const startsAt = classStart(plan.dayOffset, plan.hour);
      const endsAt = new Date(startsAt.getTime() + plan.minutes * 60_000);
      const raw = {
        schedule: {
          timeZone: 'UTC',
          startsLocal: localTimeAt(startsAt, 'UTC'),
          endsLocal: localTimeAt(endsAt, 'UTC'),
        },
        meeting: null,
      };
      // A class that already took place is scheduled as of the day before it.
      const admin =
        plan.dayOffset < 0
          ? runner.pastClasses(() => new Date(startsAt.getTime() - DAY))
          : runner.classes;
      await step('demo class', admin.createSession(operator, scopeId, raw));
      created += 1;
    }
  }

  // Held and marked by the TEACHER, on the real clock: only classes that have
  // begun can be (F38).
  let held = 0;
  let upcoming = 0;
  const sessions = await step(
    'class lookup',
    runner.classes.sessions(operator, { courseId }),
  );
  for (const { session } of own(sessions.items)) {
    const startsAt = session.startsAt;
    if (startsAt.getTime() > Date.now()) {
      upcoming += 1;
      continue;
    }
    const plan = DEMO_CLASSES.find(
      (entry) =>
        entry.attended !== null &&
        classStart(entry.dayOffset, entry.hour).getTime() === startsAt.getTime(),
    );
    const id = session.id;
    if (plan?.attended != null)
      await step(
        'demo attendance',
        runner.teaching.markAttendance(teacher, id, who.student, plan.attended),
      );
    if (session.state === 'scheduled')
      await step(
        'demo class held',
        runner.teaching.complete(teacher, id, session.version),
      );
    held += 1;
  }
  return { held, upcoming, created };
}

/* ===========================================================================
 * Messaging
 * ========================================================================= */

async function demoMessages(
  runner: StagingDemoRunner,
  who: Personas,
  courseId: string,
): Promise<{ readonly teaching: number; readonly support: number }> {
  const actorOf = (from: 'teacher' | 'student') => ({
    accountId: from === 'teacher' ? who.teacher : who.student,
  });
  const { conversationId } = await step(
    'demo conversation',
    runner.messaging.startTeaching(actorOf('teacher'), {
      counterpartAccountId: who.student,
      courseId,
    }),
  );
  let sent = 0;
  for (const message of DEMO_TEACHING_MESSAGES) {
    const outcome = await step(
      'demo message',
      runner.messaging.send(actorOf(message.from), conversationId, {
        operationId: message.operationId,
        body: message.body,
        attachmentIds: [],
      }),
    );
    if (!outcome.replayed) sent += 1;
  }

  const support = await step(
    'demo support',
    runner.messaging.openSupport(actorOf('student')),
  );
  const asked = await step(
    'demo support message',
    runner.messaging.send(actorOf('student'), support.conversationId, {
      operationId: DEMO_SUPPORT_MESSAGE.operationId,
      body: DEMO_SUPPORT_MESSAGE.body,
      attachmentIds: [],
    }),
  );
  return { teaching: sent, support: asked.replayed ? 0 : 1 };
}

/* ===========================================================================
 * Membership
 * ========================================================================= */

async function demoMembership(
  runner: StagingDemoRunner,
  who: Personas,
): Promise<{
  readonly typeId: string;
  readonly member: string;
  readonly student: string;
}> {
  const operator = { accountId: who.operator };
  const types = await step('membership lookup', runner.membership.admin.types(operator));
  let type =
    types.find((entry) =>
      entry.labels.some(
        (label) => label.locale === 'en' && label.title === DEMO_MEMBERSHIP_TYPE.title,
      ),
    ) ?? null;
  if (type === null)
    type = await step(
      'demo membership type',
      runner.membership.admin.createType(operator, {
        primaryLocale: 'en',
        displayOrder: DEMO_MEMBERSHIP_TYPE.displayOrder,
        label: {
          locale: 'en',
          title: DEMO_MEMBERSHIP_TYPE.title,
          summary: DEMO_MEMBERSHIP_TYPE.summary,
          description: DEMO_MEMBERSHIP_TYPE.description,
          guidance: '',
        },
      }),
    );
  if (type.state !== 'published')
    type = await step(
      'demo membership publication',
      runner.membership.admin.transitionType(operator, {
        id: type.id,
        expectedVersion: type.version,
        to: 'published',
      }),
    );

  const typeId = type.id;

  /** Applies (once) and moves the application to `target` through the operator. */
  async function application(
    applicant: string,
    target: 'under_review' | 'approved',
  ): Promise<string> {
    const actor = { accountId: applicant };
    const state = await step(
      'membership state',
      runner.membership.applicant.state(actor),
    );
    if (
      state.memberships.some(
        (entry) => entry.membershipTypeId === typeId && entry.status === 'active',
      )
    )
      return 'approved';
    let current = state.applications.find((entry) => entry.membershipTypeId === typeId);
    if (
      current === undefined ||
      current.status === 'withdrawn' ||
      current.status === 'rejected'
    ) {
      await step(
        'demo application',
        runner.membership.applicant.submit(actor, { membershipTypeId: typeId }),
      );
      current = (
        await step('membership state', runner.membership.applicant.state(actor))
      ).applications.find((entry) => entry.membershipTypeId === typeId);
    }
    if (current === undefined)
      throw new CommandError('the demo application was not made');
    let version = current.version;
    if (current.status === 'submitted')
      version = (
        await step(
          'demo review',
          runner.membership.admin.startReview(operator, {
            id: current.id,
            expectedVersion: version,
          }),
        )
      ).version;
    if (target === 'approved' && current.status !== 'approved')
      await step(
        'demo decision',
        runner.membership.admin.decide(operator, {
          id: current.id,
          expectedVersion: version,
          decision: 'approve',
        }),
      );
    return target;
  }

  return {
    typeId: type.id,
    member: await application(who.member, 'approved'),
    student: await application(who.student, 'under_review'),
  };
}

/* ===========================================================================
 * Personalisation — on REAL public records
 * ========================================================================= */

async function demoPersonal(
  runner: StagingDemoRunner,
  who: Personas,
): Promise<Record<string, number>> {
  const actor = { accountId: who.student };
  const { saved, history, settings } = runner.personal;
  const works = await runner.publicChoices.works(2);
  const videos = await runner.publicChoices.videos(2);
  const articles = await runner.publicChoices.articles(1);
  const targets = [
    ...works.map((work) => ({ kind: 'work' as const, id: work.id })),
    ...videos.map((video) => ({ kind: 'video' as const, id: video.id })),
    ...articles.map((article) => ({ kind: 'article' as const, id: article.id })),
  ];

  let bookmarks = 0;
  for (const target of targets) {
    await step('demo bookmark', saved.bookmark(actor, target));
    bookmarks += 1;
  }

  let notes = 0;
  const [first] = targets;
  if (first !== undefined) {
    const reason = await reasonOf(
      saved.writeNote(actor, { target: first, body: DEMO_NOTE, expectedVersion: 0 }),
    );
    // `conflict`: the note already exists from an earlier run, and is kept.
    if (reason !== null && reason !== 'conflict')
      throw new CommandError(`demo note: ${reason}`);
    notes = 1;
  }

  const collections = await step('collection lookup', saved.collections(actor));
  let collection =
    collections.find((entry) => entry.title === DEMO_COLLECTION.title) ?? null;
  if (collection === null && targets.length > 0) {
    const { id } = await step(
      'demo collection',
      saved.createCollection(actor, {
        title: DEMO_COLLECTION.title,
        description: DEMO_COLLECTION.description,
      }),
    );
    let detail = await step('demo collection', saved.collection(actor, id));
    for (const target of targets.slice(0, 2)) {
      if (detail === null) break;
      await step(
        'demo collection item',
        saved.addToCollection(actor, {
          collectionId: id,
          target,
          expectedVersion: detail.version,
        }),
      );
      detail = await saved.collection(actor, id);
    }
    collection = detail;
  }

  const current = await step('settings', settings.settings(actor));
  if (!current.historyEnabled)
    await step(
      'demo history setting',
      settings.setHistory(actor, { enabled: true, expectedVersion: current.version }),
    );
  let read = 0;
  for (const target of targets.filter((entry) => entry.kind !== 'video')) {
    await step('demo reading history', history.recordRead(actor, target));
    read += 1;
  }
  let watched = 0;
  for (const video of videos) {
    await step('demo watch history', history.recordWatch(actor, video.id));
    watched += 1;
  }
  return {
    bookmarks,
    notes,
    collections: collection === null ? 0 : 1,
    read,
    watched,
  };
}

/**
 * A donation's operation id, fixed for one member and one planned gift — so a
 * re-run replays it — and different for the next generation's member, whose
 * gift is a new operation.
 */
function operationFor(memberId: string, plan: string): string {
  const hex = createHash('sha256')
    .update(`staging-demo:${memberId}:${plan}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/* ===========================================================================
 * Donations — the fixture provider, no money
 * ========================================================================= */

async function demoDonations(
  runner: StagingDemoRunner,
  who: Personas,
  completeCheckout: (sessionId: string) => void,
): Promise<{ readonly campaignId: string; readonly succeeded: number }> {
  const operator = { accountId: who.operator };
  const member = { accountId: who.member };
  const campaigns = await step(
    'campaign lookup',
    runner.donations.admin.campaigns(operator),
  );
  let campaign =
    campaigns.find((entry) =>
      entry.translations.some(
        (translation) =>
          translation.locale === 'en' && translation.title === DEMO_CAMPAIGN.title,
      ),
    ) ?? null;
  if (campaign === null) {
    let created = await step(
      'demo campaign',
      runner.donations.admin.createCampaign(operator, {
        primaryLocale: 'en',
        displayOrder: DEMO_CAMPAIGN.displayOrder,
      }),
    );
    created = await step(
      'demo campaign words',
      runner.donations.admin.saveTranslation(operator, {
        id: created.id,
        expectedVersion: created.version,
        translation: {
          locale: 'en',
          title: DEMO_CAMPAIGN.title,
          summary: DEMO_CAMPAIGN.summary,
          description: DEMO_CAMPAIGN.description,
        },
      }),
    );
    created = await step(
      'demo campaign currency',
      runner.donations.admin.saveCurrencyPolicy(operator, {
        id: created.id,
        expectedVersion: created.version,
        currency: DEMO_CAMPAIGN.currency,
        minimum: DEMO_CAMPAIGN.minimum,
        maximum: DEMO_CAMPAIGN.maximum,
        suggested: [...DEMO_CAMPAIGN.suggested],
      }),
    );
    campaign = created;
  }
  if (campaign.state !== 'published')
    campaign = await step(
      'demo campaign publication',
      runner.donations.admin.transitionCampaign(operator, {
        id: campaign.id,
        expectedVersion: campaign.version,
        to: 'published',
      }),
    );

  const before = await step('donation history', runner.donations.owner.history(member));
  const succeeded = () =>
    before.filter(
      (donation) =>
        donation.campaign.campaignId === campaign.id && donation.state === 'succeeded',
    ).length;
  if (succeeded() < DEMO_DONATIONS.length) {
    for (const plan of DEMO_DONATIONS.slice(succeeded())) {
      const { checkoutUrl } = await step(
        'demo donation',
        runner.donations.donor.start({
          form: {
            operationId: operationFor(who.member, plan.operationId),
            campaignId: campaign.id,
            currency: DEMO_CAMPAIGN.currency,
            amount: plan.amount,
          },
          locale: 'en',
          clientAddress: 'staging-demo-tooling',
          account: member,
          // No status page is shown to anyone: the token is discarded unread.
          issueStatusToken: () => Promise.resolve(),
        }),
      );
      const checkout = new URL(checkoutUrl).pathname.split('/').at(-1) ?? '';
      completeCheckout(checkout);
    }
    // The provider is re-read, exactly as the operator's "check with the
    // provider" does: the ledger applies only what the provider reports.
    for (const donation of await step(
      'donation history',
      runner.donations.owner.history(member),
    ))
      if (donation.campaign.campaignId === campaign.id && donation.state === 'pending') {
        const staff = await step(
          'donation read',
          runner.donations.admin.donation(operator, donation.id),
        );
        if (staff !== null)
          await step(
            'demo donation reconcile',
            runner.donations.admin.reconcile(operator, {
              id: donation.id,
              expectedVersion: staff.version,
            }),
          );
      }
  }
  const after = await step('donation history', runner.donations.owner.history(member));
  return {
    campaignId: campaign.id,
    succeeded: after.filter(
      (donation) =>
        donation.campaign.campaignId === campaign.id && donation.state === 'succeeded',
    ).length,
  };
}

/* ===========================================================================
 * seed / reset
 * ========================================================================= */

function personas(): Personas {
  return {
    operator: account('--operator'),
    student: account('--student'),
    teacher: account('--teacher'),
    member: account('--member'),
  };
}

function baseUrl(): string {
  const value = required('--base-url', USAGE);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CommandError('--base-url is not an origin');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.origin !== value || (url.protocol !== 'https:' && !loopback))
    throw new CommandError(
      '--base-url must be an https origin (or loopback for a proof)',
    );
  return value;
}

/** The part of the Stripe protocol simulator the demo uses. */
interface Simulator {
  readonly origin: string;
  readonly control: { complete(sessionId: string): string };
  close(): Promise<void>;
}

/**
 * Starts the shared simulator (`scripts/shared/stripe-simulator.mjs`, plain
 * JavaScript without declarations) on 127.0.0.1, typed by the narrow surface
 * above.
 */
async function startSimulator(): Promise<Simulator> {
  const module = (await import(
    new URL('../shared/stripe-simulator.mjs', import.meta.url).href
  )) as {
    startStripeSimulator(options: {
      readonly webhookUrl: null;
      readonly secretKey: string;
      readonly webhookSecret: string;
      readonly accountKey: string;
    }): Promise<Simulator>;
  };
  return module.startStripeSimulator({ webhookUrl: null, ...SIMULATOR });
}

/** The simulator's synthetic credentials — `fixture` shapes only, valid nowhere real. */
const SIMULATOR = Object.freeze({
  secretKey: 'sk_fixture_staging_demo_tooling',
  webhookSecret: 'whsec_fixture_staging_demo_tooling',
  accountKey: 'acct_staging_demo_fixture',
});

async function seed(): Promise<Record<string, unknown>> {
  const who = personas();
  const donations = required('--donations', USAGE);
  if (donations !== 'yes' && donations !== 'no')
    throw new CommandError(`usage: ${USAGE}`);
  const origin = baseUrl();

  const simulator = donations === 'yes' ? await startSimulator() : null;
  try {
    const runner = composeStagingDemoRunner({
      payments:
        simulator === null
          ? null
          : fixturePayments({ origin: simulator.origin, ...SIMULATOR }),
      baseUrl: origin,
    });
    const role = await teachingGrant(runner, who, argument('--session'));
    const personId = await demoPerson(runner, who);
    const courses: Record<string, { id: string; lessons: readonly string[] }> = {};
    for (const course of DEMO_COURSES)
      courses[course.slug] = await demoCourse(runner, who, course, personId);

    const student = { accountId: who.student };
    let completed = 0;
    for (const course of DEMO_COURSES) {
      const record = courses[course.slug];
      if (record === undefined) continue;
      await step('demo enrolment', runner.learner.enrol(student, record.id));
      for (const position of DEMO_PROGRESS[course.slug] ?? []) {
        const lessonId = record.lessons[position];
        if (lessonId === undefined) continue;
        await step(
          'demo progress',
          runner.learner.completeLesson(student, record.id, lessonId),
        );
        completed += 1;
      }
    }
    const liveCourse = courses[LIVE_DEMO_COURSE];
    if (liveCourse === undefined)
      throw new CommandError('the live demo course is missing');
    const classes = await demoClasses(runner, who, liveCourse.id);
    const messages = await demoMessages(runner, who, liveCourse.id);
    const membership = await demoMembership(runner, who);
    const personal = await demoPersonal(runner, who);
    const giving =
      simulator === null
        ? { skipped: 'another payment activation is in force' }
        : await demoDonations(runner, who, (id) => simulator.control.complete(id));

    return {
      mode: 'seed',
      role,
      personId,
      courses: Object.fromEntries(
        Object.entries(courses).map(([slug, record]) => [slug, record.id]),
      ),
      lessonsCompleted: completed,
      classes,
      messages,
      membership,
      personal,
      donations: giving,
    };
  } finally {
    await simulator?.close();
  }
}

async function reset(): Promise<Record<string, unknown>> {
  const who = personas();
  const runner = composeStagingDemoRunner({
    payments: null,
    baseUrl: 'https://localhost',
  });
  const operator = { accountId: who.operator };

  // 1. Each persona is closed exactly as Identity closes an account: sessions,
  //    credentials and privilege go, the address is released to a tombstone.
  let closed = 0;
  for (const accountId of [who.student, who.teacher, who.member]) {
    const reason = await reasonOf(
      runner.closeAccount({
        accountId,
        intent: {
          purpose: 'identity.account-closed',
          accountId,
          locale: 'en',
          idempotencyKey: `identity.account-closed:${accountId}:staging-demo-reset`,
        },
        audit: {
          action: 'identity.account.closed',
          actorType: 'user',
          actorId: who.operator,
          targetType: 'user',
          targetId: accountId,
          before: { status: 'active' },
          after: { status: 'closed' },
        },
      }),
    );
    if (reason === null) closed += 1;
  }

  // 2. Every context's closed-account disposition — the reconcilers the web
  //    process's personal-data sweep runs — removes or releases what each
  //    persona owned, by that context's own rules.
  const disposed = {
    people: await runner.people.reconcileClosedAccountLinks(),
    personalisation: await runner.personal.account.reconcileClosedAccounts(),
    learning: await runner.learningAccount.reconcileClosedAccounts(),
    messaging: await runner.messaging.reconcileClosedAccounts(),
    membership: await runner.membership.account.reconcileClosedAccounts(),
    donations: await runner.donations.account.reconcileClosedAccounts(),
  };

  // 3. The demo catalogue leaves publication; nothing outside it is named.
  const archived: Record<string, string> = {};
  for (const course of DEMO_COURSES) {
    const listed = await step(
      'course lookup',
      runner.learning.courses(operator, { text: course.slug }),
    );
    const found = listed.items.find((item) => item.slug === course.slug);
    if (found === undefined) continue;
    const detail = await runner.learning.course(operator, found.id);
    if (detail === null || detail.state === 'archived') {
      archived[course.slug] = detail?.state ?? 'absent';
      continue;
    }
    for (const row of (
      await step(
        'class lookup',
        runner.classes.sessions(operator, { courseId: found.id }),
      )
    ).items) {
      const { session } = row;
      if (session.state === 'scheduled')
        await step(
          'demo class cancel',
          runner.classes.cancel(operator, session.id, session.version),
        );
    }
    const latest = await runner.learning.course(operator, found.id);
    if (latest !== null)
      await step(
        'demo course archive',
        runner.learning.transitionCourse(operator, latest.id, latest.version, 'archived'),
      );
    archived[course.slug] = 'archived';
  }

  const types = await step('membership lookup', runner.membership.admin.types(operator));
  const type = types.find((entry) =>
    entry.labels.some(
      (label) => label.locale === 'en' && label.title === DEMO_MEMBERSHIP_TYPE.title,
    ),
  );
  if (type !== undefined && type.state === 'published')
    await step(
      'demo membership archive',
      runner.membership.admin.transitionType(operator, {
        id: type.id,
        expectedVersion: type.version,
        to: 'archived',
      }),
    );

  const campaigns = await step(
    'campaign lookup',
    runner.donations.admin.campaigns(operator),
  );
  const campaign = campaigns.find((entry) =>
    entry.translations.some(
      (translation) =>
        translation.locale === 'en' && translation.title === DEMO_CAMPAIGN.title,
    ),
  );
  if (campaign !== undefined && campaign.state === 'published')
    await step(
      'demo campaign archive',
      runner.donations.admin.transitionCampaign(operator, {
        id: campaign.id,
        expectedVersion: campaign.version,
        to: 'archived',
      }),
    );

  const people = await runner.people.listPeople({
    query: DEMO_PERSON.slug,
    status: null,
    profileKind: null,
    locale: 'en',
    offset: 0,
  });
  const person = people.items.find((item) => item.slug === DEMO_PERSON.slug);
  if (person !== undefined && person.status !== 'archived')
    expectOk(
      'demo person archive',
      await runner.people.setStatus(
        { accountId: who.operator, permission: 'people.administer' },
        { personId: person.id, status: 'archived' },
      ),
    );

  return {
    mode: 'reset',
    closed,
    disposed,
    courses: archived,
    membershipType: type === undefined ? 'absent' : 'archived',
    campaign: campaign === undefined ? 'absent' : 'archived',
    person: person === undefined ? 'absent' : 'archived',
  };
}

await runCommand('demo:runtime', async () => {
  const [mode] = process.argv.slice(2);
  approvedTarget(process.env['DATABASE_URL']);
  if (mode === 'seed') return seed();
  if (mode === 'reset') return reset();
  throw new CommandError(`usage: ${USAGE}`);
});
