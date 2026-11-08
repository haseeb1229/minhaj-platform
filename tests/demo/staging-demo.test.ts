import { describe, expect, it } from 'vitest';

import {
  assertDemoPosture,
  DEMO_COURSE_SLUGS,
  DEMO_EMAIL_DOMAIN,
  DEMO_PERSONA_KEYS,
  DEMO_PERSONAS,
  DEMO_ROLE_KEY,
  parseDemoCredentials,
} from '../../packages/database/src/lifecycle/staging-demo.ts';
import {
  DEMO_CAMPAIGN,
  DEMO_COURSES,
  DEMO_MEMBERSHIP_TYPE,
  DEMO_PERSON,
  DEMO_ROLE,
  DEMO_SUPPORT_MESSAGE,
  DEMO_TEACHING_MESSAGES,
} from '../../scripts/demo/content.ts';
import { isUndeliverableRecipient } from '../../packages/database/src/adapters/email/provider.ts';

/**
 * Rebaseline R2 — the staging demo's guards, without a database: who may run
 * it, how its passwords are read, and that every word it writes says it is a
 * demonstration. The database half is `./staging-demo.integration.test.ts`.
 */

/** Synthetic sentinels of the generated shape — not credentials anywhere. */
const SENTINEL = {
  student: 'SENTINELstudentAAAAAAAAAAAAAAAAA',
  teacher: 'SENTINELteacherBBBBBBBBBBBBBBBBB',
  member: 'SENTINELmemberCCCCCCCCCCCCCCCCCC',
} as const;

const file = (lines: readonly string[]) => lines.join('\n');
const valid = () =>
  DEMO_PERSONA_KEYS.map((key) => `${key} ${DEMO_PERSONAS[key].email} ${SENTINEL[key]}`);

function refusal(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'accepted';
}

describe('the deployment posture', () => {
  it('admits exactly the declared, non-indexable staging deployment', () => {
    expect(() =>
      assertDemoPosture({
        MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
        PUBLIC_INDEXING_ENABLED: 'false',
      }),
    ).not.toThrow();
  });

  it.each([
    [{ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'production', PUBLIC_INDEXING_ENABLED: 'false' }],
    [{ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'Staging', PUBLIC_INDEXING_ENABLED: 'false' }],
    [{ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging ', PUBLIC_INDEXING_ENABLED: 'false' }],
    [{ PUBLIC_INDEXING_ENABLED: 'false' }],
    [{ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging', PUBLIC_INDEXING_ENABLED: 'true' }],
    // Absent is not "false": indexing must be stated off, never assumed.
    [{ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging' }],
    [{ MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging', PUBLIC_INDEXING_ENABLED: 'FALSE' }],
  ])('refuses %j', (values) => {
    expect(() => assertDemoPosture(values)).toThrow(/staging|non-indexable/u);
  });
});

describe('the credentials on standard input', () => {
  it('reads one generated password per persona, ignoring comments and blank lines', () => {
    const passwords = parseDemoCredentials(file(['# header', '', ...valid(), '']));
    expect(passwords).toEqual(SENTINEL);
  });

  it.each([
    ['a missing persona', valid().slice(0, 2)],
    ['a persona named twice', [...valid(), valid()[0] ?? '']],
    [
      'an unknown persona',
      [...valid(), `admin x@${DEMO_EMAIL_DOMAIN} ${SENTINEL.member}`],
    ],
    [
      'a wrong address',
      [`student someone@example.org ${SENTINEL.student}`, ...valid().slice(1)],
    ],
    [
      'a short password',
      [`student ${DEMO_PERSONAS.student.email} short`, ...valid().slice(1)],
    ],
    [
      'a password with other characters',
      [
        `student ${DEMO_PERSONAS.student.email} ${SENTINEL.student}!`,
        ...valid().slice(1),
      ],
    ],
    ['a trailing field', [`${valid()[0] ?? ''} extra`, ...valid().slice(1)]],
  ])('refuses %s — without echoing any password', (_label, lines) => {
    const message = refusal(() => parseDemoCredentials(file(lines)));
    expect(message).not.toBe('accepted');
    for (const secret of Object.values(SENTINEL)) expect(message).not.toContain(secret);
    expect(message).not.toContain('short');
  });
});

describe('the personas and the words', () => {
  it('are synthetic: fictional names stating their demo role, on the reserved .invalid domain', () => {
    for (const key of DEMO_PERSONA_KEYS) {
      const persona = DEMO_PERSONAS[key];
      expect(persona.name).toContain('Example');
      expect(persona.name).toContain(`(demo ${key})`);
      expect(persona.name.startsWith(persona.plainName)).toBe(true);
      expect(persona.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
      // The mail transport refuses every one of them before the provider.
      expect(isUndeliverableRecipient(persona.email)).toBe(true);
      expect(persona.idStem).toMatch(/^staging-demo-/u);
    }
    expect(DEMO_PERSON.name).toBe(DEMO_PERSONAS.teacher.name);
    expect(DEMO_PERSON.biography).toContain('Not a real person');
  });

  it('say what they are: every title is marked demo, every description disclaims authority', () => {
    for (const course of DEMO_COURSES) {
      expect(course.title).toMatch(/^Demo course — .*\(staging sample\)$/u);
      for (const module of course.modules) {
        expect(module.title).toMatch(/^Demo module/u);
        for (const lesson of module.lessons)
          expect(lesson.title).toMatch(/^Demo lesson/u);
      }
    }
    expect(DEMO_MEMBERSHIP_TYPE.title).toBe('Demo membership (staging)');
    expect(DEMO_MEMBERSHIP_TYPE.description).toContain('no religious authority');
    expect(DEMO_CAMPAIGN.title).toBe('Demo campaign (staging test — no money moves)');
    expect(DEMO_CAMPAIGN.description).toContain('no money moves');
    for (const message of [...DEMO_TEACHING_MESSAGES, DEMO_SUPPORT_MESSAGE])
      expect(message.body).toContain('(Staging sample conversation.)');
  });

  it('agree with what the owner side reads status by', () => {
    expect(DEMO_ROLE.key).toBe(DEMO_ROLE_KEY);
    expect(DEMO_ROLE.permissions).toEqual(['teaching.perform']);
    expect(DEMO_COURSES.map((course) => course.slug)).toEqual([...DEMO_COURSE_SLUGS]);
  });
});
