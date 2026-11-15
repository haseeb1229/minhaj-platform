import { describe, expect, it } from 'vitest';

import {
  classDay,
  isFilteredSchedule,
  isInvalidSchedule,
  isInvalidTeacherDirectory,
  readScheduleQuery,
  readTeacherDirectoryQuery,
  scheduleCanonicalRedirect,
  scheduleHref,
  scheduleViewOf,
  teacherDirectoryCanonicalRedirect,
  teacherDirectoryHref,
} from '../../apps/web/src/components/live-learning/presentation.ts';

/**
 * LEARN PART 2 — the public schedule's and the teacher directory's address
 * rules: what a URL asks for, the ONE spelling of each valid view, and that a
 * malformed or repeated filter is answered in place (invalid, never broadened,
 * never redirected away).
 */

describe('the public schedule address (/learn/live)', () => {
  it('reads each filter exactly as the owner grammar writes it', () => {
    const read = readScheduleQuery({
      course: 'tajweed-basics',
      teacher: 'some-teacher',
      language: 'ur',
      offset: '24',
    });
    expect(scheduleViewOf(read)).toEqual({
      course: 'tajweed-basics',
      teacher: 'some-teacher',
      language: 'ur',
      offset: 24,
    });
    expect(isInvalidSchedule(read)).toBe(false);
    expect(isFilteredSchedule(read)).toBe(true);
  });

  it('treats an empty control as absent, and nothing as unfiltered', () => {
    const read = readScheduleQuery({ course: '', teacher: '', language: '' });
    expect(isInvalidSchedule(read)).toBe(false);
    expect(isFilteredSchedule(read)).toBe(false);
    expect(isFilteredSchedule(readScheduleQuery({}))).toBe(false);
  });

  it('reports a malformed or repeated filter invalid — it never broadens', () => {
    for (const query of [
      { course: 'Not A Slug' },
      { course: ' tajweed' },
      { teacher: '../admin' },
      { language: 'english!' },
      { course: ['one', 'two'] },
      { language: ['ur', 'en'] },
    ]) {
      const read = readScheduleQuery(query);
      expect(isInvalidSchedule(read), JSON.stringify(query)).toBe(true);
      // A malformed view is answered where it was asked, not redirected.
      expect(scheduleCanonicalRedirect('en', query), JSON.stringify(query)).toBeNull();
    }
  });

  it('spells every view once: fixed order, neutral values omitted', () => {
    expect(scheduleHref('en')).toBe('/learn/live');
    expect(scheduleHref('ur', { language: 'ur', course: 'c-one', offset: 0 })).toBe(
      '/ur/learn/live?course=c-one&language=ur',
    );
    expect(
      scheduleHref('en', {
        teacher: 't-one',
        course: 'c-one',
        language: 'ar',
        offset: 24,
      }),
    ).toBe('/learn/live?course=c-one&teacher=t-one&language=ar&offset=24');
  });

  it('redirects another spelling of a valid view ONCE, to the canonical one', () => {
    expect(scheduleCanonicalRedirect('en', {})).toBeNull();
    expect(scheduleCanonicalRedirect('en', { course: 'c-one' })).toBeNull();
    expect(scheduleCanonicalRedirect('en', { language: 'ur', course: 'c-one' })).toBe(
      '/learn/live?course=c-one&language=ur',
    );
    expect(scheduleCanonicalRedirect('en', { course: '', teacher: '' })).toBe(
      '/learn/live',
    );
    expect(scheduleCanonicalRedirect('ar', { offset: '0' })).toBe('/ar/learn/live');
    expect(scheduleCanonicalRedirect('en', { offset: 'many' })).toBe('/learn/live');
    // A parameter the schedule does not read is left alone.
    expect(scheduleCanonicalRedirect('en', { utm: 'x' })).toBeNull();
  });

  it('groups a class by the day it starts on in its own zone', () => {
    expect(classDay('2026-11-16T23:30')).toBe('2026-11-16');
  });
});

describe('the teacher directory address (/learn/teachers)', () => {
  it('reads a subject, a language and the one availability word', () => {
    const read = readTeacherDirectoryQuery({
      subject: 'hadith',
      language: 'ur',
      availability: 'available',
    });
    expect(isInvalidTeacherDirectory(read)).toBe(false);
    expect(
      teacherDirectoryHref('en', {
        subject: 'hadith',
        language: 'ur',
        availability: 'available',
      }),
    ).toBe('/learn/teachers?subject=hadith&language=ur&availability=available');
  });

  it('reports an unknown or repeated value invalid and does not redirect it', () => {
    for (const query of [
      { availability: 'bogus' },
      { subject: 'No Such' },
      { subject: ['hadith', 'quran'] },
      { availability: ['available', 'available'] },
      { subject: 'hadith', availability: 'bogus' },
    ]) {
      expect(
        isInvalidTeacherDirectory(readTeacherDirectoryQuery(query)),
        JSON.stringify(query),
      ).toBe(true);
      expect(teacherDirectoryCanonicalRedirect('en', query)).toBeNull();
    }
  });

  it('redirects a form’s empty controls and another order once', () => {
    expect(
      teacherDirectoryCanonicalRedirect('en', { availability: 'available' }),
    ).toBeNull();
    expect(
      teacherDirectoryCanonicalRedirect('en', {
        subject: '',
        language: '',
        availability: 'available',
      }),
    ).toBe('/learn/teachers?availability=available');
    expect(
      teacherDirectoryCanonicalRedirect('ur', { language: 'ur', subject: 'hadith' }),
    ).toBe('/ur/learn/teachers?subject=hadith&language=ur');
  });
});
