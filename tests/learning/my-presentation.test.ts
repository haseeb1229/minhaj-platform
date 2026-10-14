import { describe, expect, it } from 'vitest';

import type { ModuleOutline } from '../../packages/contracts/src/learning/index.ts';
import {
  lessonsInOrder,
  paragraphs,
  pickLabel,
  selectedLesson,
} from '../../apps/web/src/components/my-learning/presentation.ts';

/**
 * Phase 22 — the pure presentation rules My Learning and the Learning
 * administration share: which label is shown, how a plain-text lesson body
 * becomes paragraphs, and which lesson a learner's Course page opens on.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const label = (title: string) => [{ locale: 'en' as const, title, summary: '' }];

const OUTLINE: readonly ModuleOutline[] = [
  {
    id: ID(1),
    position: 1,
    labels: label('M1'),
    lessons: [
      { id: ID(11), position: 1, labels: label('L1') },
      { id: ID(12), position: 2, labels: label('L2') },
    ],
  },
  {
    id: ID(2),
    position: 2,
    labels: label('M2'),
    lessons: [{ id: ID(21), position: 1, labels: label('L3') }],
  },
];

describe('labels', () => {
  const labels = [
    { locale: 'ur' as const, title: 'اردو' },
    { locale: 'ar' as const, title: 'عربي' },
  ];

  it('prefers the reader’s locale, then the primary, then the first there is', () => {
    expect(pickLabel(labels, 'ar', 'ur')?.title).toBe('عربي');
    expect(pickLabel(labels, 'en', 'ar')?.title).toBe('عربي');
    expect(pickLabel(labels, 'en', 'en')?.title).toBe('اردو');
    expect(pickLabel([], 'en', 'en')).toBeNull();
  });
});

describe('lesson bodies', () => {
  it('splits paragraphs on blank lines and keeps single line breaks inside one', () => {
    expect(paragraphs('One\nstill one\r\n\r\nTwo\n \t\nThree')).toEqual([
      'One\nstill one',
      'Two',
      'Three',
    ]);
  });

  it('drops empty paragraphs and returns plain strings, never markup', () => {
    expect(paragraphs('\n\n<b>bold</b>\n\n\n')).toEqual(['<b>bold</b>']);
    expect(paragraphs('')).toEqual([]);
  });
});

describe('the lesson a Course page opens', () => {
  it('reads the syllabus in order', () => {
    expect(lessonsInOrder(OUTLINE).map((lesson) => lesson.id)).toEqual([
      ID(11),
      ID(12),
      ID(21),
    ]);
  });

  it('opens the lesson asked for, when it is in this syllabus', () => {
    expect(selectedLesson(OUTLINE, new Set(), ID(21))).toBe(ID(21));
  });

  it('ignores a lesson that is not in this syllabus, and anything malformed', () => {
    for (const requested of [ID(99), 'not-an-id', '', `${ID(11)} `])
      expect(selectedLesson(OUTLINE, new Set(), requested)).toBe(ID(11));
  });

  it('otherwise opens the first lesson not yet completed', () => {
    expect(selectedLesson(OUTLINE, new Set([ID(11)]), null)).toBe(ID(12));
    expect(selectedLesson(OUTLINE, new Set([ID(11), ID(12)]), null)).toBe(ID(21));
  });

  it('opens the first lesson once all are complete, and nothing for an empty syllabus', () => {
    expect(selectedLesson(OUTLINE, new Set([ID(11), ID(12), ID(21)]), null)).toBe(ID(11));
    expect(selectedLesson([], new Set(), null)).toBeNull();
  });
});
