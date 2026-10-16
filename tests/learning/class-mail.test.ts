import { describe, expect, it } from 'vitest';

import { CLASS_COMMUNICATION_PURPOSES } from '../../packages/contracts/src/learning/index.ts';
import {
  CLASS_MAIL_AUDIENCES,
  CLASS_MAIL_LOCALES,
  describeClassTime,
  renderClassMail,
} from '../../apps/web/src/contexts/learning/application/class-mail.ts';

/**
 * Phase 23 — Learning's class mail: every purpose authored for both audiences
 * in all three locales, right-to-left where it must be, the class time stated
 * in the class's own zone, a link to the person's own private page — and
 * NEVER a meeting address.
 */

const CLASS = {
  startsAt: new Date('2026-10-10T14:00:00Z'),
  endsAt: new Date('2026-10-10T15:00:00Z'),
  timeZone: 'Asia/Karachi',
};

describe('class mail', () => {
  it('renders every purpose for every audience in every locale, with direction', () => {
    for (const purpose of CLASS_COMMUNICATION_PURPOSES)
      for (const audience of CLASS_MAIL_AUDIENCES)
        for (const locale of CLASS_MAIL_LOCALES) {
          const message = renderClassMail({
            purpose,
            audience,
            locale,
            recipient: 'person@learning-proof.invalid',
            ...CLASS,
            classUrl: 'https://example.invalid/en/my/classes/x',
          });
          expect(message.subject.length).toBeGreaterThan(0);
          expect(message.html).toContain(
            `<html lang="${locale}" dir="${locale === 'en' ? 'ltr' : 'rtl'}">`,
          );
          expect(message.text).toContain('https://example.invalid/en/my/classes/x');
          expect(message.recipient).toBe('person@learning-proof.invalid');
        }
  });

  it('states the time in the scheduling zone, named, and never a meeting address', () => {
    const message = renderClassMail({
      purpose: 'learning.class-reminder',
      audience: 'learner',
      locale: 'en',
      recipient: 'person@learning-proof.invalid',
      ...CLASS,
      classUrl: 'https://example.invalid/en/my/classes/x',
    });
    expect(message.text).toContain('Asia/Karachi');
    expect(message.text).toMatch(/7:00/u);
    expect(message.html).not.toMatch(/meet\.google\.com/u);
    expect(message.text).not.toMatch(/meet\.google\.com/u);
    expect(
      describeClassTime(CLASS.startsAt, CLASS.endsAt, 'Asia/Karachi', 'en'),
    ).toContain('(Asia/Karachi)');
  });

  it('escapes the link in HTML and falls back to English for an unknown locale', () => {
    const message = renderClassMail({
      purpose: 'learning.session-cancelled',
      audience: 'teacher',
      locale: 'fr',
      recipient: 'teacher@learning-proof.invalid',
      ...CLASS,
      classUrl: 'https://example.invalid/en/teacher/classes/today/x?a=1&b=2',
    });
    expect(message.html).toContain('<html lang="en" dir="ltr">');
    expect(message.html).toContain('x?a=1&amp;b=2');
  });
});
