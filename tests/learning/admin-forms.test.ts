import { describe, expect, it } from 'vitest';

import {
  courseInputSchema,
  LEARNING_LIMITS,
  lessonChangeSchema,
  moduleChangeSchema,
  pathChangeSchema,
  pathInputSchema,
} from '../../packages/contracts/src/learning/index.ts';
import {
  courseFields,
  formInteger,
  LEARNING_FORM_ROWS,
  lessonChange,
  moduleChange,
  pathChange,
  pathFields,
} from '../../apps/web/src/app/[locale]/admin/learning/forms.ts';

/**
 * Phase 22 — how the Learning administration's forms become the raw values its
 * service parses. The readers only SHAPE what a form sent; the contract's
 * strict schemas decide. So each case is proved twice: what the reader
 * produces, and that the contract accepts exactly that — or refuses it.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const COURSE = {
  slug: 'non-learning-fixture-course',
  primaryLocale: 'en',
  level: '',
  format: 'live',
  languageCode: 'en',
  'en-enabled': 'on',
  'en-title': 'NON_LEARNING_FIXTURE_TITLE',
  'en-summary': 'A summary',
  'en-description': 'Line one\r\nLine two',
};

describe('the Course form', () => {
  it('reads exactly the named fields, and the contract accepts them', () => {
    const raw = courseFields(form(COURSE));
    expect(raw).toEqual({
      slug: 'non-learning-fixture-course',
      primaryLocale: 'en',
      level: null,
      format: 'live',
      languageCode: 'en',
      labels: [
        {
          locale: 'en',
          title: 'NON_LEARNING_FIXTURE_TITLE',
          summary: 'A summary',
          description: 'Line one\nLine two',
        },
      ],
      topicIds: [],
      teacherIds: [],
    });
    expect(courseInputSchema.safeParse(raw).success).toBe(true);
  });

  it('never reads a field the form did not name — no account, state or progress rides along', () => {
    const raw = courseFields(
      form({
        ...COURSE,
        accountId: ID(9),
        state: 'published',
        actorId: ID(8),
        completedLessonIds: ID(7),
      }),
    );
    expect(Object.keys(raw).sort()).toEqual(
      [
        'format',
        'labels',
        'languageCode',
        'level',
        'primaryLocale',
        'slug',
        'teacherIds',
        'topicIds',
      ].sort(),
    );
  });

  it('leaves an unticked locale out rather than saving it empty', () => {
    const raw = courseFields(
      form({ ...COURSE, 'ur-title': 'NON_LEARNING_UNTICKED', 'ar-enabled': 'off' }),
    );
    expect(raw.labels.map((label) => label.locale)).toEqual(['en']);
  });

  it('reads topics and teachers up to the fixed ceilings and no further', () => {
    const rows: Record<string, string> = {};
    for (let index = 0; index <= LEARNING_LIMITS.topics + 3; index += 1)
      rows[`topic-${String(index)}`] = ID(100 + index);
    for (let index = 0; index <= LEARNING_LIMITS.teachers + 3; index += 1)
      rows[`teacher-${String(index)}`] = ID(200 + index);
    const raw = courseFields(form({ ...COURSE, ...rows }));
    expect(raw.topicIds).toHaveLength(LEARNING_FORM_ROWS.topics);
    expect(raw.teacherIds).toHaveLength(LEARNING_FORM_ROWS.teachers);
    expect(courseInputSchema.safeParse(raw).success).toBe(true);
  });

  it('skips an empty row, keeping the order of the rest', () => {
    const raw = courseFields(
      form({ ...COURSE, 'teacher-0': '', 'teacher-1': ID(2), 'teacher-2': ID(1) }),
    );
    expect(raw.teacherIds).toEqual([ID(2), ID(1)]);
  });

  it('passes a missing title through for the contract to refuse, never inventing one', () => {
    const { 'en-title': _omitted, ...rest } = COURSE;
    const raw = courseFields(form(rest));
    expect(raw.labels[0]?.title).toBeNull();
    expect(courseInputSchema.safeParse(raw).success).toBe(false);
  });

  it('passes a duplicated topic through for the contract to refuse', () => {
    const raw = courseFields(form({ ...COURSE, 'topic-0': ID(1), 'topic-1': ID(1) }));
    expect(courseInputSchema.safeParse(raw).success).toBe(false);
  });
});

describe('the path form', () => {
  it('reads the slug, primary locale and labels only', () => {
    const raw = pathFields(
      form({
        slug: 'non-learning-fixture-path',
        primaryLocale: 'ur',
        'ur-enabled': 'on',
        'ur-title': 'NON_LEARNING_FIXTURE_PATH',
        format: 'live',
      }),
    );
    expect(Object.keys(raw).sort()).toEqual(['labels', 'primaryLocale', 'slug']);
    expect(pathInputSchema.safeParse(raw).success).toBe(true);
  });
});

describe('named changes', () => {
  it('shapes each module change as the contract names it', () => {
    const labels = { 'en-enabled': 'on', 'en-title': 'NON_LEARNING_MODULE' };
    for (const fields of [
      { op: 'add', ...labels },
      { op: 'edit', moduleId: ID(1), ...labels },
      { op: 'remove', moduleId: ID(1) },
      { op: 'move', moduleId: ID(1), direction: 'earlier' },
    ]) {
      const change = moduleChange(form(fields));
      expect(moduleChangeSchema.safeParse(change).success, fields.op).toBe(true);
    }
  });

  it('shapes each lesson change, a lesson body arriving as the LF text it was', () => {
    const labels = {
      'en-enabled': 'on',
      'en-title': 'NON_LEARNING_LESSON',
      'en-body': 'First\r\n\r\nSecond',
    };
    const added = lessonChange(form({ op: 'add', moduleId: ID(1), ...labels }));
    expect(added).toMatchObject({
      labels: [{ locale: 'en', body: 'First\n\nSecond', summary: '' }],
    });
    for (const fields of [
      { op: 'add', moduleId: ID(1), ...labels },
      { op: 'edit', lessonId: ID(2), ...labels },
      { op: 'remove', lessonId: ID(2) },
      { op: 'move', lessonId: ID(2), direction: 'later' },
    ])
      expect(lessonChangeSchema.safeParse(lessonChange(form(fields))).success).toBe(true);
  });

  it('never lets a lesson edit move the lesson to another module', () => {
    const change = lessonChange(
      form({
        op: 'edit',
        lessonId: ID(2),
        moduleId: ID(3),
        'en-enabled': 'on',
        'en-title': 'NON_LEARNING_LESSON',
      }),
    );
    expect(change).not.toHaveProperty('moduleId');
  });

  it('shapes each path change', () => {
    for (const fields of [
      { op: 'add', courseId: ID(1) },
      { op: 'remove', courseId: ID(1) },
      { op: 'move', courseId: ID(1), direction: 'earlier' },
    ])
      expect(pathChangeSchema.safeParse(pathChange(form(fields))).success).toBe(true);
  });

  it('answers an operation no form offers with nothing at all', () => {
    for (const op of ['', 'replace', 'reorder', 'publish'])
      for (const reader of [moduleChange, lessonChange, pathChange])
        expect(reader(form({ op }))).toBeNull();
  });

  it('passes a direction no form offers through for the contract to refuse', () => {
    const change = pathChange(form({ op: 'move', courseId: ID(1), direction: 'first' }));
    expect(pathChangeSchema.safeParse(change).success).toBe(false);
  });
});

describe('expected versions', () => {
  it('reads a whole number and nothing else', () => {
    expect(formInteger(form({ version: '7' }), 'version')).toBe(7);
    expect(formInteger(form({}), 'version')).toBeNull();
    for (const typed of ['-1', '1.5', '1e3', '0x10', 'seven'])
      expect(formInteger(form({ version: typed }), 'version')).toBeNaN();
  });
});
