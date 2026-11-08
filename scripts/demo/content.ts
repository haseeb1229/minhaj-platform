/**
 * THE WORDS of the staging demonstration (Rebaseline R2; owner decision
 * 2026-11-06, OPEN_DECISIONS.md §4.2).
 *
 * EVERY WORD SAYS WHAT IT IS. Each title carries "demo" or "staging"; each
 * description states that it is a sample for the staging demonstration, is
 * not a Minhaj-ul-Quran offer and carries no religious authority. Nothing
 * here quotes scripture, gives a ruling, names a real scholar or describes a
 * real person. The lessons teach study habits and the shapes of letters —
 * nothing a reader could take as religious guidance.
 *
 * Identifiers that make a re-run idempotent live here too: the slugs, role
 * key and reserved titles by which the tooling finds what it made, and the
 * fixed operation ids that make a message a replay rather than a duplicate.
 */

export const DEMO_ROLE = Object.freeze({
  key: 'staging-demo-teacher',
  name: 'Staging demo teacher',
  description:
    'Holds teaching.perform for the synthetic demo teacher on the pre-adoption staging environment only (owner decision 2026-11-06).',
  permissions: ['teaching.perform'] as const,
});

export const DEMO_NOTICE =
  'This is sample content for the One Minhaj staging demonstration. It is not a Minhaj-ul-Quran International course or offer, and it carries no religious authority.';

export const DEMO_PERSON = Object.freeze({
  slug: 'staging-demo-yusuf-example',
  name: 'Yusuf Example (demo teacher)',
  biography: `A fictional teacher created for the staging demonstration. Not a real person. ${DEMO_NOTICE}`,
});

export interface DemoLesson {
  readonly title: string;
  readonly body: string;
}

export interface DemoModule {
  readonly title: string;
  readonly summary: string;
  readonly lessons: readonly DemoLesson[];
}

export interface DemoCourse {
  readonly slug: string;
  readonly format: 'live' | 'self-paced';
  readonly level: 'beginner' | 'intermediate';
  readonly title: string;
  readonly summary: string;
  readonly modules: readonly DemoModule[];
}

export const DEMO_COURSES: readonly DemoCourse[] = Object.freeze([
  {
    slug: 'staging-demo-quranic-arabic',
    format: 'live',
    level: 'beginner',
    title: 'Demo course — Introduction to Quranic Arabic (staging sample)',
    summary:
      'A short sample course with live demo classes, used to show the learning journey on staging.',
    modules: [
      {
        title: 'Demo module 1 — The Arabic letters',
        summary: 'Sample lessons on recognising letter shapes.',
        lessons: [
          {
            title: 'Demo lesson — Letters and their shapes',
            body: 'Arabic is written from right to left, and most letters change shape slightly depending on whether they stand alone or join a neighbour. In this sample lesson, practise writing each letter on its own, then joined at the start, middle and end of a word.',
          },
          {
            title: 'Demo lesson — Letters that share a shape',
            body: 'Several letters share one basic shape and differ only in their dots. In this sample lesson, group the letters by shape and say each one aloud as you point to its dots.',
          },
        ],
      },
      {
        title: 'Demo module 2 — Short vowels',
        summary: 'Sample lessons on the three short vowel marks.',
        lessons: [
          {
            title: 'Demo lesson — The three short vowels',
            body: 'Short vowels are written as small marks above or below a letter. In this sample lesson, read a row of letters with each of the three marks and listen for the change in sound.',
          },
          {
            title: 'Demo lesson — Reading syllables',
            body: 'Put letters and vowels together to read short syllables. Read slowly, then repeat at a natural pace. This sample lesson ends with a five-minute practice.',
          },
        ],
      },
    ],
  },
  {
    slug: 'staging-demo-study-skills',
    format: 'self-paced',
    level: 'beginner',
    title: 'Demo course — Study skills for online learning (staging sample)',
    summary: 'A self-paced sample course used to show lesson progress on staging.',
    modules: [
      {
        title: 'Demo module 1 — Planning your study',
        summary: 'Sample lessons on setting a routine.',
        lessons: [
          {
            title: 'Demo lesson — Setting a weekly routine',
            body: 'Choose two or three fixed times each week and protect them. In this sample lesson, write your routine down and place it where you will see it.',
          },
          {
            title: 'Demo lesson — Keeping notes you will reread',
            body: 'Short notes in your own words are easier to review than copied paragraphs. In this sample lesson, summarise a page in three sentences.',
          },
        ],
      },
    ],
  },
]);

/** The course that runs live demo classes. */
export const LIVE_DEMO_COURSE = 'staging-demo-quranic-arabic';

/**
 * The demo classes, in whole days and hours UTC from the run: two that took
 * place (held, attendance recorded) and two to come. The meeting address is
 * deliberately left unset — a Google Meet address cannot be made obviously
 * synthetic, and a real-looking one could be somebody's meeting.
 */
export const DEMO_CLASSES = Object.freeze([
  { dayOffset: -7, hour: 16, minutes: 60, attended: 'present' as const },
  { dayOffset: -3, hour: 16, minutes: 60, attended: 'absent' as const },
  { dayOffset: 2, hour: 16, minutes: 60, attended: null },
  { dayOffset: 9, hour: 16, minutes: 60, attended: null },
]);

/** Lessons the demo student has completed: course slug → lesson positions (0-based, flattened). */
export const DEMO_PROGRESS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'staging-demo-quranic-arabic': [0, 1],
  'staging-demo-study-skills': [0],
});

/**
 * Messages, with fixed operation ids so a re-run replays rather than repeats.
 * Non-sensitive: about a class time and a settings question.
 */
export const DEMO_TEACHING_MESSAGES = Object.freeze([
  {
    from: 'teacher' as const,
    operationId: '5d3e0001-0000-4000-8000-000000000001',
    body: 'Hello Amina, this is a demo message. Our next demo class practises the short vowels — please have the lesson open. (Staging sample conversation.)',
  },
  {
    from: 'student' as const,
    operationId: '5d3e0001-0000-4000-8000-000000000002',
    body: 'Thank you. I will be there. Could we go over reading syllables again at the end? (Staging sample conversation.)',
  },
  {
    from: 'teacher' as const,
    operationId: '5d3e0001-0000-4000-8000-000000000003',
    body: 'Yes, we will keep ten minutes for that. See you in class. (Staging sample conversation.)',
  },
]);

export const DEMO_SUPPORT_MESSAGE = Object.freeze({
  operationId: '5d3e0001-0000-4000-8000-000000000010',
  body: 'Hello, this is a demo support request: where do I change which notifications I receive? (Staging sample conversation.)',
});

export const DEMO_MEMBERSHIP_TYPE = Object.freeze({
  title: 'Demo membership (staging)',
  summary: 'A sample membership type for the staging demonstration only.',
  description: `This membership type exists only to show the application journey on staging. ${DEMO_NOTICE} It states no Minhaj-ul-Quran membership policy, fee or benefit.`,
  displayOrder: 9000,
});

export const DEMO_CAMPAIGN = Object.freeze({
  title: 'Demo campaign (staging test — no money moves)',
  summary: 'A sample giving campaign for the staging demonstration. No money moves.',
  description: `Every payment to this campaign goes to a local test simulator: no card is charged and no money moves. ${DEMO_NOTICE}`,
  displayOrder: 9000,
  currency: 'GBP',
  minimum: '1.00',
  maximum: '500.00',
  suggested: ['10.00', '25.00', '50.00'],
});

/** The demo member's fixture donations, in the campaign's currency. */
export const DEMO_DONATIONS = Object.freeze([
  { operationId: '5d3e0002-0000-4000-8000-000000000001', amount: '25.00' },
  { operationId: '5d3e0002-0000-4000-8000-000000000002', amount: '10.00' },
]);

export const DEMO_COLLECTION = Object.freeze({
  title: 'Demo reading list (staging)',
  description: 'A sample private collection made for the staging demonstration.',
});

export const DEMO_NOTE =
  'Demo note: a sample private note made for the staging demonstration — only its owner sees it.';
